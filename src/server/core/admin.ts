import { redis } from '@devvit/web/server';
import {
  BOARD_KEEPS,
  BOARD_META,
  LAND_INDEX,
  LAND_INDEX_LIMIT,
  NEXT_REGION,
  PLOT_INDEX,
  PLOT_INDEX_LIMIT,
  RELAY_CURRENT,
  SCORE_BOARD,
  boardPageKey,
  keepKey,
  plotKey,
  regionKey,
  regionOwnerKey,
  relayLobbyKey,
  relayPlayersKey,
  relayStateKey,
  runKey,
  runSavedKey,
  userKey,
} from './keys';
import { Plots } from './plots';

/**
 * The destructive tools, kept but moved.
 *
 * These used to be `DELETE /api/game/clear-all` and `DELETE /api/game/user/:userId`, sitting on
 * the same router as the gameplay endpoints with no authentication anywhere in the app and no
 * moderator check in the whole server directory. `clear-all` wiped every leaderboard, session
 * and user record; the per-user route took the victim's id straight from the URL and never
 * compared it to the caller. Both were reachable from any webview `fetch`, which means from
 * anyone with the browser console open on the post.
 *
 * They are still here because clearing Redis before a deploy is a real need. They are reachable
 * only from `/internal/*`, which Devvit does not expose to web views, behind a menu item marked
 * `forUserType: "moderator"` and a form that requires the subreddit name typed back. Same
 * capability, no longer an open door.
 *
 * On completeness: Devvit's Redis has no SCAN and no KEYS, so a purge can only reach what an
 * index points at. Everything a player owns is reachable from the plot index. Runs that were
 * never placed are not, and are left to their ninety-day expiry -- they are unreferenced rows
 * that no longer appear anywhere once the plots are gone.
 */
export const Admin = {
  /** Everyone the plot index knows about. The one enumeration path this storage engine allows. */
  async knownPlayers(): Promise<string[]> {
    const rows = await redis.zRange(PLOT_INDEX, 0, PLOT_INDEX_LIMIT - 1, {
      by: 'rank',
      reverse: true,
    });
    return (rows ?? []).map((r) => r.member);
  },

  /** What a purge would remove, without removing it. */
  async dryRun(): Promise<{ players: number; placements: number; runs: number }> {
    const players = await this.knownPlayers();
    let placements = 0;
    const runs = new Set<string>();
    for (const userId of players) {
      const grid = await Plots.getPlot(userId);
      if (!grid) continue;
      placements += grid.placements.length;
      for (const p of grid.placements) runs.add(p.sessionId);
    }
    return { players: players.length, placements, runs: runs.size };
  },

  /**
   * Remove every player's plot, region, record and placed run, and reset the shared indexes.
   *
   * Intended for clearing state before installing a version whose data model has changed, which
   * is exactly the situation this rewrite creates.
   */
  async purgeAll(): Promise<{ players: number; runs: number }> {
    const players = await this.knownPlayers();
    let runsRemoved = 0;

    for (const userId of players) {
      const grid = await Plots.getPlot(userId);
      if (grid) {
        for (const p of grid.placements) {
          await redis.del(runKey(p.sessionId), runSavedKey(p.sessionId));
          runsRemoved++;
        }
      }
      const region = await Plots.getRegion(userId);
      if (region) await redis.del(regionOwnerKey(region.rx, region.rz));
      await redis.del(plotKey(userId), userKey(userId), regionKey(userId), keepKey(userId));
    }

    // Held cells are indexed on their own, because a hold can outlive its owner's plot.
    const land = await redis.zRange(LAND_INDEX, 0, LAND_INDEX_LIMIT - 1, { by: 'rank' });
    for (const row of land ?? []) await redis.del(`cell:${row.member}`);

    const meta = (await redis.hGetAll(BOARD_META)) ?? {};
    const pages = Math.max(0, Number(meta.pages ?? 0));
    for (let i = 0; i < pages; i++) await redis.del(boardPageKey(i));

    const relay = await redis.get(RELAY_CURRENT);
    if (relay) {
      await redis.del(relayStateKey(relay), relayLobbyKey(relay), relayPlayersKey(relay));
    }

    await redis.del(
      PLOT_INDEX,
      LAND_INDEX,
      SCORE_BOARD,
      BOARD_META,
      BOARD_KEEPS,
      NEXT_REGION,
      RELAY_CURRENT
    );
    return { players: players.length, runs: runsRemoved };
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
   * Clear the keyspace the previous version wrote.
   *
   * The rewrite renamed almost everything, so a purge that only knows the new names would leave
   * the old data sitting there: readable by nothing, listed by nothing, and impossible to find
   * again because Devvit's Redis has no SCAN. Since clearing before a deploy is the reason these
   * tools exist, the tool has to know both keyspaces. Run it once after installing this version.
   *
   * `index:grids` and `index:towers_by_time` are the only handles on the old per-player and
   * per-session rows, so they are walked before they are removed.
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

  /** Remove one player's data, for a deletion request. Called with the caller's own id. */
  async purgePlayer(userId: string): Promise<void> {
    const grid = await Plots.getPlot(userId);
    if (grid) {
      for (const p of grid.placements) {
        await redis.del(runKey(p.sessionId), runSavedKey(p.sessionId));
      }
    }
    // Removing the index entry as well as the row is what the old path forgot, which left the
    // community view resolving a deleted grid on every rebuild, forever.
    await redis.zRem(PLOT_INDEX, [userId]);
    await redis.zRem(SCORE_BOARD, [userId]);
    const region = await Plots.getRegion(userId);
    if (region) await redis.del(regionOwnerKey(region.rx, region.rz));
    await redis.del(plotKey(userId), userKey(userId), regionKey(userId), keepKey(userId));
    await Plots.invalidateBoard();
  },
};
