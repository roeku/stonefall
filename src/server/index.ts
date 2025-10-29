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
} from '../shared/types/api';
import { redis, reddit, createServer, context, getServerPort } from '@devvit/web/server';
import { createPost, createSharePost, SharePostOptions } from './core/post';
import { GameDataService } from './core/gameDataService';

// Import blocks functionality
import './devvitBlocks';

const app = express();

// Middleware for JSON body parsing
app.use(express.json());
// Middleware for URL-encoded body parsing
app.use(express.urlencoded({ extended: true }));
// Middleware for plain text body parsing
app.use(express.text());

const router = express.Router();

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

      res.json({
        type: 'init',
        postId: postId,
        count: count ? parseInt(count) : 0,
        username: username ?? 'anonymous',
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
    const limit = parseInt(req.query.limit as string) || 100;
    const offset = parseInt(req.query.offset as string) || 0;

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

    const { towers, totalCount } = await GameDataService.getTowerMap(limit, offset, bounds);

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

    const { highScores, perfectStreaks } = await GameDataService.getLeaderboards(limit);

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
