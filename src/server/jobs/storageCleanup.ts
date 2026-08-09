import { redis, scheduler } from '@devvit/web/server';
import { TOWER_RETENTION_SECONDS } from '../core/gameDataService';

/**
 * Reclaims Redis storage left behind by the pre-pivot data model.
 *
 * Historically every completed game wrote a `session:{id}` hash with no TTL, containing the full
 * tower geometry *and* the full replay input log, while an identical copy of the geometry also
 * went to `tower:{id}`. That is what pushed this app to 5.15 GB of its quota. New writes no
 * longer do any of that (see gameDataService), but the existing residue has to be swept.
 *
 * Two constraints shape the design:
 *
 * 1. **Devvit Redis has no SCAN or KEYS.** There is no way to enumerate `session:*`. The only
 *    record of every session ever played is `index:towers_by_time`, so that sorted set drives
 *    the walk. Anything not referenced there is unreachable and cannot be cleaned up by us.
 * 2. **A single request cannot process the whole set.** The job handles one bounded batch, saves
 *    a cursor, and reschedules itself until finished.
 *
 * Always run with `dryRun: true` first. It performs the identical walk without writing and
 * reports what it would reclaim.
 */

const STATE_KEY = 'maint:cleanup:state';

/** Members processed per invocation. Kept well under the request budget. */
const BATCH_SIZE = 250;

/** Delay before the follow-up batch, to stay clear of scheduler rate limits. */
const RESCHEDULE_DELAY_MS = 2000;

export const STORAGE_CLEANUP_JOB = 'storage-cleanup';

export type CleanupPhase = 'sessions' | 'indexes' | 'done';

export type CleanupState = {
  phase: CleanupPhase;
  /**
   * Rank-based cursor into `index:towers_by_time`.
   *
   * Rank rather than score because timestamps collide, and a score cursor either skips entries
   * that share a millisecond or loops on them. Ranks are stable here: the index is ordered by
   * timestamp ascending and new games append at the tail, so walking upward from 0 is never
   * disturbed by concurrent play. The session phase does not mutate the index.
   */
  cursor: number;
  scanned: number;
  /** Sessions whose keys were deleted outright (expired, non-keeper). */
  purged: number;
  /** Sessions kept but rewritten without replay/geometry. */
  slimmed: number;
  /** Entries in the index pointing at keys that no longer exist. */
  orphans: number;
  /** Approximate bytes reclaimed (JSON is effectively ASCII, so length ≈ bytes). */
  bytesFreed: number;
  dryRun: boolean;
  startedAt: number;
  updatedAt: number;
  finishedAt?: number;
  lastError?: string;
};

const freshState = (dryRun: boolean, now: number): CleanupState => ({
  phase: 'sessions',
  cursor: 0,
  scanned: 0,
  purged: 0,
  slimmed: 0,
  orphans: 0,
  bytesFreed: 0,
  dryRun,
  startedAt: now,
  updatedAt: now,
});

export const readCleanupState = async (): Promise<CleanupState | null> => {
  const raw = await redis.get(STATE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CleanupState;
  } catch {
    return null;
  }
};

const writeCleanupState = async (state: CleanupState): Promise<void> => {
  await redis.set(STATE_KEY, JSON.stringify(state));
};

export const clearCleanupState = async (): Promise<void> => {
  await redis.del(STATE_KEY);
};

/** zRange returns either bare members or {member, score} depending on the query. */
const memberOf = (entry: string | { member: string; score: number }): string =>
  typeof entry === 'string' ? entry : entry.member;

/**
 * Index members are `${userId}:${sessionId}`, and session ids themselves contain colons
 * (`session_{timestamp}_{counter}`), so split on the first colon only.
 */
const splitIndexMember = (member: string): { userId: string; sessionId: string } | null => {
  const idx = member.indexOf(':');
  if (idx <= 0 || idx === member.length - 1) return null;
  return { userId: member.slice(0, idx), sessionId: member.slice(idx + 1) };
};

/** Keys a player keeps indefinitely; everything else is disposable. */
const loadKeepers = async (
  userId: string,
  cache: Map<string, Set<string>>
): Promise<Set<string>> => {
  const cached = cache.get(userId);
  if (cached) return cached;

  const keepers = new Set<string>();
  try {
    const [bestScore, bestStreak] = await Promise.all([
      redis.get(`user:${userId}:best_highscore_session`),
      redis.get(`user:${userId}:best_perfect_session`),
    ]);
    if (bestScore) keepers.add(bestScore);
    if (bestStreak) keepers.add(bestStreak);
  } catch (e) {
    // On failure treat everything as a keeper -- deleting a personal best is unrecoverable,
    // wasting a little space is not.
    console.warn(`[cleanup] Could not resolve keepers for ${userId}, treating as keep:`, e);
  }

  cache.set(userId, keepers);
  return keepers;
};

const processSessionBatch = async (state: CleanupState): Promise<CleanupState> => {
  const entries = await redis.zRange(
    'index:towers_by_time',
    state.cursor,
    state.cursor + BATCH_SIZE - 1,
    { by: 'rank' }
  );

  if (!entries || entries.length === 0) {
    return { ...state, phase: 'indexes' };
  }

  const keeperCache = new Map<string, Set<string>>();
  const cutoff = Date.now() - TOWER_RETENTION_SECONDS * 1000;
  const next = { ...state };

  for (const entry of entries) {
    const member = memberOf(entry);
    const parts = splitIndexMember(member);
    next.scanned += 1;
    if (!parts) continue;

    const { userId, sessionId } = parts;
    const sessionKey = `session:${sessionId}`;
    const towerKey = `tower:${sessionId}`;

    try {
      const raw = await redis.hGet(sessionKey, 'data');
      if (!raw) {
        next.orphans += 1;
        continue;
      }

      const keepers = await loadKeepers(userId, keeperCache);
      const isKeeper = keepers.has(sessionId);

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        // Unparseable payload is pure waste regardless of keeper status.
        next.bytesFreed += raw.length;
        if (!next.dryRun) await redis.del(sessionKey);
        next.purged += 1;
        continue;
      }

      const timestamp =
        typeof parsed.endTime === 'number'
          ? parsed.endTime
          : typeof parsed.startTime === 'number'
            ? parsed.startTime
            : 0;

      if (!isKeeper && timestamp > 0 && timestamp < cutoff) {
        // Past retention and not a personal best: both keys go.
        let freed = raw.length;
        const towerRaw = await redis.hGet(towerKey, 'data');
        if (towerRaw) freed += towerRaw.length;

        next.bytesFreed += freed;
        next.purged += 1;

        if (!next.dryRun) {
          await redis.del(sessionKey);
          await redis.del(towerKey);
        }
        continue;
      }

      // Surviving session: strip the fields that should never have been persisted here.
      // The replay always goes -- it fed a verification step that had already run by the time
      // it was written, and nothing reads it back.
      const hasReplay = parsed.replayData !== undefined;
      const hasBlocks = Array.isArray(parsed.towerBlocks) && parsed.towerBlocks.length > 0;

      // Geometry only goes if `tower:{id}` still has a copy to hydrate from. This matters:
      // a session can be a keeper via `best_perfect_session` while never having been a high
      // score, in which case its tower key was given a TTL and may already have expired.
      // Stripping blocks there would destroy the last copy of that tower.
      let canDropBlocks = false;
      if (hasBlocks) {
        const towerRaw = await redis.hGet(towerKey, 'data');
        if (towerRaw) {
          try {
            const tower = JSON.parse(towerRaw) as { towerBlocks?: unknown };
            canDropBlocks = Array.isArray(tower.towerBlocks) && tower.towerBlocks.length > 0;
          } catch {
            canDropBlocks = false;
          }
        }
      }

      if (hasReplay || canDropBlocks) {
        delete parsed.replayData;
        if (canDropBlocks) {
          delete parsed.towerBlocks;
        }
        const slimmed = JSON.stringify(parsed);
        next.bytesFreed += Math.max(0, raw.length - slimmed.length);
        next.slimmed += 1;
        if (!next.dryRun) {
          await redis.hSet(sessionKey, { data: slimmed });
        }
      }

      // Non-keepers inside the retention window kept no TTL under the old code, so they would
      // still live forever. Give them one.
      if (!isKeeper && !next.dryRun) {
        const ttl = await redis.expireTime(sessionKey);
        if (ttl < 0) {
          await redis.expire(sessionKey, TOWER_RETENTION_SECONDS);
          await redis.expire(towerKey, TOWER_RETENTION_SECONDS);
        }
      }
    } catch (e) {
      console.warn(`[cleanup] Failed on session ${sessionId}:`, e);
    }
  }

  next.cursor = state.cursor + entries.length;
  // A short read means the index is exhausted.
  next.phase = entries.length < BATCH_SIZE ? 'indexes' : 'sessions';
  return next;
};

const processIndexPhase = async (state: CleanupState): Promise<CleanupState> => {
  const next = { ...state };
  const cutoff = Date.now() - TOWER_RETENTION_SECONDS * 1000;

  if (!next.dryRun) {
    // `leaderboard:tower_heights` gained a member per game ever played and was never read by
    // anything -- no zRange/zScore/zRank/zCard exists for it anywhere. It is now unused.
    await redis.del('leaderboard:tower_heights');

    // The time index is only ever queried for a single day's window, so anything past the
    // retention horizon is dead weight. Done last: the session phase walks this same set.
    await redis.zRemRangeByScore('index:towers_by_time', 0, cutoff);
  }

  next.phase = 'done';
  next.finishedAt = Date.now();
  return next;
};

/**
 * Runs one batch and reschedules itself until complete.
 *
 * `data.dryRun` starts a fresh run in reporting mode; `data.restart` discards any existing
 * cursor. Subsequent self-scheduled invocations carry neither and simply resume.
 */
export async function storageCleanupJob(event: {
  data?: { dryRun?: boolean; restart?: boolean };
}): Promise<CleanupState> {
  const now = Date.now();
  const requestedDryRun = event?.data?.dryRun === true;
  const restart = event?.data?.restart === true;

  let state = await readCleanupState();
  if (!state || restart || state.phase === 'done') {
    state = freshState(requestedDryRun, now);
  }

  try {
    state =
      state.phase === 'sessions'
        ? await processSessionBatch(state)
        : state.phase === 'indexes'
          ? await processIndexPhase(state)
          : state;
    delete state.lastError;
  } catch (e) {
    state.lastError = e instanceof Error ? e.message : String(e);
    console.error('[cleanup] Batch failed:', e);
  }

  state.updatedAt = Date.now();
  await writeCleanupState(state);

  if (state.phase !== 'done' && !state.lastError) {
    await scheduler.runJob({
      name: STORAGE_CLEANUP_JOB,
      data: {},
      runAt: new Date(Date.now() + RESCHEDULE_DELAY_MS),
    });
  } else {
    console.log(
      `[cleanup] ${state.dryRun ? 'DRY RUN' : 'RUN'} finished -- scanned ${state.scanned}, ` +
        `purged ${state.purged}, slimmed ${state.slimmed}, orphans ${state.orphans}, ` +
        `~${(state.bytesFreed / 1024 / 1024).toFixed(1)} MB reclaimable`
    );
  }

  return state;
}

/** Human-readable progress for the mod menu toast. */
export const describeCleanupState = (state: CleanupState | null): string => {
  if (!state) return 'No cleanup has been run yet.';
  const mb = (state.bytesFreed / 1024 / 1024).toFixed(1);
  const mode = state.dryRun ? 'Dry run' : 'Cleanup';
  if (state.phase === 'done') {
    return `${mode} complete — scanned ${state.scanned}, purged ${state.purged}, slimmed ${state.slimmed}, ~${mb} MB ${state.dryRun ? 'reclaimable' : 'reclaimed'}.`;
  }
  if (state.lastError) {
    return `${mode} stopped at ${state.scanned} scanned — ${state.lastError}. Re-run to resume.`;
  }
  return `${mode} in progress — ${state.scanned} scanned, ~${mb} MB so far (phase: ${state.phase}).`;
};
