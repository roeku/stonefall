import express from 'express';
import { reddit, createServer, context, getServerPort, scheduler } from '@devvit/web/server';
import { telemetryRouter } from '@devvit/analytics/server/reddit';
import type {
  BragKind,
  BragRequest,
  BragResponse,
  EnterResponse,
  GetBoardResponse,
  GetFeedResponse,
  GetMeResponse,
  PlaceTowerRequest,
  PlaceTowerResponse,
  RelayBragRequest,
  RelayBragResponse,
  RelayDropRequest,
  RelayDropResponse,
  RelayJoinRequest,
  RelayJoinResponse,
  RelayStateResponse,
  RemovePlacementRequest,
  RemovePlacementResponse,
  SaveRunRequest,
  SaveRunResponse,
  SetFactionRequest,
  SetFactionResponse,
} from '../shared/types/api';
import { isFactionId } from '../shared/types/factions';
import { Maps } from './core/maps';
import { Runs } from './core/runs';
import { Plots } from './core/plots';
import { Admin } from './core/admin';
import { Relay } from './core/relay';
import { SocialService } from './core/socialService';
import { Users } from './core/users';

/**
 * The Stonefall server.
 *
 * Three rules:
 *
 * - `/api/*` is the only surface a web view can reach, so everything on it assumes a hostile
 *   caller. Nothing there trusts a number it was given, and nothing there can touch data
 *   belonging to somebody else except by the rules of the game (a take topples a tower, and only
 *   by beating it).
 * - `/internal/*` is reachable only by the platform: menu items, forms, triggers, the scheduler.
 *   The destructive tools live there, behind a moderator-only menu and a typed confirmation.
 * - Reads never write. The board is rebuilt when a placement changes it, not when someone looks.
 *   The relay's heartbeat is the one deliberate exception, because somebody has to move the
 *   turn along and it is the request that is always coming.
 *
 * The map and the relay are daily. A post shows its own day: an older one opens on how that day
 * ended (`?view=post` on the reads, see `Maps.forView` and `Relay.shownFor`). Everything that
 * plays or builds works on the live day, whichever post it came from (`Maps.forRequest` and
 * `relayPost`), because Reddit shows posts for days after they are made and an older post is a way
 * in to today's game. A build aimed on a map that has since turned over is refused rather than
 * landed on the new one.
 */

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

/** Journeys owns /api/telemetry/*. Mounted first so nothing below can shadow it. */
app.use(telemetryRouter);

const router = express.Router();

/** Who is calling, according to Reddit. Never taken from the request body. */
const caller = async (): Promise<{ userId: string; username: string } | null> => {
  if (context.userId && context.username) {
    return { userId: context.userId, username: context.username };
  }
  const user = await reddit.getCurrentUser();
  if (!user?.id) return null;
  return { userId: user.id, username: user.username ?? 'someone' };
};

const blankGrid = (userId: string, username: string) => ({
  userId,
  username,
  placements: [],
  updatedAt: 0,
});

/**
 * Client logs, forwarded so they show up in `devvit logs`.
 *
 * The only way to see a client error on a real phone during playtest. Bounded so a misbehaving
 * client cannot turn it into a firehose.
 */
router.post('/api/log', async (req, res): Promise<void> => {
  const logs = Array.isArray(req.body?.logs) ? req.body.logs.slice(0, 25) : [];
  for (const entry of logs) {
    const level = entry?.level === 'error' ? 'error' : 'warn';
    const message = String(entry?.message ?? '').slice(0, 500);
    if (level === 'error') console.error(`[client] ${message}`);
    else console.warn(`[client] ${message}`);
  }
  res.json({ success: true });
});

/** What a closed map says to anything that tries to build on it. */
const CLOSED_MAP = "This map is closed. Today's map is where building happens.";

/** What a raise aimed on yesterday's map is told when the day turned over while aiming. */
const MAP_TURNED = "A new day's map just opened. Raise it there.";

// --- The board ------------------------------------------------------------

/** `?view=post` is the board the post opens on: its own day's, when that day is over. */
router.get('/api/board', async (req, res): Promise<void> => {
  const map = await Maps.forView(req.query.view === 'post' ? 'post' : 'live');
  const { towers, keeps } = await Plots.board(map.day);
  res.json({
    type: 'board',
    towers,
    keeps,
    totalCount: towers.length,
    map,
  } satisfies GetBoardResponse);
});

router.get('/api/me', async (_req, res): Promise<void> => {
  const me = await caller();
  if (!me) {
    res.json({
      type: 'me',
      userId: null,
      username: null,
      grid: null,
      region: null,
      faction: null,
      chosen: false,
    } satisfies GetMeResponse);
    return;
  }
  const map = await Maps.forRequest();
  const [grid, region, record] = await Promise.all([
    Plots.getPlot(map.day, me.userId),
    Plots.getRegion(map.day, me.userId),
    Users.read(me.userId),
  ]);
  res.json({
    type: 'me',
    userId: me.userId,
    username: me.username,
    // A player with no plot yet still has an identity, so the board can tell whose towers are
    // whose from the first visit instead of only after they have placed something.
    grid: grid ?? blankGrid(me.userId, me.username),
    region: region ? Plots.describeRegion(region) : null,
    faction: Users.factionFrom(record, me.userId),
    chosen: record.chosen === '1',
  } satisfies GetMeResponse);
});

/** Claim a plot. Called when a run starts, so the map holds people who play. */
router.post('/api/enter', async (_req, res): Promise<void> => {
  const me = await caller();
  if (!me) {
    res.status(401).json({ type: 'enter', success: false, message: 'Sign in to build.' });
    return;
  }
  const map = await Maps.forRequest();
  if (!map.live) {
    res.status(409).json({ type: 'enter', success: false, message: CLOSED_MAP });
    return;
  }
  const region = await Plots.getOrAssignRegion(map.day, me.userId, me.username);
  res.json({
    type: 'enter',
    success: true,
    region: Plots.describeRegion(region),
    faction: await Users.faction(me.userId),
  } satisfies EnterResponse);
});

router.post<Record<string, never>, SetFactionResponse, SetFactionRequest>(
  '/api/me/faction',
  async (req, res): Promise<void> => {
    const me = await caller();
    if (!me) {
      res.status(401).json({ type: 'faction', success: false, message: 'Sign in first.' });
      return;
    }
    const faction = req.body?.faction;
    if (!isFactionId(faction)) {
      res.status(400).json({ type: 'faction', success: false, message: 'Not a colour.' });
      return;
    }
    const before = await Users.faction(me.userId);
    await Users.setFaction(me.userId, me.username, faction);
    // Changing sides costs everything standing on today's map, whichever post it was asked from:
    // a colour is one allegiance, not one per day's post.
    const live = await Maps.liveDay();
    const razed = faction === before ? [] : await Plots.raze(live, me.userId);
    await Plots.recolourKeep(live, me.userId, me.username, faction);
    res.json({ type: 'faction', success: true, faction, razed });
  }
);

router.post<Record<string, never>, PlaceTowerResponse, PlaceTowerRequest>(
  '/api/grid/raise',
  async (req, res): Promise<void> => {
    const me = await caller();
    if (!me) {
      res.status(401).json({ type: 'place_tower', success: false, message: 'Sign in to build.' });
      return;
    }
    const map = await Maps.forRequest();
    if (!map.live) {
      res.status(409).json({ type: 'place_tower', success: false, message: CLOSED_MAP });
      return;
    }
    const { sessionId, gridX, gridZ, day } = req.body ?? ({} as PlaceTowerRequest);
    // The cell was picked on the board the player was looking at. If that board's day is over,
    // the same coordinates mean somebody else's ground on the new map, so the raise is refused
    // and the client re-reads the new map with the tower still in hand.
    if (typeof day === 'string' && day !== map.day) {
      res.status(409).json({
        type: 'place_tower',
        success: false,
        message: MAP_TURNED,
        stale: true,
      });
      return;
    }
    const result = await Plots.raise(
      map.day,
      me.userId,
      me.username,
      String(sessionId),
      Number(gridX),
      Number(gridZ)
    );
    if (!result.ok) {
      res.status(409).json({
        type: 'place_tower',
        success: false,
        message: result.reason,
        ...(result.bar !== undefined ? { bar: result.bar } : {}),
      });
      return;
    }
    res.json({
      type: 'place_tower',
      success: true,
      grid: result.grid,
      kind: result.kind,
      ...(result.took ? { took: result.took } : {}),
    });
  }
);

router.post<Record<string, never>, RemovePlacementResponse, RemovePlacementRequest>(
  '/api/grid/remove',
  async (req, res): Promise<void> => {
    const me = await caller();
    if (!me) {
      res.status(401).json({ type: 'remove_placement', success: false, message: 'Sign in first.' });
      return;
    }
    // The id is matched inside the caller's own plot, so this can only remove what they placed.
    const map = await Maps.forRequest();
    if (!map.live) {
      res.status(409).json({ type: 'remove_placement', success: false, message: CLOSED_MAP });
      return;
    }
    const result = await Plots.remove(map.day, me.userId, String(req.body?.sessionId));
    if (!result.ok) {
      res.status(409).json({ type: 'remove_placement', success: false, message: result.reason });
      return;
    }
    res.json({ type: 'remove_placement', success: true, grid: result.grid });
  }
);

// --- Runs -----------------------------------------------------------------

router.post<Record<string, never>, SaveRunResponse, SaveRunRequest>(
  '/api/game/save-run',
  async (req, res): Promise<void> => {
    const body = req.body ?? ({} as SaveRunRequest);
    const result = await Runs.save({
      sessionId: String(body.sessionId ?? ''),
      seed: Number(body.seed),
      gameMode: String(body.gameMode ?? 'rotating_block'),
      inputs: Array.isArray(body.inputs) ? body.inputs : [],
    });
    if (!result.ok) {
      res.status(400).json({ type: 'save_run', success: false, message: result.reason });
      return;
    }
    const { run } = result;
    // What the server computed, not what the client claimed.
    res.json({
      type: 'save_run',
      success: true,
      sessionId: run.sessionId,
      score: run.score,
      blockCount: run.blockCount,
      perfectCount: run.perfectCount,
      maxCombo: run.maxCombo,
      towerBlocks: run.towerBlocks,
      isPersonalBest: result.isPersonalBest,
      faction: run.faction,
    });
  }
);

// --- Community ------------------------------------------------------------

/** What a map run can say. `fell` belongs to the relay and is posted by `/api/relay/brag`. */
const MAP_BRAG_KINDS: readonly BragKind[] = ['plain', 'best', 'first', 'passed', 'claimed', 'took'];

/** Whether the person a comment would name really is who this run went past, on that score. */
const confirmNamed = async (
  kind: BragKind,
  named: { username: string; score: number },
  run: { sessionId: string; score: number },
  day: string,
  thread: string | null
): Promise<boolean> => {
  if (!Number.isFinite(named.score) || named.score >= run.score) return false;
  const same = (name: string) => name.toLowerCase() === named.username.toLowerCase();
  if (kind === 'took') {
    const took = await Plots.tookFrom(day, run.sessionId);
    return !!took && same(took.username) && took.score === named.score;
  }
  const { towers } = await Plots.board(day);
  if (towers.some((t) => same(t.username) && t.score === named.score)) return true;
  return SocialService.inFeed(thread, named.username, named.score);
};

router.post<Record<string, never>, BragResponse, BragRequest>(
  '/api/social/brag',
  async (req, res): Promise<void> => {
    const b = req.body;
    if (!b || typeof b.sessionId !== 'string') {
      res.status(400).json({ type: 'brag', success: false, message: 'Missing run details.' });
      return;
    }
    // The run is read back from storage rather than taken from the request, so a comment can
    // only ever claim the score the server itself computed, for a run the caller owns.
    const [run, me] = await Promise.all([Runs.get(b.sessionId), caller()]);
    if (!run || !me || run.userId !== me.userId) {
      res.status(403).json({ type: 'brag', success: false, message: 'That is not your run.' });
      return;
    }
    const kind = MAP_BRAG_KINDS.includes(b.kind) ? b.kind : 'plain';
    const map = await Maps.forRequest();
    const thread = await Maps.todayPostId();
    let cell: { x: number; z: number } | undefined;
    if (kind === 'took' || kind === 'claimed') {
      // A cell can only be announced by the tower standing on it.
      const x = Number(b.cell?.x);
      const z = Number(b.cell?.z);
      const hold =
        Number.isInteger(x) && Number.isInteger(z) ? await Plots.getHold(map.day, x, z) : null;
      if (!hold || hold.sessionId !== run.sessionId) {
        res.status(409).json({ type: 'brag', success: false, message: 'That cell is not yours.' });
        return;
      }
      cell = { x, z };
    }
    // A name in a comment is a Reddit mention, which notifies that person, so a comment only
    // names somebody the server can see this run went past: the owner of the tower it toppled,
    // or a score standing on today's map or said in today's thread. Anything else is refused
    // rather than quietly reworded, because the player confirmed the exact text.
    const claimed =
      (kind === 'took' || kind === 'passed') && typeof b.passedUsername === 'string'
        ? { username: b.passedUsername.slice(0, 40), score: Number(b.passedScore) }
        : null;
    if (claimed && !(await confirmNamed(kind, claimed, run, map.day, thread))) {
      res.status(409).json({
        type: 'brag',
        success: false,
        message: 'That score has changed. Nothing was posted.',
      });
      return;
    }
    // Into today's thread, whichever post the run was played from: the day's talk stays in one
    // place, and the chatter line every post shows is read from there.
    const result = await SocialService.brag(
      {
        sessionId: run.sessionId,
        kind,
        score: run.score,
        blocks: run.blockCount,
        perfectStreak: run.perfectCount,
        faction: run.faction,
        passedUsername: claimed?.username,
        passedScore: claimed?.score,
        cell,
      },
      thread,
      b.text
    );
    if (!result.ok) {
      res.status(409).json({ type: 'brag', success: false, message: result.reason });
      return;
    }
    res.json({ type: 'brag', success: true, record: result.record, topLevel: result.topLevel });
  }
);

router.get<Record<string, never>, GetFeedResponse>(
  '/api/social/feed',
  async (req, res): Promise<void> => {
    const limit = Math.min(24, Math.max(1, Number(req.query.limit) || 12));
    // Today's thread, so an older post shows the day being played rather than its own.
    res.json({ type: 'feed', brags: await SocialService.feed(limit, await Maps.todayPostId()) });
  }
);

// --- Relay ----------------------------------------------------------------

/**
 * The relay post this request came from, if it came from one.
 *
 * `postData.kind` is the cheap answer, and a stored relay row for the post is the sure one, so a
 * request whose context arrived without post data still counts.
 */
const fromRelayPost = async (): Promise<string | null> => {
  const { postId, postData } = context;
  if (!postId) return null;
  const kind = (postData as { kind?: unknown } | undefined)?.kind;
  const isRelay = kind === 'relay' || (kind === undefined && (await Relay.meta(postId)) !== null);
  return isRelay ? postId : null;
};

/**
 * The relay a request plays: today's, from any relay post, whichever day it went up. Reddit keeps
 * showing a post for days, and a relay that had topped out was a dead end to everyone who found
 * it then. Its towers, crews, pushes and thread are all today's post's.
 */
const relayPost = async (): Promise<string | null> => {
  const postId = await fromRelayPost();
  return postId ? ((await Relay.currentPostId()) ?? postId) : null;
};

/** The relay a post opens on: its own day's towers once that day has topped out. */
const relayShown = async (): Promise<string | null> => {
  const postId = await fromRelayPost();
  return postId ? Relay.shownFor(postId) : null;
};

/** Which tower a spectator asked to watch, if any. */
const towerParam = (raw: unknown): number | null => {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : null;
};

router.get('/api/relay/today', async (_req, res): Promise<void> => {
  res.json({ type: 'relay_today', postId: await Relay.currentPostId() });
});

router.get('/api/map/today', async (_req, res): Promise<void> => {
  res.json({ type: 'map_today', postId: await Maps.todayPostId() });
});

/** The name this had before maps were daily, for a client bundle still cached from then. */
router.get('/api/map/latest', async (_req, res): Promise<void> => {
  res.json({ type: 'map_latest', postId: await Maps.todayPostId() });
});

/** `?view=post` is the relay the post opens on: its own day's towers, once that day is over. */
router.get<Record<string, never>, RelayStateResponse | { type: 'relay'; state: null }>(
  '/api/relay/state',
  async (req, res): Promise<void> => {
    const postId = req.query.view === 'post' ? await relayShown() : await relayPost();
    const me = await caller();
    const state = postId ? await Relay.state(postId, me, towerParam(req.query.tower)) : null;
    res.json({ type: 'relay', state });
  }
);

router.post('/api/relay/heartbeat', async (req, res): Promise<void> => {
  const postId = await relayPost();
  const me = await caller();
  if (!postId) {
    res.json({ type: 'relay', state: null });
    return;
  }
  // Signed out is watching only: the state is read, and nothing is written for them.
  const tower = towerParam(req.body?.tower);
  res.json({
    type: 'relay',
    state: me ? await Relay.heartbeat(postId, me, tower) : await Relay.state(postId, null, tower),
  });
});

router.post<Record<string, never>, RelayJoinResponse, RelayJoinRequest>(
  '/api/relay/join',
  async (req, res): Promise<void> => {
    const postId = await relayPost();
    const me = await caller();
    if (!postId || !me) {
      res.status(401).json({ type: 'relay_join', success: false, message: 'Sign in to play.' });
      return;
    }
    const result = await Relay.join(postId, me, towerParam(req.body?.tower));
    if (!result.ok) {
      res.status(409).json({
        type: 'relay_join',
        success: false,
        message: result.reason,
        ...(result.state ? { state: result.state } : {}),
      });
      return;
    }
    res.json({ type: 'relay_join', success: true, started: result.started, state: result.state });
  }
);

router.post<Record<string, never>, RelayDropResponse, RelayDropRequest>(
  '/api/relay/drop',
  async (req, res): Promise<void> => {
    const postId = await relayPost();
    const me = await caller();
    if (!postId || !me) {
      res.status(401).json({ type: 'relay_drop', success: false, message: 'Sign in to play.' });
      return;
    }
    const result = await Relay.drop(postId, me, Number(req.body?.tick), Number(req.body?.index));
    if (!result.ok) {
      res.status(409).json({
        type: 'relay_drop',
        success: false,
        message: result.reason,
        ...(result.state ? { state: result.state } : {}),
      });
      return;
    }
    res.json({ type: 'relay_drop', success: true, result: result.result, state: result.state });
  }
);

router.post<Record<string, never>, RelayBragResponse, RelayBragRequest>(
  '/api/relay/brag',
  async (req, res): Promise<void> => {
    const postId = await relayPost();
    const me = await caller();
    if (!postId || !me) {
      res.status(401).json({ type: 'relay_brag', success: false, message: 'Sign in first.' });
      return;
    }
    const result = await Relay.brag(postId, me.userId, req.body?.text);
    if (!result.ok) {
      res.status(409).json({ type: 'relay_brag', success: false, message: result.reason });
      return;
    }
    res.json({ type: 'relay_brag', success: true, topLevel: result.topLevel });
  }
);

// --- Internal -------------------------------------------------------------
//
// Menus, forms, triggers and the scheduler. Devvit does not expose these to web views, which is
// what makes it safe for the destructive tools to live here.

/**
 * The day's two posts, the map and the relay, opened together so they always come in a pair.
 * The map goes first: it is the one the relay sends people back to. Each is tried on its own,
 * so a refusal from Reddit for one does not cost the day the other.
 */
const openDay = async (): Promise<{ map: string | null; relay: string | null }> => {
  const attempt = async (what: string, open: () => Promise<{ postId: string }>) => {
    try {
      return (await open()).postId;
    } catch (err) {
      console.error(`daily: could not open ${what}`, err);
      return null;
    }
  };
  const map = await attempt('the map', () => Maps.openToday());
  const relay = await attempt('the relay', () => Relay.openToday());
  return { map, relay };
};

router.post('/internal/menu/post-create', async (_req, res): Promise<void> => {
  const { postId, created } = await Maps.openToday();
  res.json({
    showToast: created ? "Today's map post created." : "Today's map post already exists.",
    navigateTo: `https://reddit.com/r/${context.subredditName}/comments/${postId}`,
  });
});

router.post('/internal/menu/relay-post-create', async (_req, res): Promise<void> => {
  const { postId, created } = await Relay.openToday();
  res.json({
    showToast: created ? "Today's relay post created." : "Today's relay post already exists.",
    navigateTo: `https://reddit.com/r/${context.subredditName}/comments/${postId}`,
  });
});

router.post('/internal/scheduler/daily', async (_req, res): Promise<void> => {
  const day = await openDay();
  await scheduleRetirement();
  res.json({ status: 'ok', ...day });
});

/** The daily job's name before the map was daily too. Same work. */
router.post('/internal/scheduler/relay-daily', async (_req, res): Promise<void> => {
  res.json({ status: 'ok', ...(await openDay()) });
});

/**
 * Installed or upgraded: make sure a map and a relay exist, without rolling the day over. Before
 * this, a subreddit had no map post until a moderator made one, and the relay's link back to the
 * map had nothing to point at.
 */
const ensureDay = async (_req: express.Request, res: express.Response): Promise<void> => {
  const ensure = async (what: string, open: () => Promise<{ postId: string }>) => {
    try {
      return (await open()).postId;
    } catch (err) {
      console.error(`install: could not open ${what}`, err);
      return null;
    }
  };
  const map = await ensure('the map', () => Maps.ensureOpen());
  const relay = await ensure('the relay', () => Relay.ensureOpen());
  await scheduleRetirement();
  res.json({ status: 'ok', map, relay });
};
router.post('/internal/on-app-install', ensureDay);
router.post('/internal/on-app-upgrade', ensureDay);

/**
 * Queue the retirement job (`Admin.retireBatch`) unless it has finished on this install. Asked
 * for by the install and upgrade triggers and, as a backstop, by the daily job.
 */
const scheduleRetirement = async (): Promise<void> => {
  try {
    if (await Admin.retired()) return;
    await scheduler.runJob({ name: 'retire-data', runAt: new Date(Date.now() + 5_000) });
  } catch (err) {
    console.error('retire: could not schedule', err);
  }
};

/** One batch of the retirement job, and the next batch queued if there is more to do. */
router.post('/internal/scheduler/retire-data', async (_req, res): Promise<void> => {
  const { done, players } = await Admin.retireBatch();
  if (!done) {
    await scheduler.runJob({ name: 'retire-data', runAt: new Date(Date.now() + 2_000) });
  }
  res.json({ status: 'ok', done, players });
});

/**
 * Where a player reports a problem with the game: the Stonefall community's modmail, which the
 * developer reads. Devvit's rules ask every app for a way to report issues and for an easy way
 * to reach its developer; the post menu is it, so the game's own screen stays uncluttered.
 */
const SUPPORT_SUBREDDIT = 'stonefall';

router.post('/internal/menu/report-problem', async (_req, res): Promise<void> => {
  const subject = encodeURIComponent('Stonefall: a problem');
  const where = context.postId
    ? `\n\nPost: https://www.reddit.com/comments/${context.postId.replace('t3_', '')}`
    : '';
  const message = encodeURIComponent(`What happened?${where}`);
  res.json({
    navigateTo: `https://www.reddit.com/message/compose/?to=r/${SUPPORT_SUBREDDIT}&subject=${subject}&message=${message}`,
  });
});

router.post('/internal/menu/purge-dry-run', async (_req, res): Promise<void> => {
  const { players, placements, runs } = await Admin.dryRun();
  const legacy = await Admin.legacyCounts();
  res.json({
    showToast:
      `Would remove ${players} plots, ${placements} standing towers, ${runs} runs` +
      `, and ${legacy.grids} grids / ${legacy.sessions} sessions from the old keyspace.`,
  });
});

router.post('/internal/menu/purge', async (_req, res): Promise<void> => {
  res.json({ showForm: { name: 'purgeConfirmForm' } });
});

router.post('/internal/form/purge-confirm', async (req, res): Promise<void> => {
  // Typing the subreddit name back is the entire safeguard against a mis-click, so a mismatch
  // is a refusal rather than a retry prompt.
  const typed = String(req.body?.confirm ?? '')
    .trim()
    .toLowerCase();
  const expected = (context.subredditName ?? '').trim().toLowerCase();
  if (!expected || typed !== expected) {
    res.json({ showToast: 'Name did not match. Nothing was removed.' });
    return;
  }
  const { players, runs } = await Admin.purgeAll();
  // Both keyspaces in one action, because a half-cleared Redis after a data-model change is
  // worse than either state on its own.
  const legacy = await Admin.purgeLegacy();
  res.json({
    showToast:
      `Cleared ${players} plots and ${runs} runs, ` +
      `plus ${legacy.grids} legacy grids and ${legacy.sessions} legacy sessions.`,
  });
});

router.post('/internal/on-comment-delete', async (req, res): Promise<void> => {
  const { commentId, postId } = req.body ?? {};
  // The feed a brag is in is the thread its comment was posted in, which the event names.
  if (typeof commentId === 'string') {
    await SocialService.forgetComment(commentId, typeof postId === 'string' ? postId : null);
  }
  res.json({ status: 'ok' });
});

/**
 * A post was deleted or removed. Devvit's rules require everything the app holds from it to go:
 * here that is the feed of its score comments and its pinned comment. If it was today's map or
 * relay post, the day forgets it too, so the moderator menu can put up another.
 */
router.post('/internal/on-post-delete', async (req, res): Promise<void> => {
  const { postId } = req.body ?? {};
  if (typeof postId === 'string' && postId.startsWith('t3_')) {
    await SocialService.forgetPost(postId);
    await Maps.forgetPost(postId);
    await Relay.forgetPost(postId);
  }
  res.json({ status: 'ok' });
});

router.post('/internal/scheduler/board-rebuild', async (_req, res): Promise<void> => {
  // The backstop for write-time invalidation: it bounds how stale the board can get if an
  // invalidation is ever lost, and it re-applies the index trims and drops orphaned holds. Only
  // today's map; a closed map is never written again.
  const { towers } = await Plots.rebuildBoard(await Maps.liveDay());
  res.json({ status: 'ok', towers: towers.length });
});

app.use(router);

/**
 * Anything under /api that got this far does not exist.
 *
 * Explicit, because a web view asking for a route this server no longer has should be told so
 * rather than handed the client bundle and left to fail parsing it as JSON.
 */
app.use('/api', (_req, res) => {
  res.status(404).json({ status: 'error', message: 'No such endpoint' });
});

if (process.env.DEVVIT_EXECUTION_CONTEXT !== 'blocks') {
  const server = createServer(app);
  server.on('error', (err) => console.error(`server error; ${err.stack}`));
  server.listen(getServerPort());
}
