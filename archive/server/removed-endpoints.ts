/**
 * ARCHIVED — routes removed from src/server/index.ts during the pre-pivot cleanup.
 *
 * None of these were reachable at the time of removal:
 *   - /api/increment, /api/decrement  → Devvit starter-template counter boilerplate.
 *                                       Never called by the client, backed by an unused
 *                                       Redis `count` key.
 *   - /api/game/clear-towers          → Dev/testing route superseded by /api/game/clear-all
 *                                       (the only one the client actually calls).
 *   - /internal/menu/migrate-sessions → One-off migration to bootstrap challenge towers from
 *   - /internal/form/migrate-sessions   legacy game sessions. Neither the menu item nor the
 *                                       form was ever registered in devvit.json, so Devvit
 *                                       had no way to invoke them.
 *   - /api/tournament/my-towers       → Self-described "legacy endpoints for backwards
 *   - /api/tournament/opponent-towers   compatibility"; superseded by /api/challenge/my-towers
 *                                       and /api/challenge/opponent-towers, which are what
 *                                       useTournament.ts actually fetches.
 *
 * Kept in src/server/index.ts despite having no caller:
 *   - DELETE /api/game/user/:userId   → user data deletion, commented "for compliance".
 *                                       Left in place deliberately; removing a data-deletion
 *                                       path is a legal call, not a cleanup call.
 *
 * This file is a record, not a module. It is outside every tsconfig project and is not
 * compiled, linted, or bundled.
 */

// ---------------------------------------------------------------------------
// Devvit starter-template counter boilerplate
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Dev/testing data reset — superseded by /api/game/clear-all
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// One-off session → challenge-tower migration (never wired into devvit.json)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Legacy tournament tower lookups — superseded by /api/challenge/*
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Sole caller of TournamentService.migrateGameSessionsToChallengeMode(), which was
// removed from src/server/core/tournamentService.ts in the same pass.
// Body preserved in archive/server/removed-tournament-migration.ts.
// ---------------------------------------------------------------------------
