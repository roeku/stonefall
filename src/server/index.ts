import express from 'express';
import { reddit, createServer, context, getServerPort } from '@devvit/web/server';
import { telemetryRouter } from '@devvit/analytics/server/reddit';
import type {
  BragRequest,
  BragResponse,
  EnterResponse,
  GetBoardResponse,
  GetFeedResponse,
  GetMeResponse,
  PlaceTowerRequest,
  PlaceTowerResponse,
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
 * The map is daily. Every map route works on the map of the post it was called from (see
 * `Maps.forRequest`), and anything that builds is refused on a map whose day is over.
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

// --- The board ------------------------------------------------------------

router.get('/api/board', async (_req, res): Promise<void> => {
  const map = await Maps.forRequest();
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
    const { sessionId, gridX, gridZ } = req.body ?? ({} as PlaceTowerRequest);
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
    const kind = b.kind ?? 'plain';
    let cell: { x: number; z: number } | undefined;
    if (kind === 'took' || kind === 'claimed') {
      // A cell can only be announced by the tower standing on it.
      const x = Number(b.cell?.x);
      const z = Number(b.cell?.z);
      const map = await Maps.forRequest();
      const hold =
        Number.isInteger(x) && Number.isInteger(z) ? await Plots.getHold(map.day, x, z) : null;
      if (!hold || hold.sessionId !== run.sessionId) {
        res.status(409).json({ type: 'brag', success: false, message: 'That cell is not yours.' });
        return;
      }
      cell = { x, z };
    }
    const result = await SocialService.brag({
      sessionId: run.sessionId,
      kind,
      score: run.score,
      blocks: run.blockCount,
      perfectStreak: run.perfectCount,
      faction: run.faction,
      passedUsername:
        typeof b.passedUsername === 'string' ? b.passedUsername.slice(0, 40) : undefined,
      passedScore: Number.isFinite(b.passedScore) ? Number(b.passedScore) : undefined,
      cell,
    });
    if (!result.ok) {
      res.status(409).json({ type: 'brag', success: false, message: result.reason });
      return;
    }
    res.json({ type: 'brag', success: true, record: result.record });
  }
);

router.get<Record<string, never>, GetFeedResponse>(
  '/api/social/feed',
  async (req, res): Promise<void> => {
    const limit = Math.min(24, Math.max(1, Number(req.query.limit) || 12));
    res.json({ type: 'feed', brags: await SocialService.feed(limit) });
  }
);

// --- Relay ----------------------------------------------------------------

/**
 * The post this request came from, if it is a relay post.
 *
 * `postData.kind` is the cheap answer; a stored relay row for the post is the sure one, so a
 * request whose context arrived without post data still finds its tower.
 */
const relayPost = async (): Promise<string | null> => {
  const { postId, postData } = context;
  if (!postId) return null;
  const kind = (postData as { kind?: unknown } | undefined)?.kind;
  if (kind === 'relay') return postId;
  return (await Relay.meta(postId)) ? postId : null;
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

router.get<Record<string, never>, RelayStateResponse | { type: 'relay'; state: null }>(
  '/api/relay/state',
  async (req, res): Promise<void> => {
    const postId = await relayPost();
    const me = await caller();
    const state = postId
      ? await Relay.state(postId, me?.userId ?? null, towerParam(req.query.tower))
      : null;
    res.json({ type: 'relay', state });
  }
);

router.post('/api/relay/heartbeat', async (req, res): Promise<void> => {
  const postId = await relayPost();
  const me = await caller();
  if (!postId || !me) {
    res.json({ type: 'relay', state: null });
    return;
  }
  res.json({
    type: 'relay',
    state: await Relay.heartbeat(postId, me, towerParam(req.body?.tower)),
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

router.post('/api/relay/brag', async (_req, res): Promise<void> => {
  const postId = await relayPost();
  const me = await caller();
  if (!postId || !me) {
    res.status(401).json({ type: 'relay_brag', success: false, message: 'Sign in first.' });
    return;
  }
  const result = await Relay.brag(postId, me.userId);
  if (!result.ok) {
    res.status(409).json({ type: 'relay_brag', success: false, message: result.reason });
    return;
  }
  res.json({ type: 'relay_brag', success: true });
});

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
  res.json({ status: 'ok', ...(await openDay()) });
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
  res.json({ status: 'ok', map, relay });
};
router.post('/internal/on-app-install', ensureDay);
router.post('/internal/on-app-upgrade', ensureDay);

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
  const { commentId } = req.body ?? {};
  if (typeof commentId === 'string') await SocialService.forgetComment(commentId);
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
