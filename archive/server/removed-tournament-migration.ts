/**
 * ARCHIVED — TournamentService.migrateGameSessionsToChallengeMode(), removed from
 * src/server/core/tournamentService.ts during the pre-pivot cleanup.
 *
 * A one-shot backfill that converted high-scoring entries from the all-time game-session
 * leaderboard into challenge-tower records so matchmaking had a pool to draw from. Its only
 * caller was POST /internal/form/migrate-sessions, which was never registered in devvit.json
 * and therefore never invokable — see archive/server/removed-endpoints.ts.
 *
 * If the pivot needs a similar backfill, re-derive it rather than restoring this: it writes
 * directly to `challengeTowerData` / `challengeTowers` Redis keys whose shape may change.
 *
 * This file is a record, not a module. It is outside every tsconfig project and is not
 * compiled, linted, or bundled.
 */

/**
 * MIGRATION: Convert high-scoring game sessions into challenge towers
 * Run this once to bootstrap the challenge tower system with existing sessions
 */
static async migrateGameSessionsToChallengeMode(): Promise<{ migrated: number; failed: number }> {
  try {
    const { GameDataService } = await import('./gameDataService');

    // Get all game sessions (high-score leaderboard)
    const { towers } = await GameDataService.getTowerMap(500, 0, undefined, 'all-time');

    let migrated = 0;
    let failed = 0;

    console.log(
      `[MIGRATE] Starting migration of ${towers.length} game sessions to challenge towers`
    );

    for (const session of towers) {
      try {
        if (!session.sessionId) {
          console.warn(`[MIGRATE] Skipping tower with no sessionId:`, session.userId);
          failed++;
          continue;
        }

        // Create a challenge tower entry for this session
        const towerId = `${session.userId}:${session.timestamp}:migrated`;
        const challengeTowerData = {
          towerId,
          userId: session.userId,
          score: session.score?.toString() || '0',
          timestamp: session.timestamp?.toString() || Date.now().toString(),
          gameMode: session.gameMode || 'classic',
          sessionId: session.sessionId, // Link to the actual session
        };

        // Store the challenge tower
        await redis.hSet(this.KEYS.challengeTowerData(towerId), challengeTowerData);

        // Add to user's challenge towers sorted set
        await redis.zAdd(this.KEYS.challengeTowers(session.userId), {
          member: towerId,
          score: session.score || 0,
        });

        migrated++;
        if (migrated % 50 === 0) {
          console.log(`[MIGRATE] Migrated ${migrated}/${towers.length} towers...`);
        }
      } catch (e) {
        console.error(`[MIGRATE] Failed to migrate tower for user ${session.userId}:`, e);
        failed++;
      }
    }

    console.log(`[MIGRATE] Migration complete: ${migrated} migrated, ${failed} failed`);
    return { migrated, failed };
  } catch (e) {
    console.error('[MIGRATE] Migration failed:', e);
    return { migrated: 0, failed: 1 };
  }
}
