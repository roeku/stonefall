import { redis, reddit, context } from '@devvit/web/server';
import {
  MAX_REPLAY_INPUTS,
  MAX_REPLAY_TICKS,
  replayRun,
} from '../../shared/simulation/runSimulation';
import type { DropInput, GameMode, GameState } from '../../shared/simulation/types';
import type { PlayerColorChoice, TowerBlock } from '../../shared/types/api';
import { isPlayerColorChoice } from '../../shared/types/playerColors';
import {
  COLOR_TOTALS,
  RUN_TTL_SECONDS,
  SCORE_BOARD,
  SCORE_BOARD_LIMIT,
  runKey,
  runSavedKey,
  userKey,
} from './keys';

/**
 * Runs: replayed, scored, and stored.
 *
 * The previous version of this called itself anti-cheat and checked nothing. It compared the
 * client's replay to the client's own summary -- `replayData.finalScore !== sessionData.
 * finalScore`, `perfectStreak > blockCount`, `|towerBlocks.length - blockCount| > 2` -- so a
 * request that simply asserted a score of 999,999 with one fake input and a few hundred stub
 * blocks agreed with itself and went straight onto the leaderboard. The deterministic simulation
 * needed to check it properly was already in the repository and had never been imported here.
 *
 * The fix is not a stricter comparison. It is to stop asking the client for the answer: the
 * server replays the recorded inputs and derives the score, the block count, the perfect count
 * and the tower geometry itself. Anything the client sends about the outcome is ignored, so
 * there is nothing left to forge. What a request can still control is the seed and the inputs,
 * and the best it can do with those is play the game well.
 *
 * This also removes the reason the old code had a floating-point problem. `calculateSlidePosition`
 * uses Math.sin, which is not guaranteed bit-identical between a phone's browser engine and
 * Node, so a strict equality check would have rejected honest players on some devices. Because
 * the server's own number is authoritative rather than compared, a divergence of a few
 * thousandths changes the score by a rounding error instead of failing the save.
 */

/** A run as the server knows it. Every field here was computed here. */
export interface StoredRun {
  sessionId: string;
  userId: string;
  username: string;
  score: number;
  blockCount: number;
  perfectCount: number;
  maxCombo: number;
  seed: number;
  gameMode: string;
  colorChoice: PlayerColorChoice | null;
  towerBlocks: TowerBlock[];
  /** Fixed-point height of the whole tower, at the same scale as block coordinates. */
  height: number;
  createdAt: number;
  postId: string | null;
}

export type SaveResult =
  | { ok: true; run: StoredRun; isPersonalBest: boolean }
  | { ok: false; reason: string };

/** Tower geometry, taken from the replayed state rather than from the request. */
const geometryOf = (state: GameState): { blocks: TowerBlock[]; height: number } => {
  let height = 0;
  const blocks = state.blocks.map((b) => {
    const top = b.y + b.height;
    if (top > height) height = top;
    return {
      x: b.x,
      y: b.y,
      z: b.z ?? 0,
      width: b.width,
      depth: b.depth ?? b.width,
      height: b.height,
      rotation: b.rotation ?? 0,
    };
  });
  return { blocks, height };
};

const readUser = async (userId: string): Promise<Record<string, string>> =>
  (await redis.hGetAll(userKey(userId))) ?? {};

export const Runs = {
  /**
   * Verify a run and store it.
   *
   * Idempotent on `sessionId`: a client that retries a save after a timeout gets the run that
   * was already stored rather than a second copy and a second increment of everything. The old
   * path had no such guard and its own retry loop could, on a partial failure, delete a player's
   * real best from the leaderboard and then promote a lower score in its place.
   */
  async save(input: {
    sessionId: string;
    seed: number;
    gameMode: string;
    inputs: ReadonlyArray<DropInput>;
    colorChoice: unknown;
  }): Promise<SaveResult> {
    if (!input.sessionId || typeof input.sessionId !== 'string') {
      return { ok: false, reason: 'Missing session id' };
    }
    if (!Number.isInteger(input.seed)) return { ok: false, reason: 'Missing seed' };
    if (!Array.isArray(input.inputs) || input.inputs.length === 0) {
      return { ok: false, reason: 'A run with no inputs is not a run' };
    }
    if (input.inputs.length > MAX_REPLAY_INPUTS) {
      return { ok: false, reason: 'Too many inputs' };
    }
    for (const i of input.inputs) {
      if (!i || !Number.isInteger(i.tick) || i.tick < 1 || i.tick > MAX_REPLAY_TICKS) {
        return { ok: false, reason: 'Malformed inputs' };
      }
    }

    const existing = await redis.get(runKey(input.sessionId));
    if (existing) {
      try {
        return { ok: true, run: JSON.parse(existing) as StoredRun, isPersonalBest: false };
      } catch {
        // Corrupt row: fall through and rebuild it.
      }
    }

    const state = replayRun(input.seed, input.gameMode as GameMode, input.inputs);
    if (!state) return { ok: false, reason: 'Replay produced nothing' };

    const user = await reddit.getCurrentUser();
    if (!user?.id) return { ok: false, reason: 'Not signed in' };

    const { blocks, height } = geometryOf(state);
    const run: StoredRun = {
      sessionId: input.sessionId,
      userId: user.id,
      username: user.username ?? 'someone',
      score: Math.max(0, Math.round(state.score)),
      blockCount: state.blocks.length,
      perfectCount: state.perfectBlockCount ?? 0,
      maxCombo: state.maxCombo ?? 0,
      seed: input.seed,
      gameMode: input.gameMode,
      colorChoice: isPlayerColorChoice(input.colorChoice as string) ? (input.colorChoice as PlayerColorChoice) : null,
      towerBlocks: blocks,
      height,
      createdAt: Date.now(),
      postId: context.postId ?? null,
    };

    await redis.set(runKey(run.sessionId), JSON.stringify(run), {
      expiration: new Date(Date.now() + RUN_TTL_SECONDS * 1000),
    });

    const isPersonalBest = await this.recordForUser(run);
    return { ok: true, run, isPersonalBest };
  },

  /**
   * Fold a run into the player's record and the score table.
   *
   * Guarded by a counted-once key so the totals cannot drift when a save is retried, which is
   * the failure the old `incrBy` on every attempt produced.
   */
  async recordForUser(run: StoredRun): Promise<boolean> {
    const guard = runSavedKey(run.sessionId);
    const already = await redis.exists(guard);
    if (already) return false;
    await redis.set(guard, '1', {
      expiration: new Date(Date.now() + RUN_TTL_SECONDS * 1000),
    });

    const prev = await readUser(run.userId);
    const prevBest = Number(prev.best ?? 0);
    const isBest = run.score > prevBest;

    await redis.hSet(userKey(run.userId), {
      username: run.username,
      runs: String(Number(prev.runs ?? 0) + 1),
      best: String(isBest ? run.score : prevBest),
      bestRun: isBest ? run.sessionId : (prev.bestRun ?? run.sessionId),
      lastSeen: String(Date.now()),
      ...(run.colorChoice ? { color: run.colorChoice } : {}),
    });

    if (isBest) {
      // A single compare-and-set on one member. The old version deleted the previous entry and
      // wrote the new one across twenty-odd untransacted commands, which is what made a
      // half-finished retry able to lose a personal best.
      await redis.zAdd(SCORE_BOARD, { member: run.userId, score: run.score });
      await redis.zRemRangeByRank(SCORE_BOARD, 0, -(SCORE_BOARD_LIMIT + 1));
    }
    return isBest;
  },

  async get(sessionId: string): Promise<StoredRun | null> {
    const raw = await redis.get(runKey(sessionId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as StoredRun;
    } catch {
      return null;
    }
  },

  /** Colour balance of what is standing, for the floor tint. Two counters, not a scan. */
  async colorTotals(): Promise<{ blue: number; orange: number; unknown: number }> {
    const h = (await redis.hGetAll(COLOR_TOTALS)) ?? {};
    return {
      blue: Math.max(0, Number(h.blue ?? 0)),
      orange: Math.max(0, Number(h.orange ?? 0)),
      unknown: Math.max(0, Number(h.unknown ?? 0)),
    };
  },

  /** Keep the colour counters in step with what is actually placed. */
  async countColor(choice: PlayerColorChoice | null, delta: 1 | -1): Promise<void> {
    const field = choice === 'blue' ? 'blue' : choice === 'orange' ? 'orange' : 'unknown';
    await redis.hIncrBy(COLOR_TOTALS, field, delta);
  },
};
