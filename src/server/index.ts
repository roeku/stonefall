import express from 'express';
import { reddit, createServer, context, getServerPort } from '@devvit/web/server';
import { telemetryRouter } from '@devvit/analytics/server/reddit';
import type {
  GetPlayerGridResponse,
  GetTowerColorStatsResponse,
  PlaceTowerRequest,
  PlaceTowerResponse,
  RemovePlacementRequest,
  RemovePlacementResponse,
  SaveRunRequest,
  SaveRunResponse,
  BragRequest,
  BragResponse,
  GetFeedResponse,
  GetCommunityBoardResponse,
  GetPlayerBoardResponse,
} from '../shared/types/api';
import { createPost } from './core/post';
import { Runs } from './core/runs';
import { Plots } from './core/plots';
import { Admin } from './core/admin';
import { SocialService } from './core/socialService';

/**
 * The Stonefall server.
 *
 * Nine of the nineteen routes this file used to expose had no caller anywhere in the client, two
 * of them could destroy every player's data without asking who was calling, and the one that
 * saved a run trusted the client's own report of its score. What is left is the set the game
 * actually uses.
 *
 * Three rules:
 *
 * - `/api/*` is the only surface a web view can reach, so everything on it assumes a hostile
 *   caller. Nothing there trusts a number it was given, and nothing there can touch data
 *   belonging to somebody else.
 * - `/internal/*` is reachable only by the platform: menu items, forms, triggers, the scheduler.
 *   The destructive tools live there, behind a moderator-only menu and a typed confirmation.
 * - Reads never write. The board is rebuilt when a placement changes it, not when someone looks.
 */

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

/** Journeys owns /api/telemetry/*. Mounted first so nothing below can shadow it. */
app.use(telemetryRouter);

const router = express.Router();

/** Who is calling, according to Reddit. Never taken from the request body. */
const caller = async (): Promise<{ userId: string; username: string } | null> => {
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
 * Kept because it is the only way to see a client error on a real phone during playtest, and it
 * is cheap: the client only posts when something has actually logged, and the console silencer
 * suppresses everything below a warning in a production build. Bounded here so a misbehaving
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

// --- The board ------------------------------------------------------------

router.get('/api/grid/community', async (_req, res): Promise<void> => {
  const towers = await Plots.board();
  res.json({
    type: 'community_board',
    towers,
    totalCount: towers.length,
  } satisfies GetCommunityBoardResponse);
});

router.get('/api/grid/mine', async (_req, res): Promise<void> => {
  const me = await caller();
  if (!me) {
    res.json({ type: 'player_grid', grid: null, region: null } satisfies GetPlayerGridResponse);
    return;
  }
  const [grid, region] = await Promise.all([Plots.getPlot(me.userId), Plots.getRegion(me.userId)]);
  res.json({
    type: 'player_grid',
    // A player with no plot yet still has an identity, so the board can tell whose towers are
    // whose from the first visit instead of only after they have placed something.
    grid: grid ?? blankGrid(me.userId, me.username),
    region: region ? Plots.describeRegion(region) : null,
  } satisfies GetPlayerGridResponse);
});

router.get('/api/grid/mine/towers', async (_req, res): Promise<void> => {
  const me = await caller();
  if (!me) {
    res.json({
      type: 'player_board',
      grid: null,
      region: null,
      towers: [],
    } satisfies GetPlayerBoardResponse);
    return;
  }
  const grid = await Plots.getPlot(me.userId);
  const region = await Plots.getRegion(me.userId);
  res.json({
    type: 'player_board',
    grid: grid ?? blankGrid(me.userId, me.username),
    region: region ? Plots.describeRegion(region) : null,
    towers: grid ? await Plots.resolvePlot(grid) : [],
  } satisfies GetPlayerBoardResponse);
});

router.post<Record<string, never>, PlaceTowerResponse, PlaceTowerRequest>(
  '/api/grid/place',
  async (req, res): Promise<void> => {
    const me = await caller();
    if (!me) {
      res.status(401).json({ type: 'place_tower', success: false, message: 'Sign in to place.' });
      return;
    }
    const { sessionId, gridX, gridZ } = req.body ?? ({} as PlaceTowerRequest);
    const result = await Plots.place(me.userId, me.username, String(sessionId), gridX, gridZ);
    if (!result.ok) {
      res.status(409).json({ type: 'place_tower', success: false, message: result.reason });
      return;
    }
    res.json({ type: 'place_tower', success: true, grid: result.grid });
  }
);

router.post<Record<string, never>, RemovePlacementResponse, RemovePlacementRequest>(
  '/api/grid/remove',
  async (req, res): Promise<void> => {
    const me = await caller();
    if (!me) {
      res.status(401).json({
        type: 'remove_placement',
        success: false,
        message: 'Sign in to change your plot.',
      });
      return;
    }
    // The id is matched inside the caller's own plot, so this can only remove what they placed.
    const result = await Plots.remove(me.userId, String(req.body?.sessionId));
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
      colorChoice: body.colorChoice,
    });
    if (!result.ok) {
      res.status(400).json({ type: 'save_run', success: false, message: result.reason });
      return;
    }
    const { run } = result;
    // What the server computed, not what the client claimed. If a device's Math.sin puts it a
    // point or two out, this is the number that counts and the one the client will display.
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
    });
  }
);

router.get('/api/game/tower-stats', async (_req, res): Promise<void> => {
  const totals = await Runs.colorTotals();
  const total = totals.blue + totals.orange + totals.unknown;
  const pct = (n: number) => (total === 0 ? 0 : Math.round((n / total) * 100));
  res.json({
    type: 'tower_color_stats',
    totalCount: total,
    colorTotals: {
      blue: { count: totals.blue, percentage: pct(totals.blue) },
      orange: { count: totals.orange, percentage: pct(totals.orange) },
      unknown: { count: totals.unknown, percentage: pct(totals.unknown) },
    },
    leadingColor:
      totals.blue === totals.orange ? 'tie' : totals.blue > totals.orange ? 'blue' : 'orange',
  } satisfies GetTowerColorStatsResponse);
});

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
    const result = await SocialService.brag({
      sessionId: run.sessionId,
      kind: b.kind ?? 'plain',
      score: run.score,
      blocks: run.blockCount,
      perfectStreak: run.perfectCount,
      passedUsername: b.passedUsername,
      passedScore: b.passedScore,
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

// --- Internal -------------------------------------------------------------
//
// Menus, forms, triggers and the scheduler. Devvit does not expose these to web views, which is
// what makes it safe for the destructive tools to live here.

router.post('/internal/menu/post-create', async (_req, res): Promise<void> => {
  const post = await createPost();
  res.json({
    showToast: 'Stonefall post created.',
    navigateTo: `https://reddit.com/r/${context.subredditName}/comments/${post.id}`,
  });
});

router.post('/internal/menu/purge-dry-run', async (_req, res): Promise<void> => {
  const { players, placements, runs } = await Admin.dryRun();
  const legacy = await Admin.legacyCounts();
  res.json({
    showToast:
      `Would remove ${players} plots, ${placements} placed towers, ${runs} runs` +
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
  // invalidation is ever lost, and it re-applies the index trim. The job this replaces had an
  // endpoint and no cron at all, so two indexes grew without limit.
  const towers = await Plots.rebuildBoard();
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
