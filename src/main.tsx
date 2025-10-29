import { Devvit } from '@devvit/public-api';

// Configure Devvit with required capabilities
Devvit.configure({
  redditAPI: true,
  redis: true,
  http: true,
});

// ============================================================================
// CUSTOM POST TYPE - Interactive Blocks UI
// ============================================================================

Devvit.addCustomPostType({
  name: 'Stonefall Tower Game',
  description: 'Stack blocks to build the highest tower on The Grid',
  height: 'tall',
  render: (context) => {
    const { useState, redis, reddit, postId } = context;

    // State management - use proper type literals
    type ViewType = 'home' | 'stats' | 'leaderboard' | 'game';
    type TabType = 'scores' | 'streaks';

    const [currentView, setCurrentView] = useState<ViewType>('home');
    const [leaderboardTab, setLeaderboardTab] = useState<TabType>('scores');

    // Load user data
    const [currentUser] = useState(async () => {
      try {
        const user = await reddit.getCurrentUser();
        return user ? { username: user.username, id: user.id } : null;
      } catch (error) {
        console.error('Error getting current user:', error);
        return null;
      }
    });

    const username = currentUser?.username || 'Player';
    const userId = currentUser?.id || '';

    // Load user stats
    const [userStatsData] = useState(async () => {
      if (!userId) return null;
      try {
        const statsKey = `user:${userId}:stats`;
        const statsJson = await redis.get(statsKey);
        return statsJson ? JSON.parse(statsJson) : null;
      } catch (error) {
        console.error('Error fetching user stats:', error);
        return null;
      }
    });

    // Load leaderboard
    const [leaderboardData] = useState(async () => {
      try {
        const highScoresData = await redis.zRange('leaderboard:high_scores', 0, 9, {
          reverse: true,
          by: 'rank',
        });

        const perfectStreaksData = await redis.zRange('leaderboard:perfect_streaks', 0, 9, {
          reverse: true,
          by: 'rank',
        });

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

        return { highScores, perfectStreaks };
      } catch (error) {
        console.error('Error fetching leaderboard:', error);
        return { highScores: [], perfectStreaks: [] };
      }
    });

    const stats = userStatsData;
    const highScores = leaderboardData?.highScores || [];
    const perfectStreaks = leaderboardData?.perfectStreaks || [];
    const userRank = highScores.findIndex((entry: any) => entry.userId === userId) + 1;

    // Game Launch View
    if (currentView === 'game') {
      // Get the post URL
      const gameUrl = postId ? `https://reddit.com/r/${context.subredditName}/comments/${postId}` : '';

      return (
        <blocks height="tall">
          <zstack width="100%" height="100%" alignment="center middle">
            <vstack width="100%" height="100%" backgroundColor="#000811" />
            <vstack padding="large" gap="large" alignment="center middle" width="90%">
              <text size="xxlarge" weight="bold" color="#00ffff">
                ⬢ STONEFALL
              </text>
              <vstack padding="medium" gap="small" backgroundColor="#00111180" cornerRadius="medium" width="100%">
                <text size="large" weight="bold" color="#00ffff" alignment="center">
                  HOW TO PLAY
                </text>
                <text size="small" color="#ffffff" alignment="center">
                  • Tap to drop blocks and build your tower
                </text>
                <text size="small" color="#ffffff" alignment="center">
                  • Perfect drops earn combo multipliers
                </text>
                <text size="small" color="#ffffff" alignment="center">
                  • Survive as long as possible
                </text>
                <text size="small" color="#ffd700" alignment="center">
                  • Reach the top 50 to join THE GRID
                </text>
              </vstack>
              <vstack gap="small" width="100%">
                <text size="small" color="#ffffff99" alignment="center">
                  Open this post in the Reddit app to play!
                </text>
              </vstack>
              <button size="medium" appearance="secondary" onPress={() => setCurrentView('home')}>
                ← BACK
              </button>
            </vstack>
          </zstack>
        </blocks>
      );
    }

    // Stats View
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
                <vstack width="100%" padding="medium" gap="medium" backgroundColor="#00111180" cornerRadius="medium">
                  <hstack width="100%" gap="medium">
                    <text color="#ffffff99" grow>Total Games Played</text>
                    <text weight="bold" color="#00ffff">{stats.totalGames || 0}</text>
                  </hstack>
                  <hstack width="100%" gap="medium">
                    <text color="#ffffff99" grow>Highest Score</text>
                    <text weight="bold" color="#00ffff">{(stats.highScore || 0).toLocaleString()}</text>
                  </hstack>
                  <hstack width="100%" gap="medium">
                    <text color="#ffffff99" grow>Best Tower Height</text>
                    <text weight="bold" color="#ff6600">{stats.bestTowerHeight || 0} blocks</text>
                  </hstack>
                  <hstack width="100%" gap="medium">
                    <text color="#ffffff99" grow>Longest Perfect Streak</text>
                    <text weight="bold" color="#ffd700">{stats.longestPerfectStreak || 0}</text>
                  </hstack>
                  <hstack width="100%" gap="medium">
                    <text color="#ffffff99" grow>Average Score</text>
                    <text weight="bold" color="#00ffff">{Math.round(stats.averageScore || 0).toLocaleString()}</text>
                  </hstack>
                </vstack>
              ) : (
                <vstack padding="large" alignment="center middle">
                  <text color="#ffffff99">No stats available yet</text>
                  <text size="small" color="#ffffff66">Play a game to start building your stats!</text>
                </vstack>
              )}
            </vstack>
          </zstack>
        </blocks>
      );
    }

    // Leaderboard View
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
                <button size="medium" appearance={leaderboardTab === 'scores' ? 'primary' : 'secondary'} onPress={() => setLeaderboardTab('scores')} grow>
                  HIGH SCORES
                </button>
                <button size="medium" appearance={leaderboardTab === 'streaks' ? 'primary' : 'secondary'} onPress={() => setLeaderboardTab('streaks')} grow>
                  PERFECT STREAKS
                </button>
              </hstack>
              {displayData.length > 0 ? (
                <vstack width="100%" gap="small">
                  {displayData.map((entry: any, index: number) => {
                    const rank = index + 1;
                    const rankColor = rank === 1 ? '#ffd700' : rank === 2 ? '#c0c0c0' : rank === 3 ? '#cd7f32' : '#00ffff';
                    const isCurrentUser = entry.userId === userId;
                    return (
                      <hstack key={entry.sessionId} width="100%" padding="small" gap="small" backgroundColor={isCurrentUser ? '#00ffff20' : '#00111180'} cornerRadius="small" alignment="middle">
                        <text size="medium" weight="bold" color={rankColor} width="30px">#{rank}</text>
                        <text size="medium" weight={isCurrentUser ? 'bold' : 'regular'} color={isCurrentUser ? '#00ffff' : '#ffffff'} grow>{entry.username}</text>
                        <vstack gap="none" alignment="end">
                          <text size="small" color="#00ffff">
                            {leaderboardTab === 'scores' ? entry.score.toLocaleString() : `⭐ ${entry.perfectStreak || 0}`}
                          </text>
                          <text size="xsmall" color="#ffffff99">
                            {leaderboardTab === 'scores' ? `${entry.blockCount || 0} blocks` : `Score: ${entry.score.toLocaleString()}`}
                          </text>
                        </vstack>
                      </hstack>
                    );
                  })}
                </vstack>
              ) : (
                <vstack padding="large" alignment="center middle">
                  <text color="#ffffff99">No entries yet</text>
                  <text size="small" color="#ffffff66">Be the first to make it on the leaderboard!</text>
                </vstack>
              )}
            </vstack>
          </zstack>
        </blocks>
      );
    }

    // Home View (Default)
    return (
      <blocks height="tall">
        <zstack width="100%" height="100%" alignment="top start">
          <vstack width="100%" height="100%" backgroundColor="#000811" />
          <vstack width="100%" padding="medium" gap="medium">
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
              <hstack width="100%" padding="small" gap="small" backgroundColor="#00111180" cornerRadius="small">
                <avatar thingId={userId} facing="left" size="small" />
                <vstack gap="none" grow>
                  <text size="medium" weight="bold" color="#ffffff">{username}</text>
                  {userRank > 0 ? (
                    <text size="small" color="#ffd700">Rank #{userRank} on Grid</text>
                  ) : (
                    <text size="small" color="#ff660099">Not yet on Grid</text>
                  )}
                </vstack>
                {userRank > 0 && userRank <= 10 && (
                  <hstack width="40px" height="40px" backgroundColor={userRank === 1 ? '#ffd700' : userRank <= 3 ? '#c0c0c0' : '#cd7f32'} cornerRadius="full" alignment="center middle">
                    <text size="large" weight="bold" color="#000000">{userRank}</text>
                  </hstack>
                )}
              </hstack>
            </vstack>
            {stats && (
              <vstack width="100%" padding="medium" gap="small" backgroundColor="#00111180" cornerRadius="small">
                <text size="medium" weight="bold" color="#00ffff">▸ YOUR STATS</text>
                <hstack width="100%" gap="small">
                  <vstack grow padding="small" gap="none" backgroundColor="#00000080" cornerRadius="small" alignment="center middle">
                    <text size="xsmall" color="#00ffff99">HIGH SCORE</text>
                    <text size="xlarge" weight="bold" color="#00ffff">{stats.highScore || 0}</text>
                  </vstack>
                  <vstack grow padding="small" gap="none" backgroundColor="#00000080" cornerRadius="small" alignment="center middle">
                    <text size="xsmall" color="#00ffff99">BEST HEIGHT</text>
                    <text size="xlarge" weight="bold" color="#ff6600">{stats.bestTowerHeight || 0}</text>
                  </vstack>
                  <vstack grow padding="small" gap="none" backgroundColor="#00000080" cornerRadius="small" alignment="center middle">
                    <text size="xsmall" color="#00ffff99">STREAK</text>
                    <text size="xlarge" weight="bold" color="#ffd700">{stats.longestPerfectStreak || 0}</text>
                  </vstack>
                </hstack>
              </vstack>
            )}
            <vstack width="100%" gap="small">
              <button size="large" appearance="primary" onPress={() => setCurrentView('game')} grow>
                ▶ ENTER THE GRID
              </button>
              <hstack width="100%" gap="small">
                <button size="medium" appearance="secondary" onPress={() => setCurrentView('stats')} grow>
                  📊 STATS
                </button>
                <button size="medium" appearance="secondary" onPress={() => setCurrentView('leaderboard')} grow>
                  🏆 LEADERBOARD
                </button>
              </hstack>
            </vstack>
            {highScores.length > 0 && (
              <vstack width="100%" padding="medium" gap="small" backgroundColor="#00111180" cornerRadius="small">
                <text size="medium" weight="bold" color="#ffd700">⭐ TOP PERFORMERS</text>
                {highScores.slice(0, 3).map((entry: any, index: number) => {
                  const rank = index + 1;
                  const rankColor = rank === 1 ? '#ffd700' : rank === 2 ? '#c0c0c0' : '#cd7f32';
                  const isCurrentUser = entry.userId === userId;
                  return (
                    <hstack key={entry.sessionId} width="100%" padding="small" gap="small" backgroundColor={isCurrentUser ? '#00ffff20' : '#00000060'} cornerRadius="small" alignment="middle">
                      <text size="medium" weight="bold" color={rankColor} width="30px">#{rank}</text>
                      <text size="medium" weight={isCurrentUser ? 'bold' : 'regular'} color={isCurrentUser ? '#00ffff' : '#ffffff'} grow>{entry.username}</text>
                      <vstack gap="none" alignment="end">
                        <text size="small" color="#00ffff">{entry.score.toLocaleString()}</text>
                        <text size="xsmall" color="#ffffff99">{entry.blockCount} blocks</text>
                      </vstack>
                    </hstack>
                  );
                })}
              </vstack>
            )}
            <vstack width="100%" gap="small" alignment="center middle">
              <hstack width="100%" height="1px" backgroundColor="#00ffff40" />
              <text size="xsmall" color="#00ffff99">{highScores.length} USERS ON THE GRID</text>
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
      ui.showToast({ text: 'Error creating post. Check console.', appearance: 'error' });
    }
  },
});

// Export the configured Devvit instance
export default Devvit;
