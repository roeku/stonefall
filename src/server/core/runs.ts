import { redis, reddit, context } from '@devvit/web/server';
import {
  MAX_REPLAY_INPUTS,
  MAX_REPLAY_TICKS,
  replayRun,
} from '../../shared/simulation/runSimulation';
import type { DropInput, GameMode, GameState } from '../../shared/simulation/types';
import type { FactionId, TowerBlock } from '../../shared/types/api';
import { RUN_TTL_SECONDS, runKey, runSavedKey } from './keys';
import { Users } from './users';

/**
 * Runs: replayed, scored, and stored.
 *
 * The server replays the recorded inputs and derives the score, the block count, the perfect
 * count and the tower geometry itself. Anything the client sends about the outcome is ignored,
 * so there is nothing left to forge. What a request can still control is the seed and the
 * inputs, and the best it can do with those is play the game well.
 *
 * Because the server's own number is authoritative rather than compared, a Math.sin divergence
 * of a few thousandths between a phone's browser and Node changes the score by a rounding error
 * instead of rejecting an honest player.
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
  /** The colour the player was flying when they built it. Fixed for the tower's life. */
  faction: FactionId | null;
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

export const Runs = {
  /**
   * Verify a run and store it.
   *
   * Idempotent on `sessionId`: a client that retries a save after a timeout gets the run that
   * was already stored rather than a second copy and a second increment of everything.
   */
  async save(input: {
    sessionId: string;
    seed: number;
    gameMode: string;
    inputs: ReadonlyArray<DropInput>;
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
    // Only the solo mode is a run that can be saved; a relay turn goes through Relay.drop.
    const mode: GameMode = 'rotating_block';

    const existing = await redis.get(runKey(input.sessionId));
    if (existing) {
      try {
        return { ok: true, run: JSON.parse(existing) as StoredRun, isPersonalBest: false };
      } catch {
        // Corrupt row: fall through and rebuild it.
      }
    }

    const state = replayRun(input.seed, mode, input.inputs);
    if (!state) return { ok: false, reason: 'Replay produced nothing' };

    const user = await reddit.getCurrentUser();
    if (!user?.id) return { ok: false, reason: 'Not signed in' };

    const record = await Users.read(user.id);
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
      gameMode: mode,
      faction: Users.factionFrom(record, user.id),
      towerBlocks: blocks,
      height,
      createdAt: Date.now(),
      postId: context.postId ?? null,
    };

    await redis.set(runKey(run.sessionId), JSON.stringify(run), {
      expiration: new Date(Date.now() + RUN_TTL_SECONDS * 1000),
    });

    const isPersonalBest = await this.recordForUser(run, record);
    return { ok: true, run, isPersonalBest };
  },

  /**
   * Fold a run into the player's record.
   *
   * Guarded by a counted-once key so the totals cannot drift when a save is retried.
   */
  async recordForUser(run: StoredRun, prev: Record<string, string>): Promise<boolean> {
    const guard = runSavedKey(run.sessionId);
    const already = await redis.exists(guard);
    if (already) return false;
    await redis.set(guard, '1', {
      expiration: new Date(Date.now() + RUN_TTL_SECONDS * 1000),
    });

    const prevBest = Number(prev.best ?? 0);
    const isBest = run.score > prevBest;

    await Users.write(run.userId, {
      username: run.username,
      runs: String(Number(prev.runs ?? 0) + 1),
      best: String(isBest ? run.score : prevBest),
      bestRun: isBest ? run.sessionId : (prev.bestRun ?? run.sessionId),
      lastSeen: String(Date.now()),
    });
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

  /** Several runs at once, in order, nulls where a row is missing or unreadable. */
  async getMany(sessionIds: readonly string[]): Promise<(StoredRun | null)[]> {
    if (sessionIds.length === 0) return [];
    const out: (StoredRun | null)[] = [];
    // mGet in chunks: one round trip per hundred rows instead of one per row.
    for (let i = 0; i < sessionIds.length; i += 100) {
      const chunk = sessionIds.slice(i, i + 100);
      const rows = await redis.mGet(chunk.map(runKey));
      for (const raw of rows ?? []) {
        if (!raw) {
          out.push(null);
          continue;
        }
        try {
          out.push(JSON.parse(raw) as StoredRun);
        } catch {
          out.push(null);
        }
      }
    }
    return out;
  },
};
