/**
 * ARCHIVED — GameDataService.clearAllTowers(), removed from
 * src/server/core/gameDataService.ts during the pre-pivot cleanup.
 *
 * Its only caller was DELETE /api/game/clear-towers, removed in the same pass
 * (see archive/server/removed-endpoints.ts).
 *
 * It is also very nearly a duplicate of GameDataService.clearAllGameData(), which is still
 * live and is the one the client's "clear all" dev action actually hits via
 * DELETE /api/game/clear-all. The two diverged only in which counter keys they delete.
 *
 * This file is a record, not a module. It is outside every tsconfig project and is not
 * compiled, linted, or bundled.
 */

/**
 * Clear all tower data (for development/testing)
 * This clears towers, leaderboards, and session data for a fresh start
 */
static async clearAllTowers(): Promise<void> {
  try {
    // Get all the data we need to delete (with safety limits to prevent response size issues)
    let towerIds: any[] = [];
    let highScoreMembers: any[] = [];

    try {
      towerIds = await redis.zRange(this.KEYS.towerMap(this.getCycleId()), 0, 99999, {
        by: 'rank',
      });
    } catch (error) {
      console.log('No tower map found or error reading it:', error);
    }

    try {
      highScoreMembers = await redis.zRange(this.KEYS.highScoreLeaderboard, 0, 99999, {
        by: 'rank',
      });
    } catch (error) {
      console.log('No high score leaderboard found or error reading it:', error);
    }

    // Use watch to get transaction client, then multi
    const txn = await redis.watch(
      this.KEYS.towerMap(this.getCycleId()),
      this.KEYS.highScoreLeaderboard
    );
    await txn.multi();

    // Clear all leaderboards (this fixes the ranking issue)
    await txn.del(this.KEYS.highScoreLeaderboard);
    await txn.del(this.KEYS.perfectStreakLeaderboard);
    await txn.del(this.KEYS.towerHeightLeaderboard);

    // Clear tower map
    await txn.del(this.KEYS.towerMap(this.getCycleId()));

    // Clear counters for fresh start
    await txn.del(this.KEYS.sessionCounter);
    await txn.del(this.KEYS.totalGamesCounter);

    // Delete individual tower data
    for (const towerEntry of towerIds) {
      const towerId = typeof towerEntry === 'string' ? towerEntry : towerEntry.member;
      if (towerId) {
        await txn.del(`tower:${towerId}`);
      }
    }

    // Delete session data from leaderboard members
    for (const memberEntry of highScoreMembers) {
      const member = typeof memberEntry === 'string' ? memberEntry : memberEntry.member;
      if (member && member.includes(':')) {
        const [userId, sessionId] = member.split(':');
        if (sessionId && userId) {
          await txn.del(this.KEYS.session(sessionId));
          await txn.del(this.KEYS.userSessions(userId));
          await txn.del(this.KEYS.userStats(userId));
        }
      }
    }

    await txn.exec();
    console.log('Successfully cleared all towers and related data');
  } catch (error) {
    console.error('Error clearing towers:', error);
    throw error;
  }
}
