import { redis, reddit, context } from '@devvit/web/server';
import {
  GameSessionData,
  UserStats,
  TowerMapEntry,
  SaveGameSessionRequest,
} from '../../shared/types/api';

export class GameDataService {
  private static readonly KEYS = {
    // User-specific keys
    userStats: (userId: string) => `user:${userId}:stats`,
    userSessions: (userId: string) => `user:${userId}:sessions`, // Will use sorted set instead of list

    // Global leaderboards
    highScoreLeaderboard: 'leaderboard:high_scores',
    perfectStreakLeaderboard: 'leaderboard:perfect_streaks',
    towerHeightLeaderboard: 'leaderboard:tower_heights',

    // Session storage
    session: (sessionId: string) => `session:${sessionId}`,

    // Tower map (for visualization)
    towerMap: 'tower_map',

    // Counters
    sessionCounter: 'counters:session_id',
    totalGamesCounter: 'counters:total_games',
  };

  /**
   * Generate a unique session ID
   */
  private static async generateSessionId(): Promise<string> {
    const counter = await redis.incrBy(this.KEYS.sessionCounter, 1);
    const timestamp = Date.now();
    return `session_${timestamp}_${counter}`;
  }

  /**
   * Get current user ID and username
   */
  private static async getCurrentUser(): Promise<{ userId: string; username: string }> {
    const { userId } = context;

    if (!userId) {
      throw new Error('User not authenticated');
    }

    // Get user information from Reddit API using the user ID
    const user = await reddit.getUserById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    return {
      userId: user.id,
      username: user.username,
    };
  }

  /**
   * Save a completed game session
   */
  static async saveGameSession(sessionRequest: SaveGameSessionRequest): Promise<string> {
    const { postId } = context;
    if (!postId) {
      throw new Error('Post ID not found in context');
    }

    const { userId, username } = await this.getCurrentUser();
    const sessionId = await this.generateSessionId();

    const sessionData: GameSessionData = {
      sessionId,
      userId,
      username,
      postId,
      ...sessionRequest.sessionData,
    };

    const timestamp = sessionData.endTime || Date.now();

    // First, save the core session data (most critical)
    await this.saveCoreSessionData(sessionId, sessionData, userId, username, timestamp);

    // Then update leaderboards and other data (with retry logic)
    await this.updateLeaderboardsAndStats(sessionId, sessionData, userId, username, timestamp);

    return sessionId;
  }

  /**
   * Save core session data with minimal transaction
   */
  private static async saveCoreSessionData(
    sessionId: string,
    sessionData: GameSessionData,
    userId: string,
    username: string,
    timestamp: number
  ): Promise<void> {
    // Simple transaction for core data only
    const txn = await redis.watch(this.KEYS.session(sessionId));
    await txn.multi();

    // Store the session data
    await txn.hSet(this.KEYS.session(sessionId), {
      data: JSON.stringify(sessionData),
      userId,
      username,
      score: sessionData.finalScore.toString(),
      blockCount: sessionData.blockCount.toString(),
      perfectStreak: sessionData.perfectStreakCount.toString(),
      timestamp: timestamp.toString(),
      gameMode: sessionData.gameMode,
    });

    // Add to user's session sorted set
    await txn.zAdd(this.KEYS.userSessions(userId), {
      member: sessionId,
      score: timestamp,
    });

    await txn.exec();
  }

  /**
   * Update leaderboards and stats with retry logic
   */
  private static async updateLeaderboardsAndStats(
    sessionId: string,
    sessionData: GameSessionData,
    userId: string,
    username: string,
    timestamp: number
  ): Promise<void> {
    const maxRetries = 3;
    let retryCount = 0;

    while (retryCount < maxRetries) {
      try {
        // Update leaderboards (atomic operations)
        await Promise.all([
          redis.zAdd(this.KEYS.highScoreLeaderboard, {
            member: `${userId}:${sessionId}`,
            score: sessionData.finalScore,
          }),
          sessionData.perfectStreakCount > 0
            ? redis.zAdd(this.KEYS.perfectStreakLeaderboard, {
                member: `${userId}:${sessionId}`,
                score: sessionData.perfectStreakCount,
              })
            : Promise.resolve(),
          redis.zAdd(this.KEYS.towerHeightLeaderboard, {
            member: `${userId}:${sessionId}`,
            score: sessionData.blockCount,
          }),
          redis.zAdd(this.KEYS.towerMap, {
            member: sessionId,
            score: sessionData.finalScore,
          }),
          redis.incrBy(this.KEYS.totalGamesCounter, 1),
        ]);

        // Store tower map data
        const towerMapEntry: TowerMapEntry = {
          sessionId,
          userId,
          username,
          score: sessionData.finalScore,
          blockCount: sessionData.blockCount,
          perfectStreak: sessionData.perfectStreakCount,
          gameMode: sessionData.gameMode,
          timestamp,
          towerBlocks: sessionData.towerBlocks,
        };

        await redis.hSet(`tower:${sessionId}`, {
          data: JSON.stringify(towerMapEntry),
        });

        // Update user statistics (separate operation)
        await this.updateUserStatsAtomic(userId, username, sessionData);

        break; // Success, exit retry loop
      } catch (error) {
        retryCount++;
        console.warn(`Retry ${retryCount}/${maxRetries} for leaderboard update:`, error);

        if (retryCount >= maxRetries) {
          console.error('Failed to update leaderboards after retries:', error);
          // Don't throw - core session data is already saved
        } else {
          // Wait before retry
          await new Promise((resolve) => setTimeout(resolve, 100 * retryCount));
        }
      }
    }
  }

  /**
   * Update user statistics atomically
   */
  private static async updateUserStatsAtomic(
    userId: string,
    username: string,
    sessionData: GameSessionData
  ): Promise<void> {
    const statsKey = this.KEYS.userStats(userId);
    const maxRetries = 3;
    let retryCount = 0;

    while (retryCount < maxRetries) {
      try {
        // Watch the stats key for changes
        const txn = await redis.watch(statsKey);

        // Get current stats
        const currentStatsData = await redis.hGet(statsKey, 'data');
        let currentStats: UserStats;

        if (currentStatsData) {
          currentStats = JSON.parse(currentStatsData);
        } else {
          currentStats = {
            userId,
            username,
            totalGames: 0,
            highScore: 0,
            bestTowerHeight: 0,
            longestPerfectStreak: 0,
            totalPerfectBlocks: 0,
            averageScore: 0,
            lastPlayed: 0,
          };
        }

        // Calculate updated stats
        const newTotalGames = currentStats.totalGames + 1;
        const newTotalScore =
          currentStats.averageScore * currentStats.totalGames + sessionData.finalScore;

        const updatedStats: UserStats = {
          ...currentStats,
          totalGames: newTotalGames,
          highScore: Math.max(currentStats.highScore, sessionData.finalScore),
          bestTowerHeight: Math.max(currentStats.bestTowerHeight, sessionData.blockCount),
          longestPerfectStreak: Math.max(
            currentStats.longestPerfectStreak,
            sessionData.perfectStreakCount
          ),
          totalPerfectBlocks: currentStats.totalPerfectBlocks + sessionData.perfectStreakCount,
          averageScore: Math.round(newTotalScore / newTotalGames),
          lastPlayed: sessionData.endTime || Date.now(),
        };

        // Execute atomic update
        await txn.multi();
        await txn.hSet(statsKey, {
          data: JSON.stringify(updatedStats),
          highScore: updatedStats.highScore.toString(),
          totalGames: updatedStats.totalGames.toString(),
          lastPlayed: updatedStats.lastPlayed.toString(),
        });

        await txn.exec();
        break; // Success, exit retry loop
      } catch (error) {
        retryCount++;
        console.warn(`Stats update retry ${retryCount}/${maxRetries}:`, error);

        if (retryCount >= maxRetries) {
          console.error('Failed to update user stats after retries:', error);
          // Don't throw - this is not critical for game save
        } else {
          // Wait before retry
          await new Promise((resolve) => setTimeout(resolve, 50 * retryCount));
        }
      }
    }
  }

  /**
   * Get user statistics and recent sessions
   */
  static async getUserStats(targetUserId?: string): Promise<{
    stats: UserStats | null;
    recentSessions: GameSessionData[];
  }> {
    try {
      const { userId } = targetUserId ? { userId: targetUserId } : await this.getCurrentUser();

      // Get user stats
      const statsData = await redis.hGet(this.KEYS.userStats(userId), 'data');
      const stats = statsData ? (JSON.parse(statsData) as UserStats) : null;

      // Get recent sessions (last 10 sessions by timestamp)
      const sessionEntries = await redis.zRange(this.KEYS.userSessions(userId), 0, 9, {
        reverse: true,
        by: 'rank',
      });
      const recentSessions: GameSessionData[] = [];

      for (const entry of sessionEntries) {
        const sessionId = typeof entry === 'string' ? entry : entry.member;
        const sessionData = await redis.hGet(this.KEYS.session(sessionId), 'data');
        if (sessionData) {
          recentSessions.push(JSON.parse(sessionData));
        }
      }

      return { stats, recentSessions };
    } catch (error) {
      // If user is not authenticated, return empty data instead of throwing
      console.log('User not authenticated for stats request:', error);
      return { stats: null, recentSessions: [] };
    }
  }

  /**
   * Get tower map data for visualization with optional spatial filtering
   */
  static async getTowerMap(
    limit: number = 100,
    offset: number = 0,
    bounds?: { minX: number; maxX: number; minZ: number; maxZ: number }
  ): Promise<{
    towers: TowerMapEntry[];
    totalCount: number;
  }> {
    // Get top towers by score
    const towerIds = await redis.zRange(this.KEYS.towerMap, offset, offset + limit - 1, {
      reverse: true,
      by: 'rank',
    });

    const towers: TowerMapEntry[] = [];

    for (const towerEntry of towerIds) {
      const towerId = typeof towerEntry === 'string' ? towerEntry : towerEntry.member;
      const towerData = await redis.hGet(`tower:${towerId}`, 'data');
      if (towerData) {
        const tower = JSON.parse(towerData) as TowerMapEntry;

        // Apply spatial filtering if bounds are provided
        if (bounds) {
          const towerX = tower.worldX ?? 0;
          const towerZ = tower.worldZ ?? 0;

          if (
            towerX >= bounds.minX &&
            towerX < bounds.maxX &&
            towerZ >= bounds.minZ &&
            towerZ < bounds.maxZ
          ) {
            towers.push(tower);
          }
        } else {
          towers.push(tower);
        }
      }
    }

    const totalCount = await redis.zCard(this.KEYS.towerMap);

    return { towers, totalCount };
  }

  /**
   * Update tower placement coordinates
   */
  static async updateTowerPlacement(
    sessionId: string,
    worldX: number,
    worldZ: number,
    gridX: number,
    gridZ: number
  ): Promise<boolean> {
    try {
      // Get existing tower data
      const towerData = await redis.hGet(`tower:${sessionId}`, 'data');
      if (!towerData) {
        throw new Error('Tower not found');
      }

      const towerEntry: TowerMapEntry = JSON.parse(towerData);

      // Update coordinates
      towerEntry.worldX = worldX;
      towerEntry.worldZ = worldZ;
      towerEntry.gridX = gridX;
      towerEntry.gridZ = gridZ;

      // Save updated data
      await redis.hSet(`tower:${sessionId}`, {
        data: JSON.stringify(towerEntry),
      });

      return true;
    } catch (error) {
      console.error('Failed to update tower placement:', error);
      return false;
    }
  }

  /**
   * Get leaderboards
   */
  static async getLeaderboards(limit: number = 10): Promise<{
    highScores: Array<{
      userId: string;
      username: string;
      score: number;
      blockCount: number;
      timestamp: number;
      sessionId: string;
    }>;
    perfectStreaks: Array<{
      userId: string;
      username: string;
      perfectStreak: number;
      score: number;
      timestamp: number;
      sessionId: string;
    }>;
  }> {
    // Get high scores - use separate calls for members and scores
    const highScoreMembers = await redis.zRange(this.KEYS.highScoreLeaderboard, 0, limit - 1, {
      reverse: true,
      by: 'rank',
    });

    const highScores = [];
    for (const memberEntry of highScoreMembers) {
      const member = typeof memberEntry === 'string' ? memberEntry : memberEntry.member;
      const [userId, sessionId] = member.split(':');

      if (userId && sessionId) {
        // Get the score for this member
        const score = await redis.zScore(this.KEYS.highScoreLeaderboard, member);
        const sessionData = await redis.hGet(this.KEYS.session(sessionId), 'data');

        if (sessionData && score !== null && score !== undefined) {
          const session = JSON.parse(sessionData) as GameSessionData;
          highScores.push({
            userId,
            username: session.username,
            score: score,
            blockCount: session.blockCount,
            timestamp: session.endTime || session.startTime,
            sessionId,
          });
        }
      }
    }

    // Get perfect streaks - use separate calls for members and scores
    const perfectStreakMembers = await redis.zRange(
      this.KEYS.perfectStreakLeaderboard,
      0,
      limit - 1,
      {
        reverse: true,
        by: 'rank',
      }
    );

    const perfectStreaks = [];
    for (const memberEntry of perfectStreakMembers) {
      const member = typeof memberEntry === 'string' ? memberEntry : memberEntry.member;
      const [userId, sessionId] = member.split(':');

      if (userId && sessionId) {
        // Get the score for this member
        const perfectStreak = await redis.zScore(this.KEYS.perfectStreakLeaderboard, member);
        const sessionData = await redis.hGet(this.KEYS.session(sessionId), 'data');

        if (sessionData && perfectStreak !== null && perfectStreak !== undefined) {
          const session = JSON.parse(sessionData) as GameSessionData;
          perfectStreaks.push({
            userId,
            username: session.username,
            perfectStreak: perfectStreak,
            score: session.finalScore,
            timestamp: session.endTime || session.startTime,
            sessionId,
          });
        }
      }
    }

    return { highScores, perfectStreaks };
  }

  /**
   * Get a specific game session by ID
   */
  static async getGameSession(sessionId: string): Promise<GameSessionData | null> {
    const sessionData = await redis.hGet(this.KEYS.session(sessionId), 'data');
    return sessionData ? JSON.parse(sessionData) : null;
  }

  /**
   * Get player's rank in the high score leaderboard
   * Returns rank (1-based) if in top 50, otherwise returns null
   */
  static async getPlayerRank(
    userId: string,
    sessionId: string
  ): Promise<{
    rank: number | null;
    totalPlayers: number;
    madeTheGrid: boolean;
    scoreToGrid: number | null;
  }> {
    const GRID_LIMIT = 50; // Top 50 make it to the grid
    const member = `${userId}:${sessionId}`;

    // Get all members in reverse order to find rank
    const allMembers = await redis.zRange(this.KEYS.highScoreLeaderboard, 0, -1, {
      reverse: true,
      by: 'rank',
    });

    // Find player's rank
    let rank: number | null = null;
    for (let i = 0; i < allMembers.length; i++) {
      const memberEntry = allMembers[i];
      if (!memberEntry) continue;
      const memberStr = typeof memberEntry === 'string' ? memberEntry : memberEntry.member;
      if (memberStr === member) {
        rank = i; // 0-based rank
        break;
      }
    }

    // Get total number of players
    const totalPlayers = await redis.zCard(this.KEYS.highScoreLeaderboard);

    let madeTheGrid = false;
    let scoreToGrid: number | null = null;
    let playerRank: number | null = null;

    if (rank !== null && rank !== undefined) {
      // Convert to 1-based rank
      playerRank = rank + 1;
      madeTheGrid = playerRank <= GRID_LIMIT;

      // If didn't make the grid, calculate score needed
      if (!madeTheGrid) {
        // Get the 50th place score (index 49)
        const gridEdgeMembers = await redis.zRange(this.KEYS.highScoreLeaderboard, 49, 49, {
          reverse: true,
          by: 'rank',
        });

        if (gridEdgeMembers.length > 0 && gridEdgeMembers[0]) {
          const gridEdgeMember =
            typeof gridEdgeMembers[0] === 'string' ? gridEdgeMembers[0] : gridEdgeMembers[0].member;
          const gridEdgeScore = await redis.zScore(this.KEYS.highScoreLeaderboard, gridEdgeMember);

          if (gridEdgeScore !== null && gridEdgeScore !== undefined) {
            // Get player's score
            const playerScore = await redis.zScore(this.KEYS.highScoreLeaderboard, member);
            if (playerScore !== null && playerScore !== undefined) {
              scoreToGrid = Math.max(0, Math.ceil(gridEdgeScore - playerScore) + 1);
            }
          }
        }
      }
    }

    return {
      rank: playerRank,
      totalPlayers,
      madeTheGrid,
      scoreToGrid,
    };
  }

  /**
   * Clear all tower data (for development/testing)
   * This clears towers, leaderboards, and session data for a fresh start
   */
  static async clearAllTowers(): Promise<void> {
    try {
      // Get all the data we need to delete (with error handling)
      let towerIds: any[] = [];
      let highScoreMembers: any[] = [];

      try {
        towerIds = await redis.zRange(this.KEYS.towerMap, 0, -1, { by: 'rank' });
      } catch (error) {
        console.log('No tower map found or error reading it:', error);
      }

      try {
        highScoreMembers = await redis.zRange(this.KEYS.highScoreLeaderboard, 0, -1, {
          by: 'rank',
        });
      } catch (error) {
        console.log('No high score leaderboard found or error reading it:', error);
      }

      // Use watch to get transaction client, then multi
      const txn = await redis.watch(this.KEYS.towerMap, this.KEYS.highScoreLeaderboard);
      await txn.multi();

      // Clear all leaderboards (this fixes the ranking issue)
      await txn.del(this.KEYS.highScoreLeaderboard);
      await txn.del(this.KEYS.perfectStreakLeaderboard);
      await txn.del(this.KEYS.towerHeightLeaderboard);

      // Clear tower map
      await txn.del(this.KEYS.towerMap);

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

  /**
   * Clear all game data (for development/testing)
   * Uses proper Redis deletion without keys() pattern matching
   */
  static async clearAllGameData(): Promise<void> {
    try {
      // First get all the data we need to delete (with error handling)
      let towerIds: any[] = [];
      let highScoreMembers: any[] = [];

      try {
        towerIds = await redis.zRange(this.KEYS.towerMap, 0, -1, { by: 'rank' });
      } catch (error) {
        console.log('No tower map found or error reading it:', error);
      }

      try {
        highScoreMembers = await redis.zRange(this.KEYS.highScoreLeaderboard, 0, -1, {
          by: 'rank',
        });
      } catch (error) {
        console.log('No high score leaderboard found or error reading it:', error);
      }

      // Use watch to get transaction client, then multi
      const txn = await redis.watch(this.KEYS.towerMap, this.KEYS.highScoreLeaderboard);
      await txn.multi();

      // Clear all leaderboards (safe deletion)
      await txn.del(this.KEYS.highScoreLeaderboard);
      await txn.del(this.KEYS.perfectStreakLeaderboard);
      await txn.del(this.KEYS.towerHeightLeaderboard);

      // Clear tower map
      await txn.del(this.KEYS.towerMap);

      // Clear counters
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
      console.log('Successfully cleared all game data');
    } catch (error) {
      console.error('Error clearing game data:', error);
      throw error;
    }
  }

  /**
   * Delete user data (for compliance with user deletion requests)
   */
  static async deleteUserData(userId: string): Promise<void> {
    // Get all user sessions first
    const sessionEntries = await redis.zRange(this.KEYS.userSessions(userId), 0, -1, {
      by: 'rank',
    });
    const sessionIds = sessionEntries.map((entry) =>
      typeof entry === 'string' ? entry : entry.member
    );

    const txn = await redis.watch(this.KEYS.userStats(userId), this.KEYS.userSessions(userId));

    await txn.multi();

    // Delete user stats and session list
    await txn.del(this.KEYS.userStats(userId));
    await txn.del(this.KEYS.userSessions(userId));

    // Remove from leaderboards and delete sessions
    for (const sessionId of sessionIds) {
      await txn.zRem(this.KEYS.highScoreLeaderboard, [`${userId}:${sessionId}`]);
      await txn.zRem(this.KEYS.perfectStreakLeaderboard, [`${userId}:${sessionId}`]);
      await txn.zRem(this.KEYS.towerHeightLeaderboard, [`${userId}:${sessionId}`]);
      await txn.zRem(this.KEYS.towerMap, [sessionId]);
      await txn.del(this.KEYS.session(sessionId));
      await txn.del(`tower:${sessionId}`);
    }

    await txn.exec();
  }
}
