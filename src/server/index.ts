import express from 'express';
import {
  InitResponse,
  IncrementResponse,
  DecrementResponse,
  SaveGameSessionRequest,
  SaveGameSessionResponse,
  GetUserStatsResponse,
  GetTowerMapResponse,
  GetLeaderboardResponse,
  UpdateTowerPlacementRequest,
  UpdateTowerPlacementResponse,
  ClearTowersResponse,
  ShareSessionRequest,
  ShareSessionResponse,
  GetTowerColorStatsResponse,
} from '../shared/types/api';
import { redis, reddit, createServer, context, getServerPort } from '@devvit/web/server';
import { createPost, createLeaderboardPost, createSharePost, SharePostOptions } from './core/post';
import { dailyResetJob } from './jobs/dailyReset';
import { GameDataService } from './core/gameDataService';
import { TournamentService } from './core/tournamentService';
import { UserFlairService } from './core/userFlairService';
import { initializeConsoleSilencer } from '../shared/utils/consoleSilencer';

initializeConsoleSilencer();

// Import blocks functionality
// import './devvitBlocks';

const app = express();

// Middleware for JSON body parsing
app.use(express.json({ limit: '10mb' }));
// Middleware for URL-encoded body parsing
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
// Middleware for plain text body parsing
app.use(express.text({ limit: '10mb' }));

const router = express.Router();

// Client-side logging endpoint (no /api prefix to match other routes)
router.post('/api/log', async (req, res): Promise<void> => {
  try {
    const { logs } = req.body;

    if (!logs || !Array.isArray(logs)) {
      res.status(400).json({ error: 'Invalid logs format' });
      return;
    }

    // Log each message to server console (will appear in devvit logs)
    for (const log of logs) {
      const { level, message, timestamp, sessionId, data } = log;
      const date = new Date(timestamp).toISOString();
      const prefix = `[CLIENT-${level.toUpperCase()}] [Session ${sessionId}] [${date}]`;

      // Format the log message
      let fullMessage = `${prefix} ${message}`;
      if (data && data.length > 0) {
        fullMessage += ` ${JSON.stringify(data)}`;
      }

      // Use appropriate console method
      switch (level) {
        case 'error':
          console.error(fullMessage);
          break;
        case 'warn':
          console.warn(fullMessage);
          break;
        case 'info':
          console.info(fullMessage);
          break;
        default:
          console.log(fullMessage);
      }
    }

    res.json({ success: true, count: logs.length });
  } catch (error) {
    console.error('Error processing client logs:', error);
    res.status(500).json({ error: 'Failed to process logs' });
  }
});

router.get<{ postId: string }, InitResponse | { status: string; message: string }>(
  '/api/init',
  async (_req, res): Promise<void> => {
    const { postId } = context;

    if (!postId) {
      console.error('API Init Error: postId not found in devvit context');
      res.status(400).json({
        status: 'error',
        message: 'postId is required but missing from context',
      });
      return;
    }

    try {
      const [count, username] = await Promise.all([
        redis.get('count'),
        reddit.getCurrentUsername(),
      ]);

      // Fetch post data to get replay/session info
      let replayData;
      let sessionId;
      let postAuthor;
      let leaderboardView = (context.postData as any)?.leaderboardView === true;
      try {
        const post = await reddit.getPostById(postId);
        postAuthor = post.authorName;

        console.log(`[API Init] Fetched post ${postId} by ${postAuthor}`);

        // Cast to any to access custom postData
        const postData = (post as any).postData;

        if (postData) {
          console.log(`[API Init] Found postData:`, JSON.stringify(postData));
          replayData = postData.replayData;
          sessionId = postData.sessionId;
          leaderboardView = leaderboardView || postData.leaderboardView === true;
        } else {
          console.log(`[API Init] No postData found on post object. Keys:`, Object.keys(post));
        }

        // Fallback: Check Redis for session ID if not in postData
        if (!sessionId) {
          const redisSessionId = await redis.get(`post:${postId}:session`);
          if (redisSessionId) {
            console.log(`[API Init] Found session ID in Redis backup: ${redisSessionId}`);
            sessionId = redisSessionId;
          }
        }
      } catch (e) {
        console.warn('Failed to fetch post data for init:', e);
      }

      res.json({
        type: 'init',
        postId: postId,
        count: count ? parseInt(count) : 0,
        username: username ?? 'anonymous',
        replayData,
        sessionId,
        ...(postAuthor ? { postAuthor } : {}),
        ...(leaderboardView ? { leaderboardView: true } : {}),
      });
    } catch (error) {
      console.error(`API Init Error for post ${postId}:`, error);
      let errorMessage = 'Unknown error during initialization';
      if (error instanceof Error) {
        errorMessage = `Initialization failed: ${error.message}`;
      }
      res.status(400).json({ status: 'error', message: errorMessage });
    }
  }
);

router.post<{ postId: string }, IncrementResponse | { status: string; message: string }, unknown>(
  '/api/increment',
  async (_req, res): Promise<void> => {
    const { postId } = context;
    if (!postId) {
      res.status(400).json({
        status: 'error',
        message: 'postId is required',
      });
      return;
    }

    res.json({
      count: await redis.incrBy('count', 1),
      postId,
      type: 'increment',
    });
  }
);

router.post<{ postId: string }, DecrementResponse | { status: string; message: string }, unknown>(
  '/api/decrement',
  async (_req, res): Promise<void> => {
    const { postId } = context;
    if (!postId) {
      res.status(400).json({
        status: 'error',
        message: 'postId is required',
      });
      return;
    }

    res.json({
      count: await redis.incrBy('count', -1),
      postId,
      type: 'decrement',
    });
  }
);

router.post('/internal/on-app-install', async (_req, res): Promise<void> => {
  try {
    const post = await createPost();

    res.json({
      status: 'success',
      message: `Post created in subreddit ${context.subredditName} with id ${post.id}`,
    });
  } catch (error) {
    console.error(`Error creating post: ${error}`);
    res.status(400).json({
      status: 'error',
      message: 'Failed to create post',
    });
  }
});

router.post('/internal/menu/post-create', async (_req, res): Promise<void> => {
  try {
    const post = await createPost();

    res.json({
      navigateTo: `https://reddit.com/r/${context.subredditName}/comments/${post.id}`,
    });
  } catch (error) {
    console.error(`Error creating post: ${error}`);
    res.status(400).json({
      status: 'error',
      message: 'Failed to create post',
    });
  }
});

router.post('/internal/menu/post-create-leaderboard', async (_req, res): Promise<void> => {
  try {
    const post = await createLeaderboardPost();

    res.json({
      navigateTo: `https://reddit.com/r/${context.subredditName}/comments/${post.id}`,
      showToast: {
        text: 'Leaderboard post created. Pinning was attempted if supported by API permissions.',
        appearance: 'success',
      },
    });
  } catch (error) {
    console.error(`Error creating leaderboard post: ${error}`);
    res.status(400).json({
      status: 'error',
      message: 'Failed to create leaderboard post',
    });
  }
});

// Game data API endpoints

router.post<{}, SaveGameSessionResponse, SaveGameSessionRequest>(
  '/api/game/save-session',
  async (req, res): Promise<void> => {
    try {
      const sessionRequest = req.body;
      const sessionResult = await GameDataService.saveGameSession(sessionRequest);
      const sessionId = sessionResult.sessionId;

      const { userId, username } = await GameDataService.getCurrentUser();

      // Get rank and grid status
      const rankData = await GameDataService.getPlayerRank(userId, sessionResult.bestSessionId);

      // Get user stats to check for improvement
      const { stats, recentSessions } = await GameDataService.getUserStats(userId);

      const postId = context.postId;
      if (postId) {
        const previewData = {
          username,
          highScore: stats?.highScore ?? sessionRequest.sessionData.finalScore,
          bestTowerHeight: stats?.bestTowerHeight ?? sessionRequest.sessionData.blockCount,
          perfectStreak: stats?.longestPerfectStreak ?? sessionRequest.sessionData.maxCombo ?? 0,
          ranking: rankData.rank,
        };

        await redis.set(`post:${postId}:preview`, JSON.stringify(previewData));
      }

      // Find previous best session (excluding current one)
      let improvement: SaveGameSessionResponse['improvement'] = undefined;
      if (recentSessions.length > 1) {
        // Get the previous session (second most recent)
        const previousSession = recentSessions[1];
        if (previousSession) {
          improvement = {
            lastScore: previousSession.finalScore,
            lastBlocks: previousSession.blockCount,
            lastPerfectStreak: previousSession.perfectStreakCount,
          };
        }
      } else if (stats) {
        // Use stats if no previous session found
        const hasLastScore = stats.highScore !== req.body.sessionData.finalScore;
        const hasLastBlocks = stats.bestTowerHeight !== req.body.sessionData.blockCount;
        const hasLastPerfectStreak = false;

        if (hasLastScore || hasLastBlocks || hasLastPerfectStreak) {
          improvement = {
            ...(hasLastScore && { lastScore: stats.highScore }),
            ...(hasLastBlocks && { lastBlocks: stats.bestTowerHeight }),
          };
        }
      }

      try {
        const [elo, maxTowerScore] = await Promise.all([
          TournamentService.getUserElo(userId),
          Promise.resolve(sessionResult.bestScore),
        ]);

        await UserFlairService.updateUserFlair({
          username,
          elo,
          maxTowerScore,
        });
      } catch (flairError) {
        console.warn('Failed to update user flair after save-session:', flairError);
      }

      res.json({
        type: 'save_session',
        sessionId,
        success: true,
        ...(rankData.rank !== null && { rank: rankData.rank }),
        totalPlayers: rankData.totalPlayers,
        madeTheGrid: rankData.madeTheGrid,
        ...(rankData.scoreToGrid !== null && { scoreToGrid: rankData.scoreToGrid }),
        ...(improvement && { improvement }),
        personalBest: sessionResult.isNewHighScore,
        bestSessionId: sessionResult.bestSessionId,
        bestScore: sessionResult.bestScore,
        ...(sessionResult.previousBestScore !== null && {
          previousBestScore: sessionResult.previousBestScore,
        }),
        bestPerfectStreak: sessionResult.bestPerfectStreak,
        ...(sessionResult.previousBestPerfectStreak !== null && {
          previousBestPerfectStreak: sessionResult.previousBestPerfectStreak,
        }),
        personalBestPerfectStreak: sessionResult.isNewPerfectStreak,
      });
    } catch (error) {
      console.error('Error saving game session:', error);
      res.status(400).json({
        type: 'save_session',
        sessionId: '',
        success: false,
        message: error instanceof Error ? error.message : 'Failed to save game session',
        totalPlayers: 0,
        madeTheGrid: false,
      });
    }
  }
);

router.post<{}, ShareSessionResponse, ShareSessionRequest>(
  '/api/game/share-session',
  async (req, res): Promise<void> => {
    try {
      const payload = req.body;

      if (
        !payload ||
        typeof payload.score !== 'number' ||
        typeof payload.blocks !== 'number' ||
        typeof payload.perfectStreak !== 'number'
      ) {
        res.status(400).json({
          type: 'share_session',
          success: false,
          message: 'Missing required share payload fields.',
        });
        return;
      }

      const { subredditName } = context;
      if (!subredditName) {
        res.status(400).json({
          type: 'share_session',
          success: false,
          message: 'Subreddit context is required to share the session.',
        });
        return;
      }

      const { username } = await GameDataService.getCurrentUser();

      const shareOptions: SharePostOptions = {
        username,
        score: payload.score,
        blocks: payload.blocks,
        perfectStreak: payload.perfectStreak,
        ...(payload.replayData && { replayData: payload.replayData }),
      };

      if (typeof payload.rank === 'number') {
        shareOptions.rank = payload.rank;
      }

      if (typeof payload.totalPlayers === 'number') {
        shareOptions.totalPlayers = payload.totalPlayers;
      }

      if (typeof payload.madeTheGrid === 'boolean') {
        shareOptions.madeTheGrid = payload.madeTheGrid;
      }

      if (typeof payload.sessionId === 'string' && payload.sessionId.length > 0) {
        shareOptions.sessionId = payload.sessionId;
      }

      const post = await createSharePost(shareOptions);

      if (!post?.id) {
        throw new Error('Share post was created without an ID');
      }

      const previewPayload = {
        username,
        highScore: payload.score,
        bestTowerHeight: payload.blocks,
        perfectStreak: payload.perfectStreak,
        ranking: typeof payload.rank === 'number' ? payload.rank : null,
      };

      await redis.set(`post:${post.id}:preview`, JSON.stringify(previewPayload));

      const postUrl =
        typeof post.permalink === 'string'
          ? `https://reddit.com${post.permalink}`
          : typeof post.url === 'string'
            ? post.url
            : undefined;

      const responsePayload: ShareSessionResponse = {
        type: 'share_session',
        success: true,
        postId: String(post.id),
        subreddit: subredditName,
      };

      if (postUrl) {
        responsePayload.postUrl = postUrl;
      }

      res.json(responsePayload);
    } catch (error) {
      console.error('Error sharing Stonefall session:', error);
      res.status(500).json({
        type: 'share_session',
        success: false,
        message: error instanceof Error ? error.message : 'Failed to share Stonefall session',
      });
    }
  }
);

router.get<{}, GetUserStatsResponse>('/api/game/user-stats', async (_req, res): Promise<void> => {
  try {
    const { stats, recentSessions } = await GameDataService.getUserStats();

    res.json({
      type: 'user_stats',
      stats,
      recentSessions,
    });
  } catch (error) {
    console.error('Error getting user stats:', error);
    // Return 200 with empty data instead of 400 for authentication issues
    res.json({
      type: 'user_stats',
      stats: null,
      recentSessions: [],
    });
  }
});

router.get<{}, GetTowerMapResponse>('/api/game/tower-map', async (req, res): Promise<void> => {
  try {
    const limit = parseInt(req.query.limit as string) || 300;
    const offset = parseInt(req.query.offset as string) || 0;
    const type = (req.query.type as string) === 'daily' ? 'daily' : 'all-time';
    const cycleId = req.query.cycleId as string | undefined;

    // Parse spatial bounds if provided
    let bounds: { minX: number; maxX: number; minZ: number; maxZ: number } | undefined;
    if (req.query.minX && req.query.maxX && req.query.minZ && req.query.maxZ) {
      bounds = {
        minX: parseFloat(req.query.minX as string),
        maxX: parseFloat(req.query.maxX as string),
        minZ: parseFloat(req.query.minZ as string),
        maxZ: parseFloat(req.query.maxZ as string),
      };
    }

    const { towers, totalCount } = await GameDataService.getTowerMap(
      limit,
      offset,
      bounds,
      type,
      cycleId
    );

    res.json({
      type: 'tower_map',
      towers,
      totalCount,
    });
  } catch (error) {
    console.error('Error getting tower map:', error);
    res.status(400).json({
      type: 'tower_map',
      towers: [],
      totalCount: 0,
    });
  }
});

router.get<{}, GetTowerColorStatsResponse>(
  '/api/game/tower-stats',
  async (req, res): Promise<void> => {
    try {
      const type = (req.query.type as string) === 'daily' ? 'daily' : 'all-time';
      const cycleId = req.query.cycleId as string | undefined;
      const stats = await GameDataService.getTowerColorStats(type, cycleId);

      res.json({
        type: 'tower_color_stats',
        ...stats,
      });
    } catch (error) {
      console.error('Error getting tower color stats:', error);
      res.status(500).json({
        type: 'tower_color_stats',
        totalCount: 0,
        colorTotals: {
          orange: { count: 0, percentage: 0 },
          blue: { count: 0, percentage: 0 },
          unknown: { count: 0, percentage: 0 },
        },
        leadingColor: 'unknown',
      });
    }
  }
);

// Update tower placement coordinates
router.post<{}, UpdateTowerPlacementResponse, UpdateTowerPlacementRequest>(
  '/api/game/update-tower-placement',
  async (req, res): Promise<void> => {
    try {
      const { sessionId, worldX, worldZ, gridX, gridZ } = req.body;

      if (
        !sessionId ||
        worldX === undefined ||
        worldZ === undefined ||
        gridX === undefined ||
        gridZ === undefined
      ) {
        res.status(400).json({
          type: 'update_placement',
          success: false,
          message: 'Missing required fields: sessionId, worldX, worldZ, gridX, gridZ',
        });
        return;
      }

      const success = await GameDataService.updateTowerPlacement(
        sessionId,
        worldX,
        worldZ,
        gridX,
        gridZ
      );

      res.json({
        type: 'update_placement',
        success,
        message: success
          ? 'Tower placement updated successfully'
          : 'Failed to update tower placement',
      });
    } catch (error) {
      console.error('Update tower placement error:', error);
      res.status(500).json({
        type: 'update_placement',
        success: false,
        message: 'Internal server error',
      });
    }
  }
);

router.get<{}, GetLeaderboardResponse>('/api/game/leaderboard', async (req, res): Promise<void> => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const type = (req.query.type as string) === 'daily' ? 'daily' : 'all-time';

    const { highScores, perfectStreaks } = await GameDataService.getLeaderboards(limit, type);

    res.json({
      type: 'leaderboard',
      highScores,
      perfectStreaks,
    });
  } catch (error) {
    console.error('Error getting leaderboard:', error);
    res.status(400).json({
      type: 'leaderboard',
      highScores: [],
      perfectStreaks: [],
    });
  }
});

router.get<{ sessionId: string }>(
  '/api/game/session/:sessionId',
  async (req, res): Promise<void> => {
    try {
      const { sessionId } = req.params;
      const session = await GameDataService.getGameSession(sessionId);

      if (!session) {
        res.status(404).json({
          status: 'error',
          message: 'Session not found',
        });
        return;
      }

      // Fetch tower placement if available to ensure correct visualization
      try {
        const towerData = await redis.hGet(`tower:${sessionId}`, 'data');
        if (towerData) {
          const towerEntry = JSON.parse(towerData);
          console.log(`[API Session] Found tower data for ${sessionId}:`, {
            worldX: towerEntry.worldX,
            worldZ: towerEntry.worldZ,
            gridX: towerEntry.gridX,
            gridZ: towerEntry.gridZ,
          });

          if (towerEntry.worldX !== undefined) session.worldX = towerEntry.worldX;
          if (towerEntry.worldZ !== undefined) session.worldZ = towerEntry.worldZ;
          if (towerEntry.gridX !== undefined) session.gridX = towerEntry.gridX;
          if (towerEntry.gridZ !== undefined) session.gridZ = towerEntry.gridZ;
        } else {
          console.log(`[API Session] No tower data found for ${sessionId}`);
        }
      } catch (e) {
        console.warn(`Failed to fetch tower placement for session ${sessionId}`, e);
      }

      res.json(session);
    } catch (error) {
      console.error('Error getting game session:', error);
      res.status(400).json({
        status: 'error',
        message: 'Failed to get game session',
      });
    }
  }
);

// User data deletion endpoint (for compliance)
router.delete<{ userId: string }>('/api/game/user/:userId', async (req, res): Promise<void> => {
  try {
    const { userId } = req.params;
    await GameDataService.deleteUserData(userId);

    res.json({
      status: 'success',
      message: 'User data deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting user data:', error);
    res.status(400).json({
      status: 'error',
      message: 'Failed to delete user data',
    });
  }
});

// Development/testing endpoints for clearing data
router.delete<{}, ClearTowersResponse>(
  '/api/game/clear-towers',
  async (_req, res): Promise<void> => {
    try {
      await GameDataService.clearAllTowers();

      res.json({
        status: 'success',
        message: 'All towers cleared successfully',
      });
    } catch (error) {
      console.error('Error clearing towers:', error);
      res.status(500).json({
        status: 'error',
        message: `Failed to clear towers: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  }
);

router.delete('/api/game/clear-all', async (_req, res): Promise<void> => {
  try {
    await GameDataService.clearAllGameData();

    res.json({
      status: 'success',
      message: 'All game data cleared successfully',
    });
  } catch (error) {
    console.error('Error clearing all game data:', error);
    res.status(500).json({
      status: 'error',
      message: `Failed to clear all game data: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
  }
});

// Compliance endpoints for content deletion
router.post('/internal/on-post-delete', async (req, res): Promise<void> => {
  try {
    // Handle post deletion - remove any game data associated with the post
    const { postId } = req.body;
    console.log(`Post deleted: ${postId}`);

    // Note: In a full implementation, you might want to clean up
    // game sessions associated with this specific post

    res.json({ status: 'success' });
  } catch (error) {
    console.error('Error handling post deletion:', error);
    res.status(400).json({ status: 'error', message: 'Failed to handle post deletion' });
  }
});

router.post('/internal/on-comment-delete', async (req, res): Promise<void> => {
  try {
    // Handle comment deletion
    const { commentId } = req.body;
    console.log(`Comment deleted: ${commentId}`);

    res.json({ status: 'success' });
  } catch (error) {
    console.error('Error handling comment deletion:', error);
    res.status(400).json({ status: 'error', message: 'Failed to handle comment deletion' });
  }
});

router.post('/internal/scheduler/daily-reset', async (req, res) => {
  try {
    await dailyResetJob(req.body);
    res.status(200).json({ status: 'success' });
  } catch (error) {
    console.error('Error in daily reset scheduler:', error);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// Import Data Menu & Form Handlers
router.post('/internal/menu/import-data', async (_req, res) => {
  res.json({
    showForm: {
      name: 'importDataForm',
      form: {
        title: 'Import Tower Data',
        acceptLabel: 'Import',
        fields: [
          {
            name: 'jsonData',
            label: 'Paste JSON Array of TowerMapEntry',
            type: 'paragraph',
            required: true,
          },
        ],
      },
    },
  });
});

router.post('/internal/form/import-data', async (req, res) => {
  try {
    const { jsonData } = req.body;
    if (!jsonData) {
      throw new Error('No data provided');
    }

    let towers: any[];
    try {
      towers = JSON.parse(jsonData);
    } catch (e) {
      throw new Error('Invalid JSON format');
    }

    if (!Array.isArray(towers)) {
      throw new Error('Data must be an array of towers');
    }

    const count = await GameDataService.importTowerEntries(towers);

    res.json({
      showToast: {
        text: `Successfully imported ${count} towers!`,
        appearance: 'success',
      },
    });
  } catch (error) {
    console.error('Import failed:', error);
    res.json({
      showToast: {
        text: `Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        appearance: 'neutral', // 'error' appearance might not be supported in all clients yet
      },
    });
  }
});

// Migration endpoints
router.post('/internal/menu/migrate-sessions', async (_req, res) => {
  res.json({
    showForm: {
      name: 'migrateSessionsForm',
      form: {
        title: 'Migrate Game Sessions to Challenge Towers',
        acceptLabel: 'Migrate',
        fields: [
          {
            name: 'confirm',
            label:
              'This will convert all existing high-score game sessions into challenge tower entries for matchmaking. Proceed?',
            type: 'paragraph',
            required: false,
          },
        ],
      },
    },
  });
});

router.post('/internal/form/migrate-sessions', async (_req, res) => {
  try {
    console.log('[MIGRATION] Starting game sessions to challenge towers migration...');
    const result = await TournamentService.migrateGameSessionsToChallengeMode();

    res.json({
      showToast: {
        text: `Migration complete: ${result.migrated} towers migrated, ${result.failed} failed`,
        appearance: 'success',
      },
    });
  } catch (error) {
    console.error('Migration failed:', error);
    res.json({
      showToast: {
        text: `Migration failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        appearance: 'neutral',
      },
    });
  }
});

// Tournament Routes

router.get('/api/tournament/status', async (_req, res) => {
  try {
    const { userId } = context;
    if (!userId) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }
    const status = await TournamentService.getStatus(userId);
    res.json(status);
  } catch (error) {
    console.error('Error fetching tournament status:', error);
    res.status(500).json({ error: 'Failed to fetch status' });
  }
});

router.get('/api/tournament/leaderboard', async (req, res) => {
  try {
    const { userId } = context;
    if (!userId) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    const view: 'top' | 'around' = (req.query.view as string) === 'around' ? 'around' : 'top';
    const pageRaw = parseInt(req.query.page as string, 10);
    const pageSizeRaw = parseInt(req.query.pageSize as string, 10);
    const limitRaw = parseInt(req.query.limit as string, 10);

    const leaderboardOptions = {
      view,
      page: Number.isFinite(pageRaw) ? pageRaw : 1,
      ...(Number.isFinite(pageSizeRaw) ? { pageSize: pageSizeRaw } : {}),
      ...(Number.isFinite(limitRaw) ? { limit: limitRaw } : {}),
    };

    const leaderboard = await TournamentService.getLeaderboard(userId, leaderboardOptions);
    res.json(leaderboard);
  } catch (error) {
    console.error('Error fetching tournament leaderboard:', error);
    res.status(500).json({ error: 'Failed to fetch tournament leaderboard' });
  }
});

router.post('/api/tournament/find-match', async (_req, res) => {
  try {
    const { userId } = context;
    if (!userId) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }
    const match = await TournamentService.findMatch(userId);
    if (!match) {
      res.status(404).json({ error: 'No opponent found' });
      return;
    }
    res.json(match);
  } catch (error: any) {
    console.error('Error finding match:', error);
    res.status(500).json({
      error: 'Failed to find match',
      details: error?.message || String(error),
      stack: error?.stack,
    });
  }
});

router.post('/api/tournament/submit-ghost', async (req, res) => {
  try {
    const { userId } = context;
    if (!userId) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }
    const { replayData, score, sessionId } = req.body;
    const response = await TournamentService.submitGhost(userId, replayData, score, sessionId);
    res.json(response);
  } catch (error) {
    console.error('Error submitting ghost:', error);
    res.status(500).json({ error: 'Failed to submit ghost' });
  }
});

router.post('/api/tournament/report-match', async (req, res) => {
  try {
    const { userId } = context;
    if (!userId) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }
    const { matchId, result, score, defeatedSessionId } = req.body;
    const response = await TournamentService.reportMatch(
      userId,
      matchId,
      result,
      score,
      defeatedSessionId
    );

    try {
      const [{ username }, maxTowerScore] = await Promise.all([
        GameDataService.getCurrentUser(),
        GameDataService.getUserHighScore(userId),
      ]);

      await UserFlairService.updateUserFlair({
        username,
        elo: response.newElo,
        maxTowerScore,
      });
    } catch (flairError) {
      console.warn('Failed to update user flair after report-match:', flairError);
    }

    res.json(response);
  } catch (error) {
    console.error('Error reporting match:', error);
    res.status(500).json({ error: 'Failed to report match' });
  }
});

router.get('/api/tournament/towers', async (req, res) => {
  try {
    const { userId } = context;
    if (!userId) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }
    const limit = parseInt(req.query.limit as string) || 50;
    const towers = await TournamentService.getTournamentTowers(userId, limit);
    res.json({ towers });
  } catch (error: any) {
    console.error('Error fetching tournament towers:', error);
    res.status(500).json({
      error: 'Failed to fetch tournament towers',
      details: error?.message || String(error),
    });
  }
});

router.get('/api/challenge/tower/:towerId', async (req, res) => {
  try {
    const { towerId } = req.params;
    if (!towerId) {
      res.status(400).json({ error: 'Tower ID required' });
      return;
    }

    // First try to get from challenge towers collection
    let towerData = await redis.hGetAll(`c:tower:${towerId}`);

    if (towerData && Object.keys(towerData).length > 0) {
      // Parse the replay data for client-side reconstruction
      let replayData: any = null;
      try {
        if (towerData.replayData) {
          replayData = JSON.parse(towerData.replayData);
        }
      } catch (e) {
        console.warn('Failed to parse challenge tower replay data:', e);
      }

      return res.json({
        towerId: towerData.towerId || towerId,
        userId: towerData.userId,
        score: parseInt(towerData.score || '0', 10),
        timestamp: parseInt(towerData.timestamp || '0', 10),
        gameMode: towerData.gameMode,
        replayData,
      });
    }

    // Fallback: try to get from game sessions
    const sessionData = await redis.hGetAll(`session:${towerId}`);

    if (sessionData && Object.keys(sessionData).length > 0) {
      let replayData: any = null;
      try {
        if (sessionData.replayData) {
          replayData = JSON.parse(sessionData.replayData);
        }
      } catch (e) {
        console.warn('Failed to parse session replay data:', e);
      }

      return res.json({
        towerId: towerId,
        userId: sessionData.userId,
        score: parseInt(sessionData.finalScore || '0', 10),
        timestamp: parseInt(sessionData.timestamp || '0', 10),
        gameMode: sessionData.gameMode,
        replayData,
      });
    }

    res.status(404).json({ error: 'Tower not found' });
  } catch (error: any) {
    console.error('Error fetching tower replay data:', error);
    res.status(500).json({
      error: 'Failed to fetch tower replay data',
      details: error?.message || String(error),
    });
  }
});

router.get('/api/challenge/my-towers', async (req, res) => {
  try {
    const { userId } = context;
    if (!userId) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    // Get user's challenge towers (submitted during matchmaking)
    // Defeated status is now globally checked for all towers
    const towers = await TournamentService.getUserChallengeTowers(userId, 200);

    res.json({ towers });
  } catch (error: any) {
    console.error('Error fetching user challenge towers:', error);
    res.status(500).json({
      error: 'Failed to fetch user challenge towers',
      details: error?.message || String(error),
    });
  }
});

router.get('/api/challenge/opponent-towers', async (req, res) => {
  try {
    const { userId: opponentUserId } = req.query;

    if (!opponentUserId || typeof opponentUserId !== 'string') {
      res.status(400).json({ error: 'Opponent userId required' });
      return;
    }

    // Get opponent's challenge towers (submitted during matchmaking)
    // Defeated status is now globally checked for all towers
    const towers = await TournamentService.getOpponentChallengeTowers(opponentUserId, 200);

    console.log(
      `[API opponent-towers] 📡 Returning ${towers.length} opponent towers for user ${opponentUserId}`
    );
    towers.forEach((tower, idx) => {
      console.log(
        `[API opponent-towers] Tower ${idx + 1}: score=${tower.score}, defeated=${tower.isDefeated}, has replay=${!!tower.replayData}, seed=${tower.replayData?.seed}`
      );
    });

    res.json({ towers });
  } catch (error: any) {
    console.error('Error fetching opponent challenge towers:', error);
    res.status(500).json({
      error: 'Failed to fetch opponent challenge towers',
      details: error?.message || String(error),
    });
  }
});

// Legacy endpoints for backwards compatibility with all-time game sessions
router.get('/api/tournament/my-towers', async (req, res) => {
  try {
    const { userId } = context;
    if (!userId) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    // Get ALL of user's towers from game sessions (not challenge mode)
    const { towers } = await GameDataService.getTowerMap(200, 0, undefined, 'all-time');

    // Filter to only this user's towers
    const myTowers = towers.filter((t) => t.userId === userId);

    res.json({ towers: myTowers });
  } catch (error: any) {
    console.error('Error fetching user towers:', error);
    res.status(500).json({
      error: 'Failed to fetch user towers',
      details: error?.message || String(error),
    });
  }
});

router.get('/api/tournament/opponent-towers', async (req, res) => {
  try {
    const { userId: opponentUserId } = req.query;
    if (!opponentUserId || typeof opponentUserId !== 'string') {
      res.status(400).json({ error: 'Opponent userId required' });
      return;
    }

    // Get ALL of opponent's towers from game sessions (not challenge mode)
    const { towers } = await GameDataService.getTowerMap(200, 0, undefined, 'all-time');

    // Filter to only opponent's towers
    const opponentTowers = towers.filter((t) => t.userId === opponentUserId);

    res.json({ towers: opponentTowers });
  } catch (error: any) {
    console.error('Error fetching opponent towers:', error);
    res.status(500).json({
      error: 'Failed to fetch opponent towers',
      details: error?.message || String(error),
    });
  }
});

// Use router middleware
app.use(router);

// Only start server if we're in a web context (not blocks context)
if (process.env.DEVVIT_EXECUTION_CONTEXT !== 'blocks') {
  // Get port from environment variable with fallback
  const port = getServerPort();

  const server = createServer(app);
  server.on('error', (err) => console.error(`server error; ${err.stack}`));
  server.listen(port);
}
