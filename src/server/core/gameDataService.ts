import { redis, reddit, context } from '@devvit/web/server';
import {
  GameSessionData,
  UserStats,
  TowerMapEntry,
  SaveGameSessionRequest,
  TowerColorTotals,
} from '../../shared/types/api';
import { isPlayerColorChoice } from '../../shared/types/playerColors';
import type { PlayerColorChoice } from '../../shared/types/playerColors';

interface LeaderboardUpdateResult {
  isNewHighScore: boolean;
  previousBestScore: number | null;
  bestSessionId: string;
  bestScore: number;
  isNewPerfectStreak: boolean;
  previousBestPerfectStreak: number | null;
  bestPerfectStreak: number;
}

export class GameDataService {
  private static readonly KEYS = {
    // User-specific keys
    userStats: (userId: string) => `user:${userId}:stats`,
    userSessions: (userId: string) => `user:${userId}:sessions`, // Will use sorted set instead of list
    userColorPreference: (userId: string) => `user:${userId}:color_preference`,

    // Global leaderboards
    highScoreLeaderboard: 'leaderboard:high_scores',
    perfectStreakLeaderboard: 'leaderboard:perfect_streaks',
    towerHeightLeaderboard: 'leaderboard:tower_heights',

    // Cycle leaderboards
    cycleHighScoreLeaderboard: (cycleId: string) => `leaderboard:high_scores:${cycleId}`,
    userBestCycleScoreSession: (userId: string, cycleId: string) =>
      `user:${userId}:best_cycle_score_session:${cycleId}`,

    // Session storage
    session: (sessionId: string) => `session:${sessionId}`,

    // Tower map (for visualization)
    towerMap: (cycleId: string) => `tower_map:${cycleId}`,
    towersByTime: 'index:towers_by_time', // Sorted by timestamp
    userBestHighScoreSession: (userId: string) => `user:${userId}:best_highscore_session`,
    userBestPerfectStreakSession: (userId: string) => `user:${userId}:best_perfect_session`,

    // Counters
    sessionCounter: 'counters:session_id',
    totalGamesCounter: 'counters:total_games',
  };

  /**
   * Get current cycle ID (YYYY-MM-DD)
   */
  public static getCycleId(): string {
    const d = new Date();
    return d.toISOString().split('T')[0];
  }

  /**
   * Get previous cycle ID (YYYY-MM-DD)
   */
  public static getPreviousCycleId(): string {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
  }

  /**
   * Get cycle ID for a specific timestamp (YYYY-MM-DD)
   */
  private static getCycleIdForTimestamp(timestamp: number): string {
    const d = new Date(timestamp);
    return d.toISOString().split('T')[0];
  }

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
  static async getCurrentUser(): Promise<{ userId: string; username: string }> {
    const { userId } = context;

    if (!userId) {
      throw new Error('User not authenticated');
    }

    // In some environments (notably mobile playtests) the user profile lookup can fail
    // even when the requester is authenticated. We attempt a few fallbacks before
    // giving up so gameplay can continue for these users.
    try {
      const user = await reddit.getUserById(userId);
      if (user) {
        return {
          userId: user.id ?? userId,
          username: user.username,
        };
      }
    } catch (error) {
      console.warn('getCurrentUser: reddit.getUserById failed, attempting fallback.', error);
    }

    try {
      const username = await reddit.getCurrentUsername();
      if (username) {
        return { userId, username };
      }
    } catch (error) {
      console.warn(
        'getCurrentUser: reddit.getCurrentUsername failed, using derived username.',
        error
      );
    }

    const anonymizedId = userId.length > 8 ? `${userId.slice(0, 4)}...${userId.slice(-3)}` : userId;
    const fallbackUsername = `player-${userId.replace(/^t2_/, '')}`;
    console.warn(
      `getCurrentUser: falling back to derived username '${fallbackUsername}' for user ${anonymizedId}.`
    );

    return {
      userId,
      username: fallbackUsername,
    };
  }

  /**
   * Verify game data integrity by checking consistency across replay data and session stats
   */
  private static verifyGameReplay(sessionRequest: SaveGameSessionRequest): {
    isValid: boolean;
    computedScore: number;
    computedBlocks: number;
    computedMaxCombo: number;
    computedPerfectStreak: number;
    reason?: string;
  } {
    const { sessionData, replayData } = sessionRequest;

    // Verify replay data exists
    if (!replayData) {
      return {
        isValid: false,
        computedScore: 0,
        computedBlocks: 0,
        computedMaxCombo: 0,
        computedPerfectStreak: 0,
        reason: 'Missing replay data',
      };
    }

    // Verify replay data structure is valid
    if (!Array.isArray(replayData.inputs) || replayData.inputs.length === 0) {
      return {
        isValid: false,
        computedScore: 0,
        computedBlocks: 0,
        computedMaxCombo: 0,
        computedPerfectStreak: 0,
        reason: 'Invalid or empty inputs array in replay data',
      };
    }

    if (typeof replayData.finalScore !== 'number' || replayData.finalScore < 0) {
      return {
        isValid: false,
        computedScore: 0,
        computedBlocks: 0,
        computedMaxCombo: 0,
        computedPerfectStreak: 0,
        reason: 'Invalid finalScore in replay data',
      };
    }

    if (typeof replayData.finalTick !== 'number' || replayData.finalTick < 0) {
      return {
        isValid: false,
        computedScore: 0,
        computedBlocks: 0,
        computedMaxCombo: 0,
        computedPerfectStreak: 0,
        reason: 'Invalid finalTick in replay data',
      };
    }

    // Verify game mode consistency
    if (replayData.gameMode !== sessionData.gameMode) {
      return {
        isValid: false,
        computedScore: 0,
        computedBlocks: 0,
        computedMaxCombo: 0,
        computedPerfectStreak: 0,
        reason: 'Game mode mismatch between replay and session data',
      };
    }

    // Verify that replay data matches session data
    if (replayData.finalScore !== sessionData.finalScore) {
      return {
        isValid: false,
        computedScore: replayData.finalScore,
        computedBlocks: sessionData.blockCount,
        computedMaxCombo: sessionData.maxCombo,
        computedPerfectStreak: sessionData.perfectStreakCount,
        reason: `Score mismatch between replay (${replayData.finalScore}) and session (${sessionData.finalScore})`,
      };
    }

    // Sanity checks for impossible scores
    const MAX_REASONABLE_SCORE = 1000000; // 1 million points
    if (sessionData.finalScore > MAX_REASONABLE_SCORE) {
      return {
        isValid: false,
        computedScore: sessionData.finalScore,
        computedBlocks: sessionData.blockCount,
        computedMaxCombo: sessionData.maxCombo,
        computedPerfectStreak: sessionData.perfectStreakCount,
        reason: `Score suspiciously high: ${sessionData.finalScore}`,
      };
    }

    // Sanity checks for impossible block counts
    const MAX_REASONABLE_BLOCKS = 10000; // 10k blocks max
    const expectedBlocksMin = Math.floor(sessionData.finalScore / 200); // Rough lower bound
    const expectedBlocksMax = Math.ceil(sessionData.finalScore / 10 + 100); // Rough upper bound

    if (sessionData.blockCount > MAX_REASONABLE_BLOCKS) {
      return {
        isValid: false,
        computedScore: sessionData.finalScore,
        computedBlocks: sessionData.blockCount,
        computedMaxCombo: sessionData.maxCombo,
        computedPerfectStreak: sessionData.perfectStreakCount,
        reason: `Block count suspiciously high: ${sessionData.blockCount}`,
      };
    }

    // Verify perfect streak is not greater than block count
    if (sessionData.perfectStreakCount > sessionData.blockCount) {
      return {
        isValid: false,
        computedScore: sessionData.finalScore,
        computedBlocks: sessionData.blockCount,
        computedMaxCombo: sessionData.maxCombo,
        computedPerfectStreak: sessionData.perfectStreakCount,
        reason: `Perfect streak (${sessionData.perfectStreakCount}) cannot exceed block count (${sessionData.blockCount})`,
      };
    }

    // Verify max combo is not greater than block count
    if (sessionData.maxCombo > sessionData.blockCount) {
      return {
        isValid: false,
        computedScore: sessionData.finalScore,
        computedBlocks: sessionData.blockCount,
        computedMaxCombo: sessionData.maxCombo,
        computedPerfectStreak: sessionData.perfectStreakCount,
        reason: `Max combo (${sessionData.maxCombo}) cannot exceed block count (${sessionData.blockCount})`,
      };
    }

    // Verify tower blocks exist
    if (!Array.isArray(sessionData.towerBlocks) || sessionData.towerBlocks.length === 0) {
      return {
        isValid: false,
        computedScore: sessionData.finalScore,
        computedBlocks: sessionData.blockCount,
        computedMaxCombo: sessionData.maxCombo,
        computedPerfectStreak: sessionData.perfectStreakCount,
        reason: 'No tower blocks in session data',
      };
    }

    // Verify block count roughly matches tower blocks
    // Tower blocks should be approximately equal to blockCount (each drop adds 1 block)
    const towerBlockCount = sessionData.towerBlocks.length;
    if (Math.abs(towerBlockCount - sessionData.blockCount) > 2) {
      return {
        isValid: false,
        computedScore: sessionData.finalScore,
        computedBlocks: sessionData.blockCount,
        computedMaxCombo: sessionData.maxCombo,
        computedPerfectStreak: sessionData.perfectStreakCount,
        reason: `Tower block count (${towerBlockCount}) doesn't match claimed block count (${sessionData.blockCount})`,
      };
    }

    // All checks passed
    return {
      isValid: true,
      computedScore: sessionData.finalScore,
      computedBlocks: sessionData.blockCount,
      computedMaxCombo: sessionData.maxCombo,
      computedPerfectStreak: sessionData.perfectStreakCount,
    };
  }

  /**
   * Save a completed game session
   */
  static async saveGameSession(sessionRequest: SaveGameSessionRequest): Promise<{
    sessionId: string;
    bestSessionId: string;
    isNewHighScore: boolean;
    previousBestScore: number | null;
    bestScore: number;
    isNewPerfectStreak: boolean;
    previousBestPerfectStreak: number | null;
    bestPerfectStreak: number;
  }> {
    const { postId } = context;
    if (!postId) {
      throw new Error('Post ID not found in context');
    }

    // Verify game integrity before saving
    const verification = this.verifyGameReplay(sessionRequest);
    if (!verification.isValid) {
      console.error('Game verification failed:', verification.reason);
      throw new Error(`Invalid game data: ${verification.reason}`);
    }

    console.log(
      `✅ Game verification passed - Score: ${verification.computedScore}, Blocks: ${verification.computedBlocks}`
    );

    const { userId, username } = await this.getCurrentUser();
    const sessionId = await this.generateSessionId();

    const { playerColorChoice: requestColorChoice, ...restSessionData } =
      sessionRequest.sessionData;
    const sanitizedColorChoice = isPlayerColorChoice(requestColorChoice)
      ? requestColorChoice
      : null;

    if (sanitizedColorChoice !== null) {
      await this.setUserColorPreference(userId, sanitizedColorChoice);
    }

    const resolvedColorChoice =
      sanitizedColorChoice !== null
        ? sanitizedColorChoice
        : await this.getUserColorPreference(userId);

    const sessionData: GameSessionData = {
      sessionId,
      userId,
      username,
      postId,
      ...restSessionData,
      playerColorChoice: resolvedColorChoice ?? null,
      replayData: sessionRequest.replayData, // Store replay data for verification
    };

    const timestamp = sessionData.endTime || Date.now();

    // First, save the core session data (most critical)
    await this.saveCoreSessionData(sessionId, sessionData, userId, username, timestamp);

    // Then update leaderboards and other data (with retry logic)
    const leaderboardResult = await this.updateLeaderboardsAndStats(
      sessionId,
      sessionData,
      userId,
      username,
      timestamp
    );

    return {
      sessionId,
      bestSessionId: leaderboardResult.bestSessionId,
      isNewHighScore: leaderboardResult.isNewHighScore,
      previousBestScore: leaderboardResult.previousBestScore,
      bestScore: leaderboardResult.bestScore,
      isNewPerfectStreak: leaderboardResult.isNewPerfectStreak,
      previousBestPerfectStreak: leaderboardResult.previousBestPerfectStreak,
      bestPerfectStreak: leaderboardResult.bestPerfectStreak,
    };
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
      maxCombo: (sessionData.maxCombo ?? 0).toString(),
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
  ): Promise<LeaderboardUpdateResult> {
    const cycleId = GameDataService.getCycleIdForTimestamp(timestamp);
    const maxRetries = 3;
    let retryCount = 0;
    let lastError: unknown = null;

    while (retryCount < maxRetries) {
      try {
        const highScoreMemberKey = `${userId}:${sessionId}`;
        const bestHighScoreSessionKey = this.KEYS.userBestHighScoreSession(userId);
        const previousBestSessionId = await redis.get(bestHighScoreSessionKey);

        let previousBestScore: number | null = null;
        if (previousBestSessionId) {
          const storedScore = await redis.zScore(
            this.KEYS.highScoreLeaderboard,
            `${userId}:${previousBestSessionId}`
          );
          if (storedScore !== null && storedScore !== undefined) {
            previousBestScore = storedScore;
          }
        }

        const hasValidPreviousBest = previousBestScore !== null;
        const isNewHighScore = !hasValidPreviousBest || sessionData.finalScore > previousBestScore!;

        if (isNewHighScore) {
          if (previousBestSessionId && previousBestSessionId !== sessionId) {
            await redis.zRem(this.KEYS.highScoreLeaderboard, [
              `${userId}:${previousBestSessionId}`,
            ]);
            await redis.zRem(this.KEYS.towerMap(cycleId), [previousBestSessionId]);
            // Don't delete immediately, as it might be in a cycle leaderboard.
            // Expire after 8 days (cycle + buffer)
            await redis.expire(`tower:${previousBestSessionId}`, 86400 * 8);
          }

          await redis.zAdd(this.KEYS.highScoreLeaderboard, {
            member: highScoreMemberKey,
            score: sessionData.finalScore,
          });

          await redis.zAdd(this.KEYS.towerMap(cycleId), {
            member: sessionId,
            score: sessionData.finalScore,
          });

          await redis.set(bestHighScoreSessionKey, sessionId);
        } else if (!previousBestSessionId) {
          await redis.set(bestHighScoreSessionKey, sessionId);
        }

        // Always store the tower entry for reference (mark whether it is personal best)
        const perfectBlockCount = sessionData.perfectStreakCount;
        const towerMapEntry: TowerMapEntry = {
          sessionId,
          userId,
          username,
          score: sessionData.finalScore,
          blockCount: sessionData.blockCount,
          perfectStreak: perfectBlockCount,
          maxCombo: sessionData.maxCombo ?? 0,
          gameMode: sessionData.gameMode,
          timestamp,
          towerBlocks: sessionData.towerBlocks,
          playerColorChoice: sessionData.playerColorChoice ?? null,
          isPersonalBest: isNewHighScore,
        };

        await redis.hSet(`tower:${sessionId}`, {
          data: JSON.stringify(towerMapEntry),
        });

        if (!isNewHighScore) {
          // If not a personal best, expire it after the cycle duration (plus buffer)
          await redis.expire(`tower:${sessionId}`, 86400 * 8);
        }

        // Perfect streak leaderboard (track personal best streak per user)
        const perfectMemberKey = `${userId}:${sessionId}`;
        const bestPerfectSessionKey = this.KEYS.userBestPerfectStreakSession(userId);
        const previousBestPerfectSessionId = await redis.get(bestPerfectSessionKey);

        let previousBestPerfectStreak: number | null = null;
        if (previousBestPerfectSessionId) {
          const storedPerfect = await redis.zScore(
            this.KEYS.perfectStreakLeaderboard,
            `${userId}:${previousBestPerfectSessionId}`
          );
          if (storedPerfect !== null && storedPerfect !== undefined) {
            previousBestPerfectStreak = storedPerfect;
          }
        }

        const currentPerfectStreak = sessionData.maxCombo ?? 0;
        const hasPreviousPerfect = previousBestPerfectStreak !== null;
        const isNewPerfectStreak =
          currentPerfectStreak > 0 &&
          (!hasPreviousPerfect || currentPerfectStreak > previousBestPerfectStreak!);

        if (isNewPerfectStreak) {
          if (previousBestPerfectSessionId && previousBestPerfectSessionId !== sessionId) {
            await redis.zRem(this.KEYS.perfectStreakLeaderboard, [
              `${userId}:${previousBestPerfectSessionId}`,
            ]);
          }

          await redis.zAdd(this.KEYS.perfectStreakLeaderboard, {
            member: perfectMemberKey,
            score: currentPerfectStreak,
          });

          await redis.set(bestPerfectSessionKey, sessionId);
        } else if (!previousBestPerfectSessionId && currentPerfectStreak > 0) {
          await redis.zAdd(this.KEYS.perfectStreakLeaderboard, {
            member: perfectMemberKey,
            score: currentPerfectStreak,
          });
          await redis.set(bestPerfectSessionKey, sessionId);
        }

        // Track tower height leaderboard per session (historical)
        await redis.zAdd(this.KEYS.towerHeightLeaderboard, {
          member: `${userId}:${sessionId}`,
          score: sessionData.blockCount,
        });

        // Add to time-based index for daily stats
        await redis.zAdd(this.KEYS.towersByTime, {
          member: `${userId}:${sessionId}`,
          score: timestamp,
        });

        // Cycle Leaderboard Logic
        const cycleLeaderboardKey = this.KEYS.cycleHighScoreLeaderboard(cycleId);
        const bestCycleSessionKey = this.KEYS.userBestCycleScoreSession(userId, cycleId);

        // Always add every session to the cycle leaderboard (allow multiple per user)
        await redis.zAdd(cycleLeaderboardKey, {
          member: `${userId}:${sessionId}`,
          score: sessionData.finalScore,
        });
        await redis.expire(cycleLeaderboardKey, 86400 * 7); // Keep leaderboard for a week

        // Track personal best for the cycle (for legacy checks if needed, but not for filtering)
        const previousBestCycleSessionId = await redis.get(bestCycleSessionKey);
        let previousBestCycleScore: number | null = null;

        if (previousBestCycleSessionId) {
          const storedCycleScore = await redis.zScore(
            cycleLeaderboardKey,
            `${userId}:${previousBestCycleSessionId}`
          );
          if (storedCycleScore !== null && storedCycleScore !== undefined) {
            previousBestCycleScore = storedCycleScore;
          }
        }

        const isNewCycleBest =
          previousBestCycleScore === null || sessionData.finalScore > previousBestCycleScore;

        if (isNewCycleBest) {
          await redis.set(bestCycleSessionKey, sessionId);
          await redis.expire(bestCycleSessionKey, 86400 * 2); // Keep for 2 days
        }

        // Increment total games counter
        await redis.incrBy(this.KEYS.totalGamesCounter, 1);

        // Update user statistics separately
        await this.updateUserStatsAtomic(userId, username, sessionData);

        return {
          isNewHighScore,
          previousBestScore,
          bestSessionId: isNewHighScore ? sessionId : (previousBestSessionId ?? sessionId),
          bestScore: isNewHighScore
            ? sessionData.finalScore
            : (previousBestScore ?? sessionData.finalScore),
          isNewPerfectStreak,
          previousBestPerfectStreak,
          bestPerfectStreak: isNewPerfectStreak
            ? currentPerfectStreak
            : (previousBestPerfectStreak ?? currentPerfectStreak),
        };
      } catch (error) {
        retryCount++;
        lastError = error;
        console.warn(`Retry ${retryCount}/${maxRetries} for leaderboard update:`, error);

        if (retryCount < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 100 * retryCount));
        }
      }
    }

    console.error('Failed to update leaderboards after retries:', lastError);
    return {
      isNewHighScore: false,
      previousBestScore: null,
      bestSessionId: sessionId,
      bestScore: sessionData.finalScore,
      isNewPerfectStreak: false,
      previousBestPerfectStreak: null,
      bestPerfectStreak: sessionData.maxCombo ?? sessionData.perfectStreakCount,
    };
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
            sessionData.maxCombo ?? sessionData.perfectStreakCount
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
    bounds?: { minX: number; maxX: number; minZ: number; maxZ: number },
    type: 'all-time' | 'daily' = 'all-time',
    cycleId?: string
  ): Promise<{
    towers: TowerMapEntry[];
    totalCount: number;
  }> {
    const safeLimit = Math.max(1, limit);
    const safeOffset = Math.max(0, offset);

    // Always use the main leaderboard as the source of truth
    const leaderboardKey = this.KEYS.highScoreLeaderboard;
    const totalCount = await redis.zCard(leaderboardKey);

    if (totalCount === 0) {
      return { towers: [], totalCount: 0 };
    }

    const towers: TowerMapEntry[] = [];
    const seenUsers = new Set<string>();
    const userColorPreferenceCache = new Map<string, PlayerColorChoice | null>();

    const getCachedUserColorPreference = async (
      userId: string
    ): Promise<PlayerColorChoice | null> => {
      if (!userId) {
        return null;
      }
      if (userColorPreferenceCache.has(userId)) {
        return userColorPreferenceCache.get(userId) ?? null;
      }
      const pref = await this.getUserColorPreference(userId);
      userColorPreferenceCache.set(userId, pref ?? null);
      return pref;
    };

    // For daily view, we use the cycle leaderboard which has one entry per user per day
    if (type === 'daily') {
      const targetCycleId = cycleId || this.getCycleId();
      const cycleLeaderboardKey = this.KEYS.cycleHighScoreLeaderboard(targetCycleId);

      // 1. Get count first (cardinality is cheap)
      const dailyCount = await redis.zCard(cycleLeaderboardKey);

      if (dailyCount === 0) {
        return { towers: [], totalCount: 0 };
      }

      // 2. Fetch only the requested page, but cap to 500 to avoid response size limits
      const cappedLimit = Math.min(safeLimit, 500);
      const members = await redis.zRange(
        cycleLeaderboardKey,
        safeOffset,
        safeOffset + cappedLimit - 1,
        {
          reverse: true,
          by: 'rank',
        }
      );

      const towers: TowerMapEntry[] = [];

      // 3. Fetch details in parallel
      const promises = members.map(async (member) => {
        let towerId = typeof member === 'string' ? member : member.member;
        if (typeof towerId === 'string' && towerId.includes(':')) {
          towerId = towerId.split(':')[1];
        }

        const towerData = await redis.hGet(`tower:${towerId}`, 'data');
        if (!towerData) return null;

        try {
          const entry = JSON.parse(towerData) as TowerMapEntry;

          // Apply bounds check immediately
          if (bounds) {
            const tx = entry.worldX ?? 0;
            const tz = entry.worldZ ?? 0;
            if (tx < bounds.minX || tx >= bounds.maxX || tz < bounds.minZ || tz >= bounds.maxZ) {
              return null;
            }
          }

          // Resolve color preference
          const hasColorField = Object.prototype.hasOwnProperty.call(entry, 'playerColorChoice');
          const storedColor = isPlayerColorChoice(entry.playerColorChoice)
            ? entry.playerColorChoice
            : null;
          let resolvedColor = storedColor;

          if (entry.userId) {
            let userPreference = await getCachedUserColorPreference(entry.userId);
            if (userPreference === null && storedColor !== null) {
              await this.setUserColorPreference(entry.userId, storedColor);
              userColorPreferenceCache.set(entry.userId, storedColor);
              userPreference = storedColor;
            }
            if (userPreference !== null) {
              resolvedColor = userPreference;
            }
          }

          // Fallback to session color if needed
          if (resolvedColor === null && entry.sessionId) {
            const sessionData = await redis.hGet(this.KEYS.session(entry.sessionId), 'data');
            if (sessionData) {
              const parsedSession = JSON.parse(sessionData) as GameSessionData;
              const sessionColor = isPlayerColorChoice(parsedSession.playerColorChoice)
                ? parsedSession.playerColorChoice
                : null;
              if (sessionColor !== null) {
                resolvedColor = sessionColor;
                if (entry.userId) {
                  await this.setUserColorPreference(entry.userId, sessionColor);
                  userColorPreferenceCache.set(entry.userId, sessionColor);
                }
              }
            }
          }

          if (!hasColorField || resolvedColor !== storedColor) {
            entry.playerColorChoice = resolvedColor;
            // Async update to fix data consistency
            await redis.hSet(`tower:${entry.sessionId}`, { data: JSON.stringify(entry) });
          }

          return entry;
        } catch (e) {
          return null;
        }
      });

      const results = await Promise.all(promises);
      for (const res of results) {
        if (res) towers.push(res);
      }

      return { towers, totalCount: dailyCount };
    }

    // Standard logic for 'all-time' (efficient pagination)
    const batchSize = Math.min(Math.max(200, safeLimit), 500); // Cap batch at 500 to avoid response size limits
    let fetchStart = safeOffset;

    while (towers.length < safeLimit && fetchStart < totalCount) {
      const fetchEnd = fetchStart + batchSize - 1;
      const towerIds = await redis.zRange(leaderboardKey, fetchStart, fetchEnd, {
        reverse: true,
        by: 'rank',
      });

      if (!towerIds.length) {
        break;
      }

      fetchStart += towerIds.length;

      for (const towerEntry of towerIds) {
        const member = typeof towerEntry === 'string' ? towerEntry : towerEntry.member;

        let towerId = member;
        if (member.includes(':')) {
          const parts = member.split(':');
          if (parts.length === 2 && parts[1]) {
            towerId = parts[1];
          }
        }

        const towerData = await redis.hGet(`tower:${towerId}`, 'data');
        if (!towerData) {
          continue;
        }

        let tower: TowerMapEntry;
        try {
          tower = JSON.parse(towerData) as TowerMapEntry;
        } catch (e) {
          continue;
        }

        const hasColorField = Object.prototype.hasOwnProperty.call(tower, 'playerColorChoice');
        const storedColor = isPlayerColorChoice(tower.playerColorChoice)
          ? tower.playerColorChoice
          : null;
        let resolvedColor = storedColor;

        if (tower.userId) {
          let userPreference = await getCachedUserColorPreference(tower.userId);

          if (userPreference === null && storedColor !== null) {
            await this.setUserColorPreference(tower.userId, storedColor);
            userColorPreferenceCache.set(tower.userId, storedColor);
            userPreference = storedColor;
          }

          if (userPreference !== null) {
            resolvedColor = userPreference;
          }
        }

        if (resolvedColor === null && tower.sessionId) {
          const sessionData = await redis.hGet(this.KEYS.session(tower.sessionId), 'data');
          if (sessionData) {
            const parsedSession = JSON.parse(sessionData) as GameSessionData;
            const sessionColor = isPlayerColorChoice(parsedSession.playerColorChoice)
              ? parsedSession.playerColorChoice
              : null;

            if (sessionColor !== null) {
              resolvedColor = sessionColor;
              if (tower.userId) {
                await this.setUserColorPreference(tower.userId, sessionColor);
                userColorPreferenceCache.set(tower.userId, sessionColor);
              }
            }
          }
        }

        if (!hasColorField || resolvedColor !== storedColor) {
          tower.playerColorChoice = resolvedColor;

          await redis.hSet(`tower:${towerId}`, {
            data: JSON.stringify(tower),
          });
        }

        if (tower.userId) {
          if (seenUsers.has(tower.userId)) {
            continue;
          }
          seenUsers.add(tower.userId);
        }

        if (bounds) {
          const towerX = tower.worldX ?? 0;
          const towerZ = tower.worldZ ?? 0;
          if (
            towerX < bounds.minX ||
            towerX >= bounds.maxX ||
            towerZ < bounds.minZ ||
            towerZ >= bounds.maxZ
          ) {
            continue;
          }
        }

        towers.push(tower);

        if (towers.length >= safeLimit) {
          break;
        }
      }
    }

    return { towers, totalCount };
  }

  static async getTowerColorStats(
    type: 'all-time' | 'daily' = 'all-time',
    cycleId?: string
  ): Promise<{
    totalCount: number;
    colorTotals: TowerColorTotals;
    leadingColor: PlayerColorChoice | 'tie' | 'unknown';
  }> {
    const colorTotals: TowerColorTotals = {
      orange: { count: 0, percentage: 0 },
      blue: { count: 0, percentage: 0 },
      unknown: { count: 0, percentage: 0 },
    };

    let members: (string | { member: string; score: number })[] = [];

    if (type === 'daily') {
      const targetCycleId = cycleId || this.getCycleId();
      const startOfDay = new Date(targetCycleId).getTime();
      const endOfDay = startOfDay + 24 * 60 * 60 * 1000 - 1;

      // Use index for daily, capped at 500 to avoid Redis response size limits
      members = await redis.zRange(this.KEYS.towersByTime, startOfDay, endOfDay, {
        by: 'score',
        limit: { offset: 0, count: 500 },
      });
    } else {
      // Use main leaderboard for all-time
      // Cap to top 500 to avoid exceeding Redis response size limits
      const leaderboardKey = this.KEYS.highScoreLeaderboard;
      const count = await redis.zCard(leaderboardKey);
      if (count > 0) {
        const limit = Math.min(500, count);
        members = await redis.zRange(leaderboardKey, 0, limit - 1, {
          reverse: true,
          by: 'rank',
        });
      }
    }

    if (members.length === 0) {
      return {
        totalCount: 0,
        colorTotals,
        leadingColor: 'unknown',
      };
    }

    const userColorPreferenceCache = new Map<string, PlayerColorChoice | null>();
    let filteredTotalCount = 0;

    const BATCH_SIZE = 50;
    for (let i = 0; i < members.length; i += BATCH_SIZE) {
      const batch = members.slice(i, i + BATCH_SIZE);
      const promises = batch.map((entry) => {
        const member = typeof entry === 'string' ? entry : entry.member;
        let towerId = member;
        if (member.includes(':')) {
          const parts = member.split(':');
          if (parts.length === 2 && parts[1]) {
            towerId = parts[1];
          }
        }
        return redis.hGet(`tower:${towerId}`, 'data');
      });

      const results = await Promise.all(promises);

      for (const towerData of results) {
        if (!towerData) {
          continue;
        }

        let tower: TowerMapEntry;
        try {
          tower = JSON.parse(towerData) as TowerMapEntry;
        } catch (e) {
          continue;
        }

        filteredTotalCount++;

        const resolvedColor = await this.resolveTowerColorChoice(tower, userColorPreferenceCache);

        if (resolvedColor === 'orange') {
          colorTotals.orange.count++;
        } else if (resolvedColor === 'blue') {
          colorTotals.blue.count++;
        } else {
          colorTotals.unknown.count++;
        }
      }
    }

    const knownColorCount = colorTotals.orange.count + colorTotals.blue.count;

    if (knownColorCount > 0) {
      const orangePercent = Math.round((colorTotals.orange.count / knownColorCount) * 100);
      const bluePercent = 100 - orangePercent;

      colorTotals.orange.percentage = orangePercent;
      colorTotals.blue.percentage = bluePercent;
    } else {
      colorTotals.orange.percentage = 0;
      colorTotals.blue.percentage = 0;
    }

    const unknownBase = Math.max(filteredTotalCount, 1);
    colorTotals.unknown.percentage = Math.round((colorTotals.unknown.count / unknownBase) * 100);

    let leadingColor: PlayerColorChoice | 'tie' | 'unknown' = 'unknown';
    if (knownColorCount > 0) {
      if (colorTotals.orange.count === colorTotals.blue.count) {
        leadingColor = 'tie';
      } else {
        leadingColor = colorTotals.orange.count > colorTotals.blue.count ? 'orange' : 'blue';
      }
    } else if (filteredTotalCount > 0) {
      leadingColor = 'unknown';
    }

    return {
      totalCount: filteredTotalCount,
      colorTotals,
      leadingColor,
    };
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
      console.log(
        `[UPDATE-PLACEMENT] Updating tower placement for session ${sessionId}: world=[${worldX},${worldZ}], grid=[${gridX},${gridZ}]`
      );

      // Update session data with placement coordinates
      const sessionData = await redis.hGetAll(`session:${sessionId}`);
      if (!sessionData || Object.keys(sessionData).length === 0) {
        console.error(`[UPDATE-PLACEMENT] Session data not found for ${sessionId}`);
        return false;
      }

      try {
        const session = JSON.parse(sessionData.data || '{}');

        // Add placement coordinates to session
        session.worldX = worldX;
        session.worldZ = worldZ;
        session.gridX = gridX;
        session.gridZ = gridZ;

        console.log(
          `[UPDATE-PLACEMENT] Updated session data: world=[${session.worldX},${session.worldZ}], grid=[${session.gridX},${session.gridZ}]`
        );

        // Save updated session
        await redis.hSet(`session:${sessionId}`, {
          data: JSON.stringify(session),
        });
      } catch (e) {
        console.error(`[UPDATE-PLACEMENT] Failed to parse/update session data:`, e);
        return false;
      }

      // Also update legacy tower:{sessionId} if it exists
      const towerData = await redis.hGet(`tower:${sessionId}`, 'data');
      if (towerData) {
        try {
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
        } catch (e) {
          console.warn(`[UPDATE-PLACEMENT] Failed to update legacy tower data:`, e);
        }
      }

      console.log(`[UPDATE-PLACEMENT] ✅ Tower placement updated successfully`);
      return true;
    } catch (error) {
      console.error('[UPDATE-PLACEMENT] Failed to update tower placement:', error);
      return false;
    }
  }

  /**
   * Get leaderboards
   */
  static async getLeaderboards(
    limit: number = 10,
    type: 'all-time' | 'daily' = 'all-time'
  ): Promise<{
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
    const highScoreKey =
      type === 'daily'
        ? this.KEYS.cycleHighScoreLeaderboard(this.getCycleId())
        : this.KEYS.highScoreLeaderboard;

    // Get high scores - use separate calls for members and scores
    const highScoreMembers = await redis.zRange(highScoreKey, 0, limit - 1, {
      reverse: true,
      by: 'rank',
    });

    const highScores = [];
    for (const memberEntry of highScoreMembers) {
      const member = typeof memberEntry === 'string' ? memberEntry : memberEntry.member;
      const [userId, sessionId] = member.split(':');

      if (userId && sessionId) {
        // Get the score for this member
        const score = await redis.zScore(highScoreKey, member);
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
    // Note: Perfect streaks are currently always all-time
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
   * Import tower entries directly into Redis (for migration/seeding)
   */
  static async importTowerEntries(towers: TowerMapEntry[]): Promise<number> {
    let importedCount = 0;
    console.log(`Starting import of ${towers.length} towers`);

    for (const tower of towers) {
      try {
        // Determine cycle ID from tower timestamp, or fallback to today
        const timestamp = tower.timestamp || Date.now();
        const towerDate = new Date(timestamp);
        const cycleId = towerDate.toISOString().split('T')[0];

        // 1. Store the tower data
        await redis.hSet(`tower:${tower.sessionId}`, {
          data: JSON.stringify(tower),
        });

        // 2. Add to the specific cycle's tower map (Legacy/Fallback)
        await redis.zAdd(this.KEYS.towerMap(cycleId), {
          member: tower.sessionId,
          score: tower.score,
        });

        // 3. Add to All-Time Leaderboard (Required for default view)
        if (tower.userId) {
          const memberKey = `${tower.userId}:${tower.sessionId}`;
          await redis.zAdd(this.KEYS.highScoreLeaderboard, {
            member: memberKey,
            score: tower.score,
          });

          // 4. Add to Daily Leaderboard for that specific cycle
          await redis.zAdd(this.KEYS.cycleHighScoreLeaderboard(cycleId), {
            member: memberKey,
            score: tower.score,
          });
        }

        importedCount++;
      } catch (e) {
        console.error(`Failed to import tower ${tower.sessionId}:`, e);
      }
    }

    console.log(`Successfully imported ${importedCount} towers`);
    return importedCount;
  }

  private static async getUserColorPreference(userId: string): Promise<PlayerColorChoice | null> {
    if (!userId) {
      return null;
    }

    const value = await redis.get(this.KEYS.userColorPreference(userId));
    return isPlayerColorChoice(value) ? value : null;
  }

  private static async resolveTowerColorChoice(
    tower: TowerMapEntry,
    userColorCache: Map<string, PlayerColorChoice | null>
  ): Promise<PlayerColorChoice | null> {
    const storedColor = isPlayerColorChoice(tower.playerColorChoice)
      ? tower.playerColorChoice
      : null;
    if (storedColor) {
      if (tower.userId) {
        userColorCache.set(tower.userId, storedColor);
      }
      return storedColor;
    }

    const userId = tower.userId;
    if (userId) {
      if (userColorCache.has(userId)) {
        return userColorCache.get(userId) ?? null;
      }
      const preference = await this.getUserColorPreference(userId);
      userColorCache.set(userId, preference);
      if (preference) {
        return preference;
      }
    }

    if (tower.sessionId) {
      const sessionData = await redis.hGet(this.KEYS.session(tower.sessionId), 'data');
      if (sessionData) {
        const session = JSON.parse(sessionData) as GameSessionData;
        const sessionColor = isPlayerColorChoice(session.playerColorChoice)
          ? session.playerColorChoice
          : null;

        if (sessionColor && userId) {
          userColorCache.set(userId, sessionColor);
        }

        return sessionColor;
      }
    }

    return null;
  }

  private static async setUserColorPreference(
    userId: string,
    color: PlayerColorChoice | null
  ): Promise<void> {
    if (!userId) {
      return;
    }

    const key = this.KEYS.userColorPreference(userId);

    if (!color) {
      await redis.del(key);
      return;
    }

    await redis.set(key, color);
  }

  /**
   * Get player's rank in the high score leaderboard
   * Returns rank (1-based) if in top 50, otherwise returns null
   */
  static async getPlayerRank(
    userId: string,
    sessionId?: string
  ): Promise<{
    rank: number | null;
    totalPlayers: number;
    madeTheGrid: boolean;
    scoreToGrid: number | null;
  }> {
    const GRID_LIMIT = 50; // Top 50 make it to the grid
    const bestSessionId =
      sessionId ?? (await redis.get(this.KEYS.userBestHighScoreSession(userId)));

    if (!bestSessionId) {
      const totalPlayers = await redis.zCard(this.KEYS.highScoreLeaderboard);

      return {
        rank: null,
        totalPlayers,
        madeTheGrid: false,
        scoreToGrid: null,
      };
    }

    const member = `${userId}:${bestSessionId}`;

    // Get player's rank directly using zRank (much more efficient than fetching all members)
    const rankIndex = await redis.zRank(this.KEYS.highScoreLeaderboard, member, {
      reverse: true,
    });

    let rank: number | null = rankIndex !== null ? rankIndex : null;

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

      // Clear all leaderboards (safe deletion)
      await txn.del(this.KEYS.highScoreLeaderboard);
      await txn.del(this.KEYS.perfectStreakLeaderboard);
      await txn.del(this.KEYS.towerHeightLeaderboard);

      // Clear tower map
      await txn.del(this.KEYS.towerMap(this.getCycleId()));

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
    // Get all user sessions first (with a safety limit to prevent response size issues)
    // A single user typically won't have more than 10k sessions, but we limit to prevent abuse
    const sessionEntries = await redis.zRange(this.KEYS.userSessions(userId), 0, 9999, {
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
    await txn.del(this.KEYS.userBestHighScoreSession(userId));
    await txn.del(this.KEYS.userBestPerfectStreakSession(userId));

    // Remove from leaderboards and delete sessions
    for (const sessionId of sessionIds) {
      await txn.zRem(this.KEYS.highScoreLeaderboard, [`${userId}:${sessionId}`]);
      await txn.zRem(this.KEYS.perfectStreakLeaderboard, [`${userId}:${sessionId}`]);
      await txn.zRem(this.KEYS.towerHeightLeaderboard, [`${userId}:${sessionId}`]);
      await txn.zRem(this.KEYS.towerMap(this.getCycleId()), [sessionId]);
      await txn.del(this.KEYS.session(sessionId));
      await txn.del(`tower:${sessionId}`);
    }

    await txn.exec();
  }

  /**
   * Get top players for a specific cycle
   */
  static async getTopPlayersForCycle(
    cycleId: string,
    limit: number = 10
  ): Promise<{ username: string; score: number; sessionId: string }[]> {
    const leaderboardKey = this.KEYS.cycleHighScoreLeaderboard(cycleId);
    const topScores = await redis.zRange(leaderboardKey, 0, limit - 1, {
      by: 'rank',
      reverse: true,
    });

    const results: { username: string; score: number; sessionId: string }[] = [];

    for (const { member, score } of topScores) {
      const [userId, sessionId] = member.split(':');
      let username = 'Unknown';

      const sessionKey = this.KEYS.session(sessionId);
      const sessionUsername = await redis.hGet(sessionKey, 'username');

      if (sessionUsername) {
        username = sessionUsername;
      } else {
        try {
          const user = await reddit.getUserById(userId);
          if (user) username = user.username;
        } catch (e) {}
      }

      results.push({ username, score, sessionId });
    }

    return results;
  }
}
