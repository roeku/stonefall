import { redis } from '@devvit/web/server';
import type { PlayerGrid } from '../../shared/types/api';
import { regionCoordForIndex } from '../../shared/types/worldGrid';
import {
  LAND_INDEX_LIMIT,
  LEGACY_MAP,
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
 * to their ninety-day expiry.
 */

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
