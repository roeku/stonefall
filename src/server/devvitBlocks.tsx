import { Devvit, useWebView } from '@devvit/public-api';

// Configure Devvit
Devvit.configure({
  redditAPI: true,
  redis: true,
  http: true,
  realtime: true,
});

// ============================================================================
// CUSTOM POST TYPE - Main Interactive Block
// ============================================================================

Devvit.addCustomPostType({
  name: 'Stonefall Tower Game',
  description: 'Stack blocks to build the highest tower on The Grid',
  height: 'tall',
  render: (context) => {
    const { redis, reddit, useState, ui, postId } = context;

    // Setup web view for fullscreen game
    const webView = useWebView({
      url: 'index.html',
      onMessage: (message) => {
        console.log('Message from web view:', message);
      },
    });

    // State management
    const [currentView, setCurrentView] = useState<'home' | 'stats' | 'leaderboard'>('home');
    const [leaderboardTab, setLeaderboardTab] = useState<'scores' | 'streaks'>('scores');

    // Helper: robustly open the webview, fallback to navigating to the post if mount fails
    const handleEnter = async () => {
      try {
        // Attempt to mount the web view (preferred)
        webView.mount();

        // Fallback: if the webview doesn't become visible in a short time, navigate to the post page
        // (Some clients may not honor the mount effect; navigateTo the post is a reliable fallback.)
        setTimeout(async () => {
          try {
            // Try to navigate to the post as a fallback
            if (postId) {
              const post = await reddit.getPostById(postId);
              if (post) ui.navigateTo(post);
            }
          } catch (err) {
            // swallow errors from fallback to avoid breaking the blocks UI
            console.error('Fallback navigate failed', err);
          }
        }, 800);
      } catch (err) {
        console.error('webView.mount() failed, falling back to navigateTo', err);
        try {
          if (postId) {
            const post = await reddit.getPostById(postId);
            if (post) ui.navigateTo(post);
          }
        } catch (e) {
          console.error('Fallback navigate failed', e);
        }
      }
    };

    // Load all data in parallel using useState with Promise.all
    const [appData] = useState(async () => {
      try {
        // Get current user
        let currentUser = null;
        let username = 'Player';
        let userId = '';

        try {
          currentUser = await reddit.getCurrentUser();
          if (currentUser) {
            username = currentUser.username;
            userId = currentUser.id;
          }
        } catch (error) {
          console.error('Error getting current user:', error);
        }

        // Load user stats and leaderboard data in parallel
        const [userStatsData, highScoresData, perfectStreaksData] = await Promise.all([
          // User stats
          userId ? (async () => {
            try {
              const statsKey = `user:${userId}:stats`;
              const statsData = await redis.hGet(statsKey, 'data');
              return statsData ? JSON.parse(statsData) : null;
            } catch (error) {
              console.error('Error fetching user stats:', error);
              return null;
            }
          })() : Promise.resolve(null),

          // High scores
          (async () => {
            try {
              return await redis.zRange('leaderboard:high_scores', 0, 9, {
                reverse: true,
                by: 'rank',
              });
            } catch (error) {
              console.error('Error fetching high scores:', error);
              return [];
            }
          })(),

          // Perfect streaks
          (async () => {
            try {
              return await redis.zRange('leaderboard:perfect_streaks', 0, 9, {
                reverse: true,
                by: 'rank',
              });
            } catch (error) {
              console.error('Error fetching perfect streaks:', error);
              return [];
            }
          })()
        ]);

        // Process leaderboard data
        const highScores = await Promise.all(
          highScoresData.map(async (entry) => {
            const [userId, sessionId] = entry.member.split(':');
            const sessionKey = `session:${sessionId}`;
            const sessionData = await redis.hGetAll(sessionKey);
            return {
              userId: userId || '',
              sessionId: sessionId || '',
              username: sessionData.username || 'Unknown',
              score: parseInt(sessionData.score || '0'),
              blockCount: parseInt(sessionData.blockCount || '0'),
              timestamp: parseInt(sessionData.timestamp || '0'),
            };
          })
        );

        const perfectStreaks = await Promise.all(
          perfectStreaksData.map(async (entry) => {
            const [userId, sessionId] = entry.member.split(':');
            const sessionKey = `session:${sessionId}`;
            const sessionData = await redis.hGetAll(sessionKey);
            return {
              userId: userId || '',
              sessionId: sessionId || '',
              username: sessionData.username || 'Unknown',
              perfectStreak: parseInt(sessionData.perfectStreak || '0'),
              score: parseInt(sessionData.score || '0'),
              timestamp: parseInt(sessionData.timestamp || '0'),
            };
          })
        );

        return {
          currentUser,
          username,
          userId,
          stats: userStatsData,
          highScores,
          perfectStreaks,
        };
      } catch (error) {
        console.error('Error loading app data:', error);
        return {
          currentUser: null,
          username: 'Player',
          userId: '',
          stats: null,
          highScores: [],
          perfectStreaks: [],
        };
      }
    });

    // Show loading while data is being fetched
    if (!appData) {
      return (
        <blocks height="tall">
          <zstack width="100%" height="100%" alignment="center middle">
            <vstack width="100%" height="100%" backgroundColor="#000811" />
            <vstack gap="medium" alignment="center middle">
              <text size="xxlarge" color="#00ffff">⬢</text>
              <text size="large" color="#00ffff">Loading Stonefall...</text>
            </vstack>
          </zstack>
        </blocks>
      );
    }

    const { username, userId, stats, highScores, perfectStreaks } = appData;

    // Find user's rank
    const userRank = highScores.findIndex((entry: any) => entry.userId === userId) + 1;

    // ========================================================================
    // RENDER VIEWS
    // ========================================================================

    if (currentView === 'stats') {
      return (
        <blocks height="tall">
          <zstack width="100%" height="100%" alignment="top start">
            <vstack width="100%" height="100%" backgroundColor="#000811" />

            <vstack width="100%" padding="medium" gap="medium">
              <hstack width="100%" alignment="start middle" gap="small">
                <button size="small" appearance="secondary" onPress={() => setCurrentView('home')}>
                  ←
                </button>
                <text size="xlarge" weight="bold" color="#00ffff">
                  YOUR STATISTICS
                </text>
              </hstack>

              {stats ? (
                <vstack
                  width="100%"
                  padding="medium"
                  gap="medium"
                  backgroundColor="#00111180"
                  cornerRadius="medium"
                >
                  <hstack width="100%" gap="medium">
                    <text color="#ffffff99" grow>Total Games Played</text>
                    <text weight="bold" color="#00ffff">
                      {stats.totalGames || 0}
                    </text>
                  </hstack>
                  <hstack width="100%" gap="medium">
                    <text color="#ffffff99" grow>Highest Score</text>
                    <text weight="bold" color="#00ffff">
                      {(stats.highScore || 0).toLocaleString()}
                    </text>
                  </hstack>
                  <hstack width="100%" gap="medium">
                    <text color="#ffffff99" grow>Best Tower Height</text>
                    <text weight="bold" color="#ff6600">
                      {stats.bestTowerHeight || 0} blocks
                    </text>
                  </hstack>
                  <hstack width="100%" gap="medium">
                    <text color="#ffffff99" grow>Longest Perfect Streak</text>
                    <text weight="bold" color="#ffd700">
                      {stats.longestPerfectStreak || 0}
                    </text>
                  </hstack>
                  <hstack width="100%" gap="medium">
                    <text color="#ffffff99" grow>Average Score</text>
                    <text weight="bold" color="#00ffff">
                      {Math.round(stats.averageScore || 0).toLocaleString()}
                    </text>
                  </hstack>
                </vstack>
              ) : (
                <vstack padding="large" alignment="center middle">
                  <text color="#ffffff99">No stats available yet</text>
                  <text size="small" color="#ffffff66">
                    Play a game to start building your stats!
                  </text>
                </vstack>
              )}
            </vstack>
          </zstack>
        </blocks>
      );
    }

    if (currentView === 'leaderboard') {
      const displayData = leaderboardTab === 'scores' ? highScores : perfectStreaks;

      return (
        <blocks height="tall">
          <zstack width="100%" height="100%" alignment="top start">
            <vstack width="100%" height="100%" backgroundColor="#000811" />

            <vstack width="100%" padding="medium" gap="medium">
              <hstack width="100%" alignment="start middle" gap="small">
                <button size="small" appearance="secondary" onPress={() => setCurrentView('home')}>
                  ←
                </button>
                <text size="xlarge" weight="bold" color="#ffd700">
                  🏆 LEADERBOARD
                </text>
              </hstack>

              <hstack width="100%" gap="small">
                <button
                  size="medium"
                  appearance={leaderboardTab === 'scores' ? 'primary' : 'secondary'}
                  onPress={() => setLeaderboardTab('scores')}
                  grow
                >
                  HIGH SCORES
                </button>
                <button
                  size="medium"
                  appearance={leaderboardTab === 'streaks' ? 'primary' : 'secondary'}
                  onPress={() => setLeaderboardTab('streaks')}
                  grow
                >
                  PERFECT BLOCKS
                </button>
              </hstack>

              {displayData.length > 0 ? (
                <vstack width="100%" gap="small">
                  {displayData.map((entry: any, index: number) => {
                    const rank = index + 1;
                    const rankColor =
                      rank === 1 ? '#ffd700' : rank === 2 ? '#c0c0c0' : rank === 3 ? '#cd7f32' : '#00ffff';
                    const isCurrentUser = entry.userId === userId;

                    return (
                      <hstack
                        key={entry.sessionId}
                        width="100%"
                        padding="small"
                        gap="small"
                        backgroundColor={isCurrentUser ? '#00ffff20' : '#00111180'}
                        cornerRadius="small"
                        alignment="middle"
                      >
                        <text size="medium" weight="bold" color={rankColor} width="30px">
                          #{rank}
                        </text>
                        <text
                          size="medium"
                          weight={isCurrentUser ? 'bold' : 'regular'}
                          color={isCurrentUser ? '#00ffff' : '#ffffff'}
                          grow
                        >
                          {entry.username}
                        </text>
                        <vstack gap="none" alignment="end">
                          <text size="small" color="#00ffff">
                            {leaderboardTab === 'scores'
                              ? entry.score.toLocaleString()
                              : `⭐ ${entry.perfectStreak || 0}`}
                          </text>
                          <text size="xsmall" color="#ffffff99">
                            {leaderboardTab === 'scores'
                              ? `${entry.blockCount || 0} blocks`
                              : `Score: ${entry.score.toLocaleString()}`}
                          </text>
                        </vstack>
                      </hstack>
                    );
                  })}
                </vstack>
              ) : (
                <vstack padding="large" alignment="center middle">
                  <text color="#ffffff99">No entries yet</text>
                  <text size="small" color="#ffffff66">
                    Be the first to make it on the leaderboard!
                  </text>
                </vstack>
              )}
            </vstack>
          </zstack>
        </blocks>
      );
    }

    // HOME VIEW (Default)
    return (
      <blocks height="tall">
        <zstack width="100%" height="100%" alignment="top start">
          {/* Background with TRON grid effect */}
          <vstack width="100%" height="100%" backgroundColor="#000811" />

          {/* Main Content */}
          <vstack width="100%" padding="medium" gap="medium">
            {/* Header with Logo */}
            <vstack width="100%" gap="small">
              <hstack width="100%" alignment="center middle" gap="small">
                <text size="xxlarge" weight="bold" color="#00ffff" style="heading">
                  ⬢ STONEFALL
                </text>
              </hstack>

              <hstack width="100%" alignment="center middle">
                <text size="small" color="#00ffff99">
                  STACK · SURVIVE · DOMINATE THE GRID
                </text>
              </hstack>

              {/* User Card */}
              <hstack
                width="100%"
                padding="small"
                gap="small"
                backgroundColor="#00111180"
                cornerRadius="small"
              >
                <avatar thingId={userId} facing="left" size="small" />

                <vstack gap="none" grow>
                  <text size="medium" weight="bold" color="#ffffff">
                    {username}
                  </text>
                  {userRank > 0 ? (
                    <text size="small" color="#ffd700">
                      Rank #{userRank} on Grid
                    </text>
                  ) : (
                    <text size="small" color="#ff660099">
                      Not yet on Grid
                    </text>
                  )}
                </vstack>

                {userRank > 0 && userRank <= 10 && (
                  <hstack
                    width="40px"
                    height="40px"
                    backgroundColor={
                      userRank === 1 ? '#ffd700' : userRank <= 3 ? '#c0c0c0' : '#cd7f32'
                    }
                    cornerRadius="full"
                    alignment="center middle"
                  >
                    <text size="large" weight="bold" color="#000000">
                      {userRank}
                    </text>
                  </hstack>
                )}
              </hstack>
            </vstack>

            {/* Stats Card */}
            {stats && (
              <vstack
                width="100%"
                padding="medium"
                gap="small"
                backgroundColor="#00111180"
                cornerRadius="small"
              >
                <text size="medium" weight="bold" color="#00ffff">
                  ▸ YOUR STATS
                </text>

                <hstack width="100%" gap="small">
                  <vstack
                    grow
                    padding="small"
                    gap="none"
                    backgroundColor="#00000080"
                    cornerRadius="small"
                    alignment="center middle"
                  >
                    <text size="xsmall" color="#00ffff99">
                      HIGH SCORE
                    </text>
                    <text size="xlarge" weight="bold" color="#00ffff">
                      {stats.highScore || 0}
                    </text>
                  </vstack>

                  <vstack
                    grow
                    padding="small"
                    gap="none"
                    backgroundColor="#00000080"
                    cornerRadius="small"
                    alignment="center middle"
                  >
                    <text size="xsmall" color="#00ffff99">
                      BEST HEIGHT
                    </text>
                    <text size="xlarge" weight="bold" color="#ff6600">
                      {stats.bestTowerHeight || 0}
                    </text>
                  </vstack>

                  <vstack
                    grow
                    padding="small"
                    gap="none"
                    backgroundColor="#00000080"
                    cornerRadius="small"
                    alignment="center middle"
                  >
                    <text size="xsmall" color="#00ffff99">
                      STREAK
                    </text>
                    <text size="xlarge" weight="bold" color="#ffd700">
                      {stats.longestPerfectStreak || 0}
                    </text>
                  </vstack>
                </hstack>
              </vstack>
            )}

            {/* Action Button */}
            <button
              size="large"
              appearance="primary"
              onPress={() => handleEnter()}
              grow
            >
              ▶ ENTER THE GRID
            </button>

            {/* View Navigation */}
            <hstack width="100%" gap="small">
              <button
                size="medium"
                appearance="secondary"
                onPress={() => setCurrentView('stats')}
                grow
              >
                📊 STATS
              </button>
              <button
                size="medium"
                appearance="secondary"
                onPress={() => setCurrentView('leaderboard')}
                grow
              >
                🏆 LEADERBOARD
              </button>
            </hstack>

            {/* Top Players Preview */}
            {highScores.length > 0 && (
              <vstack
                width="100%"
                padding="medium"
                gap="small"
                backgroundColor="#00111180"
                cornerRadius="small"
              >
                <text size="medium" weight="bold" color="#ffd700">
                  ⭐ TOP PERFORMERS
                </text>

                {highScores.slice(0, 3).map((entry: any, index: number) => {
                  const rank = index + 1;
                  const rankColor =
                    rank === 1 ? '#ffd700' : rank === 2 ? '#c0c0c0' : '#cd7f32';
                  const isCurrentUser = entry.userId === userId;

                  return (
                    <hstack
                      key={entry.sessionId}
                      width="100%"
                      padding="small"
                      gap="small"
                      backgroundColor={isCurrentUser ? '#00ffff20' : '#00000060'}
                      cornerRadius="small"
                      alignment="middle"
                    >
                      <text size="medium" weight="bold" color={rankColor} width="30px">
                        #{rank}
                      </text>
                      <text
                        size="medium"
                        weight={isCurrentUser ? 'bold' : 'regular'}
                        color={isCurrentUser ? '#00ffff' : '#ffffff'}
                        grow
                      >
                        {entry.username}
                      </text>
                      <vstack gap="none" alignment="end">
                        <text size="small" color="#00ffff">
                          {entry.score.toLocaleString()}
                        </text>
                        <text size="xsmall" color="#ffffff99">
                          {entry.blockCount} blocks
                        </text>
                      </vstack>
                    </hstack>
                  );
                })}
              </vstack>
            )}

            {/* Footer */}
            <vstack width="100%" gap="small" alignment="center middle">
              <hstack width="100%" height="1px" backgroundColor="#00ffff40" />
              <text size="xsmall" color="#00ffff99">
                {highScores.length} USERS ON THE GRID
              </text>
            </vstack>
          </vstack>
        </zstack>
      </blocks>
    );
  },
});

// ============================================================================
// MENU ITEMS
// ============================================================================

Devvit.addMenuItem({
  label: 'Create Stonefall Post',
  location: 'subreddit',
  forUserType: 'moderator',
  onPress: async (_event, context) => {
    const { reddit, ui } = context;
    const currentSubreddit = await reddit.getCurrentSubreddit();

    try {
      const post = await reddit.submitPost({
        title: '🎮 STONEFALL - Build Your Tower on The Grid',
        subredditName: currentSubreddit.name,
        preview: (
          <vstack height="100%" width="100%" alignment="middle center">
            <text size="large">Loading Stonefall...</text>
          </vstack>
        ),
      });

      ui.showToast({ text: 'Stonefall post created!' });
      ui.navigateTo(post);
    } catch (error) {
      console.error('Error creating post:', error);
      ui.showToast('Error creating post. Check console.');
    }
  },
});

// ============================================================================
// INSTALL TRIGGER
// ============================================================================

Devvit.addTrigger({
  event: 'AppInstall',
  onEvent: async (_event, context) => {
    try {
      const { reddit } = context;
      const currentSubreddit = await reddit.getCurrentSubreddit();

      // Create initial post when app is installed
      await reddit.submitPost({
        title: '🎮 STONEFALL - Build Your Tower on The Grid',
        subredditName: currentSubreddit.name,
        preview: (
          <vstack height="100%" width="100%" alignment="middle center">
            <text size="large">Loading Stonefall...</text>
          </vstack>
        ),
      });

      console.log(`Stonefall installed on r/${currentSubreddit.name}`);
    } catch (error) {
      console.error('Error during app installation:', error);
    }
  },
});

export default Devvit;
