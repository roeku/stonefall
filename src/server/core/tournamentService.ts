import { redis, context } from '@devvit/web/server';
import { reddit } from '@devvit/web/server';
import {
  ReplayData,
  FindMatchResponse,
  ReportMatchResponse,
  TournamentStatusResponse,
  TournamentLeaderboardResponse,
  SubmitTournamentResponse,
} from '../../shared/types/api';

const BOT_REPLAY: ReplayData = {
  version: 1,
  seed: 12345,
  gameMode: 'rotating_block',
  inputs: [
    { tick: 30, type: 'move_left' },
    { tick: 60, type: 'move_right' },
    { tick: 90, type: 'rotate' },
    { tick: 120, type: 'speed_up' },
  ] as any[], // Casting as any to avoid importing DropInput type details for now, essentially a dummy replay
  finalScore: 500,
  finalTick: 300,
};

interface UserTournamentMeta {
  elo: number;
  wins: number;
  losses: number;
  tickets: number;
  lastTicketRegen: number;
  bestScore: number;
}

interface MatchLockData {
  attackerId: string;
  defenderId: string;
  defenderElo: number;
  timestamp: number;
}

export class TournamentService {
  private static readonly KEYS = {
    userMeta: (userId: string) => `u:${userId}:meta`,
    leaderboard: (seasonId: string) => `lb:${seasonId}`,
    ghost: (userId: string, seasonId: string) => `g:${userId}:${seasonId}`,
    matchHistory: (userId: string) => `m:${userId}:history`,
    seasonConfig: 'season:config',
    matchLock: (matchId: string) => `match:${matchId}:lock`,
    defeatedTowers: (seasonId: string) => `global:defeated:${seasonId}`,
    // Challenge towers: sorted set of all towers submitted in challenge mode
    challengeTowers: (userId: string) => `c:${userId}:towers`,
    challengeTowerData: (towerId: string) => `c:tower:${towerId}`,
  };

  private static readonly DEFAULTS = {
    SEASON_ID: 'season_1',
    INITIAL_ELO: 1200,
    K_FACTOR: 32,
    MAX_TICKETS: 5,
    TICKET_REGEN_MS: 3600 * 1000, // 1 hour
    MATCH_LOCK_TTL: 300, // 5 minutes to play
  };

  /**
   * Helper to get current season ID
   */
  private static async getSeasonId(): Promise<string> {
    const config = await redis.hGetAll(this.KEYS.seasonConfig);
    return config?.currentSeasonId ?? this.DEFAULTS.SEASON_ID;
  }

  /**
   * Get or initialize user metadata
   */
  private static async getUserMeta(userId: string): Promise<UserTournamentMeta> {
    const key = this.KEYS.userMeta(userId);
    const data = await redis.hGetAll(key);

    if (!data || !data.elo) {
      const initial: UserTournamentMeta = {
        elo: this.DEFAULTS.INITIAL_ELO,
        wins: 0,
        losses: 0,
        tickets: this.DEFAULTS.MAX_TICKETS,
        lastTicketRegen: Date.now(),
        bestScore: 0,
      };
      await redis.hSet(key, {
        elo: initial.elo.toString(),
        wins: initial.wins.toString(),
        losses: initial.losses.toString(),
        tickets: initial.tickets.toString(),
        lastTicketRegen: initial.lastTicketRegen.toString(),
        bestScore: initial.bestScore.toString(),
      });
      return initial;
    }

    // Calc regen tickets
    let tickets = parseInt(data.tickets);
    let lastRegen = parseInt(data.lastTicketRegen) || Date.now();
    const now = Date.now();
    const msSinceRegen = now - lastRegen;

    if (tickets < this.DEFAULTS.MAX_TICKETS && msSinceRegen >= this.DEFAULTS.TICKET_REGEN_MS) {
      const newTickets = Math.floor(msSinceRegen / this.DEFAULTS.TICKET_REGEN_MS);
      tickets = Math.min(this.DEFAULTS.MAX_TICKETS, tickets + newTickets);
      lastRegen = now;

      // Update redis lazily
      await redis.hSet(key, {
        tickets: tickets.toString(),
        lastTicketRegen: lastRegen.toString(),
      });
    }

    return {
      elo: parseInt(data.elo),
      wins: parseInt(data.wins),
      losses: parseInt(data.losses),
      tickets: tickets,
      lastTicketRegen: lastRegen,
      bestScore: parseInt(data.bestScore || '0'),
    };
  }

  /**
   * Get user's tournament status
   */
  static async getStatus(userId: string): Promise<TournamentStatusResponse> {
    const meta = await this.getUserMeta(userId);
    const seasonId = await this.getSeasonId();

    // Get rank from leaderboard
    const rankIndex = await redis.zRank(this.KEYS.leaderboard(seasonId), userId);
    const totalPlayers = await redis.zCard(this.KEYS.leaderboard(seasonId));
    const rankStr =
      rankIndex === undefined ? 'Unranked' : `#${Math.max(1, totalPlayers - rankIndex)}`;

    return {
      rank: rankStr,
      elo: meta.elo,
      tickets: meta.tickets,
      seasonId: seasonId,
      seasonEndsAt: Date.now() + 14 * 24 * 60 * 60 * 1000, // Placeholder
    };
  }

  static async getUserElo(userId: string): Promise<number> {
    const meta = await this.getUserMeta(userId);
    return meta.elo;
  }

  static async getLeaderboard(
    userId: string,
    options?: {
      view?: 'top' | 'around';
      page?: number;
      pageSize?: number;
      limit?: number;
    }
  ): Promise<TournamentLeaderboardResponse> {
    const view = options?.view === 'around' ? 'around' : 'top';
    const requestedPageSize = options?.pageSize ?? options?.limit ?? 5;
    const pageSize = Math.min(Math.max(requestedPageSize, 1), 50);
    const requestedPage = options?.page ?? 1;

    const seasonId = await this.getSeasonId();
    const leaderboardKey = this.KEYS.leaderboard(seasonId);

    const [rawRange, totalPlayers] = await Promise.all([
      redis.zRange(leaderboardKey, 0, -1),
      redis.zCard(leaderboardKey),
    ]);

    const entries = await Promise.all(
      rawRange.map(async (entry) => {
        const member = typeof entry === 'string' ? entry : entry.member;
        const score =
          typeof entry === 'string' ? await redis.zScore(leaderboardKey, member) : entry.score;
        const elo = typeof score === 'number' ? Math.round(score) : 0;

        let username = member;
        if (member.startsWith('t2_')) {
          try {
            const user = await reddit.getUserById(member as `t2_${string}`);
            if (user?.username) {
              username = user.username;
            }
          } catch {
            // Keep fallback username as member id
          }
        }

        return {
          userId: member,
          username,
          elo,
        };
      })
    );

    const sortedDesc = entries.sort((first, second) => second.elo - first.elo);
    const rankedPlayers = sortedDesc.map((entry, index) => ({
      ...entry,
      rank: index + 1,
    }));

    const currentPlayerFromRanked = rankedPlayers.find((entry) => entry.userId === userId) ?? null;

    const totalPages = Math.max(1, Math.ceil(rankedPlayers.length / pageSize));
    const page = Math.min(Math.max(requestedPage, 1), totalPages);

    let players: TournamentLeaderboardResponse['players'] = [];
    if (view === 'around' && currentPlayerFromRanked) {
      const windowSize = 2;
      const centerIndex = currentPlayerFromRanked.rank - 1;
      const startIndex = Math.max(0, Math.min(centerIndex - windowSize, rankedPlayers.length - 5));
      players = rankedPlayers.slice(startIndex, startIndex + 5);
    } else {
      const startIndex = (page - 1) * pageSize;
      players = rankedPlayers.slice(startIndex, startIndex + pageSize);
    }

    const topPlayers = players;

    const currentRankIndex = await redis.zRank(leaderboardKey, userId);
    let currentPlayer: TournamentLeaderboardResponse['currentPlayer'] = null;

    if (typeof currentRankIndex === 'number') {
      const currentEloScore = await redis.zScore(leaderboardKey, userId);
      const currentRank = Math.max(1, totalPlayers - currentRankIndex);

      let currentUsername = userId;
      if (userId.startsWith('t2_')) {
        try {
          const currentUser = await reddit.getUserById(userId as `t2_${string}`);
          if (currentUser?.username) {
            currentUsername = currentUser.username;
          }
        } catch {
          // Keep fallback
        }
      }

      currentPlayer = {
        userId,
        username: currentUsername,
        elo: typeof currentEloScore === 'number' ? Math.round(currentEloScore) : 0,
        rank: currentRank,
      };
    }

    return {
      type: 'tournament_leaderboard',
      seasonId,
      totalPlayers,
      view,
      page,
      pageSize,
      totalPages,
      players,
      topPlayers,
      currentPlayer,
    };
  }

  /**
   * Find a match
   */
  static async findMatch(userId: string): Promise<FindMatchResponse | null> {
    const meta = await this.getUserMeta(userId);

    if (meta.tickets <= 0) {
      throw new Error('No tickets available');
    }

    const seasonId = await this.getSeasonId();
    const userElo = meta.elo;

    // Get all globally defeated towers to filter them out
    const defeatedTowerIds = await this.getDefeatedTowers(seasonId);
    console.log(`[FIND-MATCH] ${defeatedTowerIds.size} towers are globally defeated`);

    // Search for opponents within range
    const range = 100; // Look for opponents +/- 100 Elo
    const minElo = userElo - range;
    const maxElo = userElo + range;

    const potentialOpponents = await redis.zRange(this.KEYS.leaderboard(seasonId), minElo, maxElo, {
      by: 'score',
      count: 20,
    });

    console.log(
      `Debug findMatch: User=${userId}, Elo=${userElo}, Range=[${minElo}-${maxElo}], Found=${potentialOpponents.length}`
    );

    // Filter self out
    const validOpponents = potentialOpponents.filter((id) => id.member !== userId);

    if (validOpponents.length === 0) {
      console.log('No opponents found in ELO range');
      return null;
    }

    // Shuffle opponents and try to find one with valid towers
    // Fisher-Yates shuffle
    for (let i = validOpponents.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [validOpponents[i], validOpponents[j]] = [validOpponents[j], validOpponents[i]];
    }

    for (const opponentEntry of validOpponents) {
      const opponentId = opponentEntry.member;

      // Check if opponent has any available challenge towers
      // Defeated status is now global, no need to pass currentUserId
      const challengeTowers = await this.getOpponentChallengeTowers(opponentId, 200);

      // Filter out defeated towers - we need undefeated towers with valid blocks
      const undefeatedTowers = challengeTowers.filter(
        (tower) => !tower.isDefeated && tower.towerBlocks && tower.towerBlocks.length > 0
      );

      console.log(
        `[FIND-MATCH] Checking opponent ${opponentId}: total=${challengeTowers.length} towers, undefeated=${undefeatedTowers.length}, defeated=${challengeTowers.filter((t) => t.isDefeated).length}`
      );

      if (undefeatedTowers.length > 0) {
        // Fetch opponent meta for bestScore
        const opponentMeta = await this.getUserMeta(opponentId);

        // Fetch opponent username
        let opponentUsername = opponentId; // Fallback to ID
        try {
          const user = await reddit.getUserById(opponentId);
          opponentUsername = user.username || opponentId;
        } catch (e) {
          console.warn(`Failed to fetch username for ${opponentId}:`, e);
        }

        // Create match lock
        const matchId = `match_${Date.now()}_${userId}_vs_${opponentId}`;
        const matchData: MatchLockData = {
          attackerId: userId,
          defenderId: opponentId,
          defenderElo: opponentEntry.score,
          timestamp: Date.now(),
        };

        await redis.set(this.KEYS.matchLock(matchId), JSON.stringify(matchData), {
          expiration: new Date(Date.now() + this.DEFAULTS.MATCH_LOCK_TTL * 1000),
        });

        console.log(
          `[FIND-MATCH] ✅ Found opponent ${opponentId} with ${undefeatedTowers.length} undefeated tower(s)`
        );

        const opponentRankIndex = await redis.zRank(this.KEYS.leaderboard(seasonId), opponentId);
        const opponentTotal = await redis.zCard(this.KEYS.leaderboard(seasonId));
        const opponentRank =
          opponentRankIndex === undefined
            ? 'Unranked'
            : `#${Math.max(1, opponentTotal - opponentRankIndex)}`;

        return {
          matchId,
          opponent: {
            userId: opponentId,
            username: opponentUsername,
            rank: opponentRank,
            elo: opponentEntry.score,
          },
        };
      }
    }

    // No opponents with available towers found - return a practice match
    console.log(
      `[FIND-MATCH] ❌ No human opponents with valid tower blocks found in range [${minElo}-${maxElo}]`
    );
    console.log(`[FIND-MATCH] 🎯 Creating practice match for user ${userId}`);

    // Create a practice match that allows the user to play and create a challenge tower
    const matchId = `match_${Date.now()}_${userId}_vs_practice`;
    const practiceMatchData: MatchLockData = {
      attackerId: userId,
      defenderId: 'practice',
      defenderElo: userElo, // Match user's ELO for fair practice
      timestamp: Date.now(),
    };

    await redis.set(this.KEYS.matchLock(matchId), JSON.stringify(practiceMatchData), {
      expiration: new Date(Date.now() + this.DEFAULTS.MATCH_LOCK_TTL * 1000),
    });

    return {
      matchId,
      opponent: {
        userId: 'practice',
        username: 'Practice Mode',
        rank: 'N/A',
        elo: userElo,
      },
      isPractice: true, // Flag to indicate this is a practice match
    };
  }

  /**
   * Submit a new best ghost for the user.
   * If the score is better than previous personal best in the season, save it.
   * Also adds the tower to the user's challenge towers collection.
   */
  static async submitGhost(
    userId: string,
    replayData: ReplayData,
    score: number,
    sessionId?: string
  ): Promise<SubmitTournamentResponse> {
    const seasonId = await this.getSeasonId();
    const meta = await this.getUserMeta(userId);

    // Create a unique tower ID for this challenge submission
    const towerId = `${userId}:${Date.now()}:${Math.random().toString(36).substr(2, 9)}`;
    const timestamp = Date.now();

    // Always add to challenge towers collection (regardless of whether it's a new best)
    const challengeTowerData = {
      towerId,
      userId,
      score: score.toString(),
      timestamp: timestamp.toString(),
      replayData: JSON.stringify(replayData),
      gameMode: replayData.gameMode,
      ...(sessionId && { sessionId }), // Store sessionId if provided
    };

    console.log(
      `[SUBMIT-GHOST] Storing challenge tower ${towerId} with sessionId: ${sessionId || 'NONE'}`
    );
    await redis.hSet(this.KEYS.challengeTowerData(towerId), challengeTowerData);
    await redis.zAdd(this.KEYS.challengeTowers(userId), { member: towerId, score: score });
    console.log(`[SUBMIT-GHOST] Challenge tower stored successfully`);

    // Check if this is an improvement
    if (score <= meta.bestScore) {
      // Ensure they are in the leaderboard anyway
      await redis.zAdd(this.KEYS.leaderboard(seasonId), { member: userId, score: meta.elo });
      return {
        success: false, // Not a new best ghost
        newElo: meta.elo,
        rank: 'Pending',
      };
    }

    const ghostKey = this.KEYS.ghost(userId, seasonId);
    const payload = JSON.stringify(replayData);

    await Promise.all([
      redis.set(ghostKey, payload),
      redis.hSet(this.KEYS.userMeta(userId), { bestScore: score.toString() }),
      redis.zAdd(this.KEYS.leaderboard(seasonId), { member: userId, score: meta.elo }),
    ]);

    return {
      success: true,
      newElo: meta.elo,
      rank: 'Pending',
    };
  }

  /**
   * Report match result and update Elo
   */
  static async reportMatch(
    userId: string,
    matchId: string,
    result: 'win' | 'loss',
    score: number,
    defeatedSessionId?: string
  ): Promise<ReportMatchResponse> {
    const lockKey = this.KEYS.matchLock(matchId);
    const lockStr = await redis.get(lockKey);

    if (!lockStr) {
      throw new Error('Invalid or expired match ID');
    }

    const matchData: MatchLockData = JSON.parse(lockStr);
    if (matchData.attackerId !== userId) {
      throw new Error('Unauthorized match report');
    }

    const meta = await this.getUserMeta(userId);
    const seasonId = await this.getSeasonId();

    // Check if this is a practice match
    const isPracticeMatch = matchData.defenderId === 'practice';

    // Consume ticket
    if (meta.tickets > 0) {
      await redis.hSet(this.KEYS.userMeta(userId), { tickets: (meta.tickets - 1).toString() });
    }

    // Cleanup match
    await redis.del(lockKey);

    // For practice matches, don't update ELO
    if (isPracticeMatch) {
      console.log(`[REPORT-MATCH] Practice match completed for ${userId}, no ELO change`);

      // Calculate rank without changing ELO
      const rankIndex = await redis.zRank(this.KEYS.leaderboard(seasonId), userId);
      const totalPlayers = await redis.zCard(this.KEYS.leaderboard(seasonId));
      const rank =
        rankIndex === undefined ? 'Unranked' : `#${Math.max(1, totalPlayers - rankIndex)}`;

      return {
        success: true,
        eloChange: 0, // No ELO change for practice
        newElo: meta.elo,
        newTickets: meta.tickets - 1,
        newRank: rank,
      };
    }

    // Regular match: Calculate and update ELO
    const Ra = meta.elo;
    const Rb = matchData.defenderElo;

    const expectedScoreA = 1 / (1 + Math.pow(10, (Rb - Ra) / 400));
    const actualScoreA = result === 'win' ? 1 : 0;

    const delta = Math.round(this.DEFAULTS.K_FACTOR * (actualScoreA - expectedScoreA));

    const newElo = Ra + delta;

    // Update User
    await redis.hSet(this.KEYS.userMeta(userId), {
      elo: newElo.toString(),
      wins: (meta.wins + (result === 'win' ? 1 : 0)).toString(),
      losses: (meta.losses + (result === 'loss' ? 1 : 0)).toString(),
    });

    // Update Leaderboard
    await redis.zAdd(this.KEYS.leaderboard(seasonId), { member: userId, score: newElo });

    // Update Defender (Dampened)
    // Defender loses small amount if they lost match
    // We don't want to punish inactive players too hard, but dynamic ladder needs movement.
    if (result === 'win') {
      // Attacker Won -> Defender Lost
      // Dampen by factor of 4
      const defenderLoss = Math.round(delta / 4);
      const newDefenderElo = Rb - defenderLoss;

      await redis.hSet(this.KEYS.userMeta(matchData.defenderId), {
        elo: newDefenderElo.toString(),
      });
      await redis.zAdd(this.KEYS.leaderboard(seasonId), {
        member: matchData.defenderId,
        score: newDefenderElo,
      });

      // Mark defeated tower as globally defeated
      // If we have the sessionId from the frontend, use it; otherwise fall back to defender user ID
      const towerIdentifier = defeatedSessionId || matchData.defenderId;
      await this.markTowerDefeated(towerIdentifier, seasonId);
    }

    // Calculate new rank after ELO update
    const rankIndex = await redis.zRank(this.KEYS.leaderboard(seasonId), userId);
    const totalPlayers = await redis.zCard(this.KEYS.leaderboard(seasonId));
    const newRank =
      rankIndex === undefined ? 'Unranked' : `#${Math.max(1, totalPlayers - rankIndex)}`;

    return {
      success: true,
      eloChange: delta,
      newElo: newElo,
      newTickets: meta.tickets - 1,
      newRank: newRank,
    };
  }

  /**
   * Mark a tower as globally defeated (defeated for all players)
   */
  static async markTowerDefeated(towerSessionId: string, seasonId: string): Promise<void> {
    const key = this.KEYS.defeatedTowers(seasonId);
    // Use Sorted Set (zAdd) as Sets (sAdd) are not supported in Devvit Redis
    await redis.zAdd(key, { member: towerSessionId, score: Date.now() });
    console.log(
      `[DEFEATED-TOWER] Globally marked tower ${towerSessionId} as defeated in season ${seasonId}`
    );
  }

  /**
   * Get list of all globally defeated tower sessionIds for a season
   */
  static async getDefeatedTowers(seasonId: string): Promise<Set<string>> {
    const key = this.KEYS.defeatedTowers(seasonId);
    try {
      // Use Sorted Set (zRange) as Sets (sMembers) are not supported
      const range = await redis.zRange(key, 0, -1);

      const members = range
        .map((entry) => {
          if (typeof entry === 'string') return entry;
          if (typeof entry === 'object' && entry !== null && 'member' in entry)
            return (entry as any).member;
          return null;
        })
        .filter((m): m is string => m !== null);

      return new Set(members);
    } catch (e) {
      console.warn('Failed to fetch globally defeated towers:', e);
      return new Set();
    }
  }

  /**
   * Get tournament towers for the leaderboard view
   * Returns all users on the tournament leaderboard with their ghost data
   */
  static async getTournamentTowers(
    userId: string,
    limit: number = 50
  ): Promise<{ userId: string; elo: number; ghostData: string | null; isDefeated: boolean }[]> {
    try {
      const seasonId = await this.getSeasonId();
      const defeatedSet = await this.getDefeatedTowers(seasonId);

      // Get top players from leaderboard
      const leaderboard = await redis
        .zRange(this.KEYS.leaderboard(seasonId), 0, limit - 1, {
          reverse: true,
        })
        .catch((err) => {
          console.error('Redis zRange error:', err);
          return [];
        });

      console.log(`Tournament towers fetch: userId=${userId}, count=${leaderboard.length}`);

      const towers = await Promise.all(
        leaderboard.map(async (entry) => {
          try {
            // Devvit zRange by rank (default) returns member names as strings if WITHSCORES is not implied/supported in this overload
            // OR checks generic return type.
            // Safely handle both string and object signature

            let opponentId: string;
            let elo = 0;

            if (typeof entry === 'string') {
              opponentId = entry;
              // If we only get the ID, we might need to fetch the score separately if we care about accurate ELO display
              // or just display 0/? for now to save bandwidth.
              // We can rely on client to handle 0 elo or do a zScore if critical.
              // For a list of 50, zScore * 50 might be slow.

              // Optimization: zRange accepts 'withScores'?
              // In Devvit redis wrapper, behaviour is inconsistent documentation-wise.
            } else if (typeof entry === 'object' && entry !== null) {
              // Handle { member: string, score: number }
              opponentId = (entry as any).member;
              elo = (entry as any).score || 0;
            } else {
              // Unknown format
              console.warn('Unknown zRange entry format:', entry);
              return null;
            }

            if (!opponentId) return null;

            // Handle Training Bot specifically
            if (opponentId === 'TrainingBot') {
              return {
                userId: opponentId,
                elo,
                ghostData: JSON.stringify(BOT_REPLAY),
                isDefeated: defeatedSet.has(opponentId),
              };
            }

            // Fetch ghost data
            const ghostKey = this.KEYS.ghost(opponentId, seasonId);
            const ghostData = await redis.get(ghostKey);

            return {
              userId: opponentId,
              elo,
              ghostData: ghostData || null,
              isDefeated: defeatedSet.has(opponentId),
            };
          } catch (innerErr) {
            console.error('Error processing leaderboard entry:', innerErr);
            return null;
          }
        })
      );

      // If the current user is not in the leaderboard list, try to fetch them explicitly
      const userInList = towers.some((t) => t && t.userId === userId);
      let userEntry: {
        userId: string;
        elo: number;
        ghostData: string | null;
        isDefeated: boolean;
      } | null = null;

      if (!userInList) {
        try {
          const score = await redis.zScore(this.KEYS.leaderboard(seasonId), userId);
          // zScore returns number | undefined
          if (typeof score === 'number') {
            const ghostKey = this.KEYS.ghost(userId, seasonId);
            const ghostData = await redis.get(ghostKey);
            userEntry = {
              userId,
              elo: score,
              ghostData: ghostData || null,
              isDefeated: false,
            };
          }
        } catch (userFetchErr) {
          console.warn('Failed to fetch self-entry for tournament:', userFetchErr);
        }
      }

      const validTowers = towers.filter((t): t is NonNullable<typeof t> => t !== null);
      if (userEntry) {
        validTowers.push(userEntry);
      }

      return validTowers;
    } catch (e) {
      console.error('Detailed Error in getTournamentTowers:', e);
      throw e;
    }
  }

  /**
   * Get user's own tournament towers (towers created during challenges/tournament)
   * Returns the user's current ghost/tower data with their ELO and metadata
   */
  static async getUserTournamentTowers(
    userId: string
  ): Promise<{ userId: string; elo: number; ghostData: string | null; isDefeated: boolean }[]> {
    try {
      const seasonId = await this.getSeasonId();
      const ghostKey = this.KEYS.ghost(userId, seasonId);

      // Get the user's ghost data (current tower)
      const ghostData = await redis.get(ghostKey);

      if (!ghostData) {
        return [];
      }

      // Get user's ELO
      const meta = await this.getUserMeta(userId);

      return [
        {
          userId: userId,
          elo: meta.elo,
          ghostData: ghostData,
          isDefeated: false, // User's own towers are never defeated for themselves
        },
      ];
    } catch (e) {
      console.error('Error fetching user tournament towers:', e);
      return [];
    }
  }

  static async getUserChallengeTowers(
    userId: string,
    limit: number = 200,
    currentUserId?: string
  ): Promise<any[]> {
    try {
      const userMeta = await this.getUserMeta(userId);
      const userElo = userMeta.elo;
      const seasonId = await this.getSeasonId();
      const defeatedTowerIds = await this.getDefeatedTowers(seasonId);

      // Get all challenge tower IDs for this user, sorted by score (descending)
      const towerIds = await redis.zRange(this.KEYS.challengeTowers(userId), 0, limit - 1, {
        reverse: true,
      });

      if (towerIds.length === 0) {
        // Fallback: use game session towers if no challenge towers exist
        console.log(`No challenge towers for user ${userId}, falling back to game sessions`);
        return this.getUserGameSessionTowers(userId, limit);
      }

      // Fetch data for each tower
      const towers = await Promise.all(
        towerIds.map(async (entry) => {
          const towerId = typeof entry === 'string' ? entry : entry.member;
          console.log(`[getUserChallengeTowers] ⏳ Loading tower: ${towerId}`);

          const towerData = await redis.hGetAll(this.KEYS.challengeTowerData(towerId));
          console.log(
            `[getUserChallengeTowers] Tower data fields: ${Object.keys(towerData).join(', ')}`
          );
          console.log(
            `[getUserChallengeTowers] Has replayData? ${!!towerData.replayData}, length: ${towerData.replayData?.length || 0}`
          );

          if (!towerData || Object.keys(towerData).length === 0) {
            console.warn(`[getUserChallengeTowers] ❌ No data found for tower ${towerId}`);
            return null;
          }

          // If sessionId is stored, fetch full session data
          if (towerData.sessionId) {
            try {
              console.log(
                `[TOWER-FETCH] Fetching session data for sessionId: ${towerData.sessionId}`
              );
              const sessionData = await redis.hGetAll(`session:${towerData.sessionId}`);
              console.log(`[TOWER-FETCH] Session data keys:`, Object.keys(sessionData));

              if (sessionData && Object.keys(sessionData).length > 0) {
                const session = JSON.parse(sessionData.data || '{}');
                console.log(
                  `[TOWER-FETCH] Parsed session - blockCount: ${session.blockCount}, towerBlocks: ${session.towerBlocks?.length || 0}`
                );

                const result = {
                  sessionId: towerData.sessionId,
                  towerId: towerData.towerId || towerId,
                  userId: towerData.userId || userId,
                  username: session.username || 'Unknown',
                  elo: userElo,
                  score: parseInt(towerData.score || '0', 10),
                  blockCount: session.blockCount || 0,
                  perfectStreak: session.perfectStreakCount || 0,
                  maxCombo: session.maxCombo || 0,
                  gameMode: towerData.gameMode || 'rotating_block',
                  timestamp: parseInt(towerData.timestamp || '0', 10),
                  towerBlocks: session.towerBlocks || [],
                  playerColorChoice: session.playerColorChoice || null,
                  replayData: towerData.replayData ? JSON.parse(towerData.replayData) : null,
                  isPersonalBest: false,
                  isDefeated: defeatedTowerIds.has(towerData.sessionId),
                };

                console.log(
                  `[getUserChallengeTowers] ✅ Tower ${towerId} loaded - score: ${result.score}, has replay: ${!!result.replayData}, seed: ${result.replayData?.seed}`
                );
                return result;
              } else {
                console.warn(`[TOWER-FETCH] No session data found for ${towerData.sessionId}`);
              }
            } catch (e) {
              console.error(
                `[TOWER-FETCH] Failed to fetch session data for ${towerData.sessionId}:`,
                e
              );
            }
          } else {
            console.warn(
              `[TOWER-FETCH] Tower ${towerId} has no sessionId stored, attempting to find from game sessions`
            );

            // Try to find the session by matching the timestamp in the towerId
            // towerId format: userId:timestamp:randomId
            const towerIdParts = towerId.split(':');
            if (towerIdParts.length >= 2) {
              const towerTimestamp = parseInt(towerIdParts[1], 10);

              // Try to find a matching session by user and timestamp
              try {
                const userSessions = await redis.zRange(`u:${userId}:sessions`, 0, -1, {
                  byScore: true,
                  rev: true,
                });

                // Look for sessions near this timestamp (within 5 minutes)
                for (const sessionId of userSessions) {
                  const sessionData = await redis.hGetAll(`session:${sessionId}`);
                  if (sessionData && sessionData.data) {
                    const session = JSON.parse(sessionData.data);
                    const sessionTime = session.endTime || session.startTime;

                    // If session time is within 5 minutes of tower time, assume it's the same
                    if (Math.abs(sessionTime - towerTimestamp) < 300000) {
                      console.log(
                        `[TOWER-FETCH] Found matching session ${sessionId} for tower ${towerId}`
                      );

                      // Update the tower data with the sessionId for future queries
                      await redis.hSet(this.KEYS.challengeTowerData(towerId), { sessionId });

                      const result = {
                        sessionId,
                        towerId: towerData.towerId || towerId,
                        userId: towerData.userId || userId,
                        username: session.username || 'Unknown',
                        elo: userElo,
                        score: parseInt(towerData.score || '0', 10),
                        blockCount: session.blockCount || 0,
                        perfectStreak: session.perfectStreakCount || 0,
                        maxCombo: session.maxCombo || 0,
                        gameMode: towerData.gameMode || 'rotating_block',
                        timestamp: parseInt(towerData.timestamp || '0', 10),
                        towerBlocks: session.towerBlocks || [],
                        playerColorChoice: session.playerColorChoice || null,
                        replayData: towerData.replayData ? JSON.parse(towerData.replayData) : null,
                        isPersonalBest: false,
                        isDefeated: defeatedTowerIds.has(sessionId),
                      };

                      console.log(
                        `[getUserChallengeTowers] ✅ Tower ${towerId} matched - score: ${result.score}, has replay: ${!!result.replayData}, seed: ${result.replayData?.seed}`
                      );
                      return result;
                    }
                  }
                }
              } catch (e) {
                console.warn(`[TOWER-FETCH] Failed to search for matching session:`, e);
              }
            }
          }

          // Fallback to basic tower data if session not found
          const fallbackResult = {
            sessionId: towerData.sessionId || towerData.towerId,
            towerId: towerData.towerId || towerId,
            userId: towerData.userId || userId,
            username: 'Unknown',
            elo: userElo,
            score: parseInt(towerData.score || '0', 10),
            blockCount: 0,
            perfectStreak: 0,
            maxCombo: 0,
            gameMode: towerData.gameMode || 'rotating_block',
            timestamp: parseInt(towerData.timestamp || '0', 10),
            towerBlocks: [],
            playerColorChoice: null,
            replayData: towerData.replayData ? JSON.parse(towerData.replayData) : null,
            isPersonalBest: false,
            isDefeated: defeatedTowerIds.has(towerData.sessionId || towerData.towerId),
          };

          console.log(
            `[getUserChallengeTowers] ⚠️ Tower ${towerId} fallback - score: ${fallbackResult.score}, has replay: ${!!fallbackResult.replayData}, seed: ${fallbackResult.replayData?.seed}`
          );
          return fallbackResult;
        })
      );

      console.log(
        `[getUserChallengeTowers] Returning ${towers.filter((t) => t).length} towers out of ${towers.length}`
      );
      return towers.filter((t): t is NonNullable<typeof t> => t !== null);
    } catch (e) {
      console.error('Error fetching user challenge towers:', e);
      return [];
    }
  }

  /**
   * Get opponent's challenge towers (all towers submitted in challenge mode by opponent)
   * Falls back to game session towers if no challenge towers exist
   * Returns array of full TowerMapEntry objects with all rendering data
   */
  static async getOpponentChallengeTowers(
    opponentUserId: string,
    limit: number = 200,
    currentUserId?: string
  ): Promise<any[]> {
    try {
      const opponentMeta = await this.getUserMeta(opponentUserId);
      const opponentElo = opponentMeta.elo;

      // Get globally defeated towers for this season
      const seasonId = await this.getSeasonId();
      const defeatedTowerIds = await this.getDefeatedTowers(seasonId);
      console.log(
        `[getOpponentChallengeTowers] Globally defeated towers:`,
        Array.from(defeatedTowerIds)
      );

      // Get all challenge tower IDs for opponent, sorted by score (descending)
      const towerIds = await redis.zRange(this.KEYS.challengeTowers(opponentUserId), 0, limit - 1, {
        reverse: true,
      });

      if (towerIds.length === 0) {
        // Fallback: use game session towers if no challenge towers exist
        console.log(
          `No challenge towers for opponent ${opponentUserId}, falling back to game sessions`
        );
        return this.getOpponentGameSessionTowers(opponentUserId, limit);
      }

      // Fetch data for each tower
      const towers = await Promise.all(
        towerIds.map(async (entry) => {
          const towerId = typeof entry === 'string' ? entry : entry.member;
          console.log(`[getOpponentChallengeTowers] ⏳ Loading opponent tower: ${towerId}`);

          const towerData = await redis.hGetAll(this.KEYS.challengeTowerData(towerId));
          console.log(
            `[getOpponentChallengeTowers] Tower data fields: ${Object.keys(towerData).join(', ')}`
          );
          console.log(
            `[getOpponentChallengeTowers] Has replayData? ${!!towerData.replayData}, length: ${towerData.replayData?.length || 0}`
          );

          if (!towerData || Object.keys(towerData).length === 0) {
            console.warn(`[getOpponentChallengeTowers] ❌ No data found for tower ${towerId}`);
            return null;
          }

          // If sessionId is stored, fetch full session data
          if (towerData.sessionId) {
            try {
              console.log(
                `[OPPONENT-TOWER-FETCH] Fetching session data for sessionId: ${towerData.sessionId}`
              );
              const sessionData = await redis.hGetAll(`session:${towerData.sessionId}`);
              console.log(`[OPPONENT-TOWER-FETCH] Session data keys:`, Object.keys(sessionData));

              if (sessionData && Object.keys(sessionData).length > 0) {
                const session = JSON.parse(sessionData.data || '{}');
                console.log(
                  `[OPPONENT-TOWER-FETCH] Parsed session - blockCount: ${session.blockCount}, towerBlocks: ${session.towerBlocks?.length || 0}`
                );

                const result = {
                  sessionId: towerData.sessionId,
                  towerId: towerData.towerId || towerId,
                  userId: towerData.userId || opponentUserId,
                  username: session.username || 'Unknown',
                  elo: opponentElo,
                  score: parseInt(towerData.score || '0', 10),
                  blockCount: session.blockCount || 0,
                  perfectStreak: session.perfectStreakCount || 0,
                  maxCombo: session.maxCombo || 0,
                  gameMode: towerData.gameMode || 'rotating_block',
                  timestamp: parseInt(towerData.timestamp || '0', 10),
                  towerBlocks: session.towerBlocks || [],
                  playerColorChoice: session.playerColorChoice || null,
                  replayData: towerData.replayData ? JSON.parse(towerData.replayData) : null,
                  isPersonalBest: false,
                  isDefeated: defeatedTowerIds.has(towerData.sessionId),
                };

                console.log(
                  `[getOpponentChallengeTowers] ✅ Tower ${towerId} loaded - score: ${result.score}, defeated: ${result.isDefeated}, has replay: ${!!result.replayData}, seed: ${result.replayData?.seed}`
                );
                return result;
              } else {
                console.warn(
                  `[OPPONENT-TOWER-FETCH] No session data found for ${towerData.sessionId}`
                );
              }
            } catch (e) {
              console.error(
                `[OPPONENT-TOWER-FETCH] Failed to fetch session data for ${towerData.sessionId}:`,
                e
              );
            }
          } else {
            console.warn(
              `[OPPONENT-TOWER-FETCH] Tower ${towerId} has no sessionId stored, attempting to find from game sessions`
            );

            // Try to find the session by matching the timestamp in the towerId
            // towerId format: userId:timestamp:randomId
            const towerIdParts = towerId.split(':');
            if (towerIdParts.length >= 2) {
              const towerTimestamp = parseInt(towerIdParts[1], 10);

              // Try to find a matching session by user and timestamp
              try {
                const userSessions = await redis.zRange(`u:${opponentUserId}:sessions`, 0, -1, {
                  byScore: true,
                  rev: true,
                });

                // Look for sessions near this timestamp (within 5 minutes)
                for (const sessionId of userSessions) {
                  const sessionData = await redis.hGetAll(`session:${sessionId}`);
                  if (sessionData && sessionData.data) {
                    const session = JSON.parse(sessionData.data);
                    const sessionTime = session.endTime || session.startTime;

                    // If session time is within 5 minutes of tower time, assume it's the same
                    if (Math.abs(sessionTime - towerTimestamp) < 300000) {
                      console.log(
                        `[OPPONENT-TOWER-FETCH] Found matching session ${sessionId} for tower ${towerId}`
                      );

                      // Update the tower data with the sessionId for future queries
                      await redis.hSet(this.KEYS.challengeTowerData(towerId), { sessionId });

                      const result = {
                        sessionId,
                        towerId: towerData.towerId || towerId,
                        userId: towerData.userId || opponentUserId,
                        username: session.username || 'Unknown',
                        elo: opponentElo,
                        score: parseInt(towerData.score || '0', 10),
                        blockCount: session.blockCount || 0,
                        perfectStreak: session.perfectStreakCount || 0,
                        maxCombo: session.maxCombo || 0,
                        gameMode: towerData.gameMode || 'rotating_block',
                        timestamp: parseInt(towerData.timestamp || '0', 10),
                        towerBlocks: session.towerBlocks || [],
                        playerColorChoice: session.playerColorChoice || null,
                        replayData: towerData.replayData ? JSON.parse(towerData.replayData) : null,
                        isPersonalBest: false,
                        isDefeated: defeatedTowerIds.has(sessionId),
                      };

                      console.log(
                        `[getOpponentChallengeTowers] ✅ Tower ${towerId} matched - score: ${result.score}, has replay: ${!!result.replayData}, seed: ${result.replayData?.seed}`
                      );
                      return result;
                    }
                  }
                }
              } catch (e) {
                console.warn(`[OPPONENT-TOWER-FETCH] Failed to search for matching session:`, e);
              }
            }
          }

          // Fallback to basic tower data if session not found
          const fallbackResult = {
            sessionId: towerData.sessionId || towerData.towerId,
            towerId: towerData.towerId || towerId,
            userId: towerData.userId || opponentUserId,
            username: 'Unknown',
            elo: opponentElo,
            score: parseInt(towerData.score || '0', 10),
            blockCount: 0,
            perfectStreak: 0,
            maxCombo: 0,
            gameMode: towerData.gameMode || 'rotating_block',
            timestamp: parseInt(towerData.timestamp || '0', 10),
            towerBlocks: [],
            playerColorChoice: null,
            replayData: towerData.replayData ? JSON.parse(towerData.replayData) : null,
            isPersonalBest: false,
            isDefeated: defeatedTowerIds.has(towerData.sessionId || towerData.towerId),
          };

          console.log(
            `[getOpponentChallengeTowers] ⚠️ Tower ${towerId} fallback - score: ${fallbackResult.score}, has replay: ${!!fallbackResult.replayData}, seed: ${fallbackResult.replayData?.seed}`
          );
          return fallbackResult;
        })
      );

      return towers.filter((t): t is NonNullable<typeof t> => t !== null);
    } catch (e) {
      console.error('Error fetching opponent challenge towers:', e);
      return [];
    }
  }

  /**
   * Get user's game session towers (fallback for challenge mode)
   * This fetches from the regular game session leaderboard
   * Returns FULL TowerMapEntry format for rendering
   */
  private static async getUserGameSessionTowers(
    userId: string,
    limit: number = 200
  ): Promise<any[]> {
    try {
      // Import GameDataService dynamically to avoid circular dependency
      const { GameDataService } = await import('./gameDataService');

      const { towers } = await GameDataService.getTowerMap(limit, 0, undefined, 'all-time');
      const userTowers = towers.filter((t) => t.userId === userId);

      const userMeta = await this.getUserMeta(userId);
      const userElo = userMeta.elo;

      // Return full TowerMapEntry format for client rendering
      return userTowers.map((tower) => ({
        ...tower,
        elo: userElo,
      }));
    } catch (e) {
      console.error('Error fetching user game session towers:', e);
      return [];
    }
  }

  /**
   * Get opponent's game session towers (fallback for challenge mode)
   * This fetches from the regular game session leaderboard
   * Returns FULL TowerMapEntry format for rendering
   */
  private static async getOpponentGameSessionTowers(
    opponentUserId: string,
    limit: number = 200
  ): Promise<any[]> {
    try {
      // Import GameDataService dynamically to avoid circular dependency
      const { GameDataService } = await import('./gameDataService');

      const { towers } = await GameDataService.getTowerMap(limit, 0, undefined, 'all-time');
      const opponentTowers = towers.filter((t) => t.userId === opponentUserId);

      const opponentMeta = await this.getUserMeta(opponentUserId);
      const opponentElo = opponentMeta.elo;

      // Return full TowerMapEntry format for client rendering
      return opponentTowers.map((tower) => ({
        ...tower,
        elo: opponentElo,
      }));
    } catch (e) {
      console.error('Error fetching opponent game session towers:', e);
      return [];
    }
  }

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
}
