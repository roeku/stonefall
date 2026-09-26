import { redis } from '@devvit/web/server';
import type { PlayerGrid } from '../../shared/types/api';
import { regionCoordForIndex } from '../../shared/types/worldGrid';
import {
  LAND_INDEX_LIMIT,
  LEGACY_MAP,
  MAP_TTL_SECONDS,
  PLOT_INDEX_LIMIT,
  RELAY_CURRENT,
  SCORE_BOARD,
  boardKeepsKey,
  boardMetaKey,
  boardPageKey,
  cellKey,
  keepKey,
  landIndexKey,
  nextRegionKey,
  plotIndexKey,
  plotKey,
  regionKey,
  regionOwnerKey,
  relayCrewKey,
  relayLegacyLobbyKey,
  relayLegacyStateKey,
  relayMetaKey,
  relayPlayersKey,
  relaySummaryKey,
  relayTowerCountKey,
  relayTowerKey,
  runKey,
  runSavedKey,
  USER_DATA_TTL_SECONDS,
  userKey,
} from './keys';
import { Maps } from './maps';
import { Plots } from './plots';

/**
 * The destructive tools, kept but moved.
 *
 * These used to be `DELETE /api/game/clear-all` and `DELETE /api/game/user/:userId`, sitting on
 * the same router as the gameplay endpoints with no authentication anywhere in the app and no
 * moderator check in the whole server directory. They are reachable now only from `/internal/*`,
 * which Devvit does not expose to web views, behind a menu item marked `forUserType: "moderator"`
 * and a form that requires the subreddit name typed back.
 *
 * On completeness: Devvit's Redis has no SCAN and no KEYS, so a purge can only reach what an
 * index points at. Today's map is reached through its plot and land indexes; earlier days are
 * left to their fortnight's expiry, which is what bounds them anyway. The single map from before
 * maps were daily is reached through its own old indexes. Runs that were never placed are left
 * to their thirty-day expiry.
 */

/** Redis calls one retirement batch may make: well inside a request's thirty seconds. */
const RETIRE_BUDGET = 1500;

/** Members read per page of an index while retiring. */
const RETIRE_PAGE = 100;

/** Days of daily maps Redis can still hold, the live one included: MAP_TTL_SECONDS in days. */
const MAP_TTL_DAYS = Math.ceil(MAP_TTL_SECONDS / 86_400);

/** Where the retirement job got to in the daily map indexes, between batches. */
const RETIRE_CURSOR = 'migrations:retire:cursor';

/** Set once the retirement job has run to the end on this install. */
const RETIRED_FLAG = 'migrations:retired:2026-09';

const parse = <T>(raw: string | null | undefined): T | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

export const Admin = {
  /** Everyone a map's plot index knows about. The one enumeration path this storage allows. */
  async knownPlayers(map: string): Promise<string[]> {
    const rows = await redis.zRange(plotIndexKey(map), 0, PLOT_INDEX_LIMIT - 1, {
      by: 'rank',
      reverse: true,
    });
    return (rows ?? []).map((r) => r.member);
  },

  /** What a purge would remove from today's map, without removing it. */
  async dryRun(): Promise<{ players: number; placements: number; runs: number }> {
    const map = await Maps.liveDay();
    const players = await this.knownPlayers(map);
    let placements = 0;
    const runs = new Set<string>();
    for (const userId of players) {
      const grid = await Plots.getPlot(map, userId);
      if (!grid) continue;
      placements += grid.placements.length;
      for (const p of grid.placements) runs.add(p.sessionId);
    }
    return { players: players.length, placements, runs: runs.size };
  },

  /** Clear one day's map: every plot, region, keep, hold and board page, and its players. */
  async purgeMap(map: string): Promise<{ players: number; runs: number }> {
    const players = await this.knownPlayers(map);
    let runs = 0;
    for (const userId of players) {
      const grid = await Plots.getPlot(map, userId);
      for (const p of grid?.placements ?? []) {
        await redis.del(runKey(p.sessionId), runSavedKey(p.sessionId));
        runs++;
      }
      const region = await Plots.getRegion(map, userId);
      if (region) await redis.del(regionOwnerKey(map, region.rx, region.rz));
      await redis.del(
        plotKey(map, userId),
        userKey(userId),
        regionKey(map, userId),
        keepKey(map, userId)
      );
    }
    const land = await redis.zRange(landIndexKey(map), 0, LAND_INDEX_LIMIT - 1, { by: 'rank' });
    for (const row of land ?? []) {
      const [x, z] = row.member.split(',').map(Number);
      if (Number.isInteger(x) && Number.isInteger(z)) await redis.del(cellKey(map, x!, z!));
    }
    const meta = (await redis.hGetAll(boardMetaKey(map))) ?? {};
    const pages = Math.max(0, Number(meta.pages ?? 0));
    for (let i = 0; i < pages; i++) await redis.del(boardPageKey(map, i));
    await redis.del(
      plotIndexKey(map),
      landIndexKey(map),
      boardMetaKey(map),
      boardKeepsKey(map),
      nextRegionKey(map)
    );
    return { players: players.length, runs };
  },

  /** Clear the one map from before maps were daily, through its old indexes. */
  async purgeUndatedMap(): Promise<{ players: number; runs: number }> {
    const rows = await redis.zRange(LEGACY_MAP.PLOT_INDEX, 0, PLOT_INDEX_LIMIT - 1, {
      by: 'rank',
      reverse: true,
    });
    const players = (rows ?? []).map((r) => r.member);
    let runs = 0;
    for (const userId of players) {
      const grid = parse<PlayerGrid>(await redis.get(LEGACY_MAP.plot(userId)));
      for (const p of grid?.placements ?? []) {
        await redis.del(runKey(p.sessionId), runSavedKey(p.sessionId));
        runs++;
      }
      const index = Number(await redis.get(LEGACY_MAP.region(userId)));
      if (Number.isInteger(index) && index >= 0) {
        const { rx, rz } = regionCoordForIndex(index);
        await redis.del(LEGACY_MAP.regionOwner(rx, rz));
      }
      await redis.del(
        LEGACY_MAP.plot(userId),
        userKey(userId),
        LEGACY_MAP.region(userId),
        LEGACY_MAP.keep(userId)
      );
    }
    const land = await redis.zRange(LEGACY_MAP.LAND_INDEX, 0, LAND_INDEX_LIMIT - 1, {
      by: 'rank',
    });
    for (const row of land ?? []) await redis.del(LEGACY_MAP.cell(row.member));
    const meta = (await redis.hGetAll(LEGACY_MAP.BOARD_META)) ?? {};
    const pages = Math.max(0, Number(meta.pages ?? 0));
    for (let i = 0; i < pages; i++) await redis.del(LEGACY_MAP.boardPage(i));
    await redis.del(
      LEGACY_MAP.PLOT_INDEX,
      LEGACY_MAP.LAND_INDEX,
      LEGACY_MAP.BOARD_META,
      LEGACY_MAP.BOARD_KEEPS,
      LEGACY_MAP.NEXT_REGION
    );
    return { players: players.length, runs };
  },

  /** Clear today's relay post: every tower, crew, summary and player row. */
  async purgeRelay(): Promise<void> {
    const postId = await redis.get(RELAY_CURRENT);
    if (!postId) return;
    const towers = Math.max(1, Number(await redis.get(relayTowerCountKey(postId))) || 1);
    for (let n = 1; n <= towers; n++) {
      await redis.del(relayTowerKey(postId, n), relayCrewKey(postId, n));
    }
    await redis.del(
      relayMetaKey(postId),
      relayTowerCountKey(postId),
      relaySummaryKey(postId),
      relayPlayersKey(postId),
      relayLegacyStateKey(postId),
      relayLegacyLobbyKey(postId),
      RELAY_CURRENT
    );
  },

  /**
   * Clear today's map, the undated map from before, today's relay and the score table.
   *
   * Intended for clearing state before installing a version whose data model has changed. The
   * posts themselves stay; the next daily job, or the menu, opens fresh ones.
   */
  async purgeAll(): Promise<{ players: number; runs: number }> {
    const today = await this.purgeMap(await Maps.liveDay());
    const undated = await this.purgeUndatedMap();
    await this.purgeRelay();
    await redis.del(SCORE_BOARD);
    return { players: today.players + undated.players, runs: today.runs + undated.runs };
  },

  /**
   * One batch of the retirement job: removes what the app no longer uses but still names
   * players in, and starts the clock on player records written before they had one.
   *
   * None of this expires by itself: the score table (an index of player ids nothing displayed),
   * the map from before maps were daily, and the keyspace from before the rewrite. Devvit's
   * rules require a deleted account's id and name to leave the app, and expiry is how that
   * happens everywhere else (see keys.ts), so these go. Current player records are not deleted,
   * only given the expiry every write now sets, reached through every index that lists players.
   *
   * Idempotent and resumable: each source is walked from the front and its members removed as
   * they are done, or, for the live day indexes that must stay, walked from a stored offset.
   * `done` is false when the budget ran out first; the scheduler then runs another batch.
   */
  async retireBatch(): Promise<{ done: boolean; players: number }> {
    let ops = 0;
    let players = 0;
    const spent = () => ops >= RETIRE_BUDGET;
    const dropKeys = async (keys: string[]) => {
      if (keys.length === 0) return;
      ops += 1;
      await redis.del(...keys);
    };
    const expireUsers = async (ids: string[]) => {
      for (const id of ids) {
        ops += 1;
        await redis.expire(userKey(id), USER_DATA_TTL_SECONDS);
      }
      players += ids.length;
    };
    /** Walk a sorted set from the front, removing each page once it has been handled. */
    const drain = async (index: string, each: (members: string[]) => Promise<void>) => {
      while (!spent()) {
        ops += 1;
        const rows = await redis.zRange(index, 0, RETIRE_PAGE - 1, { by: 'rank' });
        const members = (rows ?? []).map((r) => r.member);
        if (members.length === 0) return true;
        await each(members);
        ops += 1;
        await redis.zRem(index, members);
      }
      return false;
    };

    // The score table: every player who ever set a best, without expiry.
    if (!(await drain(SCORE_BOARD, expireUsers))) return { done: false, players };

    // The keyspace from before the rewrite, through its two indexes.
    const grids = await drain('index:grids', async (ids) => {
      await expireUsers(ids);
      for (const id of ids) {
        await dropKeys([
          `grid:${id}`,
          `user:${id}:stats`,
          `user:${id}:sessions`,
          `user:${id}:color_preference`,
          `user:${id}:best_highscore_session`,
          `user:${id}:best_perfect_session`,
        ]);
      }
    });
    if (!grids) return { done: false, players };
    const sessions = await drain('index:towers_by_time', async (ids) => {
      await dropKeys(ids.flatMap((id) => [`session:${id}`, `tower:${id}`]));
    });
    if (!sessions) return { done: false, players };
    await dropKeys([
      'leaderboard:high_scores',
      'leaderboard:perfect_streaks',
      'leaderboard:tower_heights',
      'counters:session_id',
    ]);

    // The map from before maps were daily: its players' plots, keeps, regions and runs, then
    // its land and its board.
    const undated = await drain(LEGACY_MAP.PLOT_INDEX, async (ids) => {
      await expireUsers(ids);
      for (const userId of ids) {
        ops += 2;
        const grid = parse<PlayerGrid>(await redis.get(LEGACY_MAP.plot(userId)));
        const index = Number(await redis.get(LEGACY_MAP.region(userId)));
        const owner = Number.isInteger(index) && index >= 0 ? regionCoordForIndex(index) : null;
        await dropKeys([
          LEGACY_MAP.plot(userId),
          LEGACY_MAP.region(userId),
          LEGACY_MAP.keep(userId),
          ...(owner ? [LEGACY_MAP.regionOwner(owner.rx, owner.rz)] : []),
          ...(grid?.placements ?? []).flatMap((p) => [
            runKey(p.sessionId),
            runSavedKey(p.sessionId),
          ]),
        ]);
      }
    });
    if (!undated) return { done: false, players };
    const land = await drain(LEGACY_MAP.LAND_INDEX, async (cells) => {
      await dropKeys(cells.map((c) => LEGACY_MAP.cell(c)));
    });
    if (!land) return { done: false, players };
    ops += 1;
    const meta = (await redis.hGetAll(LEGACY_MAP.BOARD_META)) ?? {};
    const pages = Math.max(0, Number(meta.pages ?? 0));
    await dropKeys([
      ...Array.from({ length: pages }, (_, i) => LEGACY_MAP.boardPage(i)),
      LEGACY_MAP.BOARD_META,
      LEGACY_MAP.BOARD_KEEPS,
      LEGACY_MAP.NEXT_REGION,
    ]);

    // The daily maps still stored: their players' records get the expiry. These indexes are
    // live, so they are read from a saved offset rather than emptied.
    const cursor = parse<{ day: string; offset: number }>(await redis.get(RETIRE_CURSOR));
    const today = Date.now();
    for (let back = MAP_TTL_DAYS; back >= 0; back--) {
      const day = new Date(today - back * 86_400_000).toISOString().slice(0, 10);
      if (cursor && day < cursor.day) continue;
      let offset = cursor && day === cursor.day ? cursor.offset : 0;
      while (!spent()) {
        ops += 1;
        const rows = await redis.zRange(plotIndexKey(day), offset, offset + RETIRE_PAGE - 1, {
          by: 'rank',
        });
        const ids = (rows ?? []).map((r) => r.member);
        if (ids.length === 0) break;
        await expireUsers(ids);
        offset += ids.length;
      }
      if (spent()) {
        await redis.set(RETIRE_CURSOR, JSON.stringify({ day, offset }), {
          expiration: new Date(today + 86_400_000),
        });
        return { done: false, players };
      }
    }
    await redis.del(RETIRE_CURSOR);
    await redis.set(RETIRED_FLAG, String(today));
    return { done: true, players };
  },

  /** Whether the retirement job has finished on this install. */
  async retired(): Promise<boolean> {
    return (await redis.exists(RETIRED_FLAG)) > 0;
  },

  /** How much of the old keyspace is still there, for the dry run. */
  async legacyCounts(): Promise<{ grids: number; sessions: number }> {
    const grids = await redis.zRange('index:grids', 0, 4999, { by: 'rank', reverse: true });
    const sessions = await redis.zRange('index:towers_by_time', 0, 4999, {
      by: 'rank',
      reverse: true,
    });
    return { grids: (grids ?? []).length, sessions: (sessions ?? []).length };
  },

  /**
   * Clear the keyspace the pre-rewrite version wrote.
   *
   * The rewrite renamed almost everything, so a purge that only knows the new names would leave
   * the old data sitting there: readable by nothing, listed by nothing, and impossible to find
   * again because Devvit's Redis has no SCAN. `index:grids` and `index:towers_by_time` are the
   * only handles on the old per-player and per-session rows, so they are walked before they go.
   */
  async purgeLegacy(): Promise<{ grids: number; sessions: number }> {
    const gridRows = await redis.zRange('index:grids', 0, 4999, { by: 'rank', reverse: true });
    for (const row of gridRows ?? []) {
      const id = row.member;
      await redis.del(
        `grid:${id}`,
        `user:${id}:stats`,
        `user:${id}:sessions`,
        `user:${id}:color_preference`,
        `user:${id}:best_highscore_session`,
        `user:${id}:best_perfect_session`
      );
    }

    const sessionRows = await redis.zRange('index:towers_by_time', 0, 4999, {
      by: 'rank',
      reverse: true,
    });
    for (const row of sessionRows ?? []) {
      await redis.del(`session:${row.member}`, `tower:${row.member}`);
    }

    await redis.del(
      'index:grids',
      'index:towers_by_time',
      'leaderboard:high_scores',
      'leaderboard:perfect_streaks',
      'leaderboard:tower_heights',
      'counters:session_id'
    );
    return { grids: (gridRows ?? []).length, sessions: (sessionRows ?? []).length };
  },
};
