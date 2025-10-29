import { Devvit } from '@devvit/public-api';

// Configure Devvit with required capabilities
Devvit.configure({
  redditAPI: true,
  redis: true,
  http: true,
});

// ============================================================================
// MENU ITEM - Create Game Post
// ============================================================================

Devvit.addMenuItem({
  label: 'Create Stonefall Game Post',
  location: 'subreddit',
  onPress: async (_event, context) => {
    const { reddit, ui } = context;
    try {
      const subreddit = await reddit.getCurrentSubreddit();
      const post = await reddit.submitPost({
        title: '⬢ STONEFALL - Build Your Tower on The Grid',
        subredditName: subreddit.name,
        preview: (
          <vstack height="100%" width="100%" alignment="middle center">
            <text size="large">Loading Stonefall...</text>
          </vstack>
        ),
      });
      ui.showToast({ text: 'Game post created!', appearance: 'success' });
      ui.navigateTo(post);
    } catch (error) {
      console.error('Error creating post:', error);
      ui.showToast({ text: 'Error creating post. Check console.', appearance: 'error' });
    }
  },
});

// ============================================================================
// CUSTOM POST TYPE - Interactive Blocks with WebView
// ============================================================================

Devvit.addCustomPostType({
  name: 'Stonefall Tower Game',
  description: 'Stack blocks to build the highest tower on The Grid',
  height: 'tall',
  render: (context) => {
    const { useState, useAsync, ui } = context;

    // Track if webview is open
    const [webviewVisible, setWebviewVisible] = useState(false);

    // Load user data with useAsync
    const { data: currentUser, loading: userLoading } = useAsync(async () => {
      try {
        const user = await context.reddit.getCurrentUser();
        return user ? { username: user.username, id: user.id } : null;
      } catch (error) {
        console.error('Error getting current user:', error);
        return null;
      }
    });

    // Load user stats
    const { data: userStats } = useAsync(async () => {
      if (!currentUser?.id) return null;
      try {
        const statsKey = `user:${currentUser.id}:stats`;
        const statsJson = await context.redis.get(statsKey);
        return statsJson ? JSON.parse(statsJson) : null;
      } catch (error) {
        console.error('Error fetching user stats:', error);
        return null;
      }
    }, { depends: [currentUser] });

    // Load top 3 leaderboard
    const { data: topScores } = useAsync(async () => {
      try {
        const highScoresData = await context.redis.zRange('leaderboard:high_scores', 0, 2, {
          reverse: true,
          by: 'rank',
        });

        const scores = await Promise.all(
          highScoresData.map(async (entry) => {
            const [userId, sessionId] = entry.member.split(':');
            const sessionKey = `session:${sessionId}`;
            const sessionData = await context.redis.hGetAll(sessionKey);
            return {
              username: sessionData.username || 'Unknown',
              score: parseInt(sessionData.score || '0'),
            };
          })
        );

        return scores;
      } catch (error) {
        console.error('Error fetching leaderboard:', error);
        return [];
      }
    });

    const username = currentUser?.username || 'Player';
    const stats = userStats || null;
    const topPerformers = topScores || [];

    // If webview is visible, show it
    if (webviewVisible) {
      return (
        <blocks height="tall">
          <vstack width="100%" height="100%" alignment="top start">
            <webview
              id="game-webview"
              url="index.html"
              width="100%"
              height="100%"
              grow
            />
          </vstack>
        </blocks>
      );
    }

    // Show interactive blocks preview
    return (
      <blocks height="tall">
        <zstack width="100%" height="100%" alignment="center middle">
          {/* Background */}
          <vstack width="100%" height="100%" backgroundColor="#000811" />

          {/* Content */}
          <vstack padding="large" gap="medium" alignment="center middle" width="90%">
            {/* Title */}
            <vstack gap="small" alignment="center middle">
              <text size="xxlarge" weight="bold" color="#00ffff">
                ⬢ STONEFALL
              </text>
              <text size="medium" color="#ffffff99">
                Build Your Tower on The Grid
              </text>
            </vstack>

            {/* User Stats Card */}
            {stats && (
              <vstack padding="medium" gap="small" backgroundColor="#00111180" cornerRadius="medium" width="100%">
                <hstack width="100%" alignment="middle center">
                  <text size="large" weight="bold" color="#00ffff">
                    {username}'s Stats
                  </text>
                </hstack>
                <hstack width="100%" gap="medium">
                  <vstack grow alignment="center middle" padding="small">
                    <text size="xxlarge" weight="bold" color="#ffd700">
                      {(stats.highScore || 0).toLocaleString()}
                    </text>
                    <text size="small" color="#ffffff99">High Score</text>
                  </vstack>
                  <vstack grow alignment="center middle" padding="small">
                    <text size="xxlarge" weight="bold" color="#ff6600">
                      {stats.bestTowerHeight || 0}
                    </text>
                    <text size="small" color="#ffffff99">Best Height</text>
                  </vstack>
                </hstack>
              </vstack>
            )}

            {/* Top Performers */}
            {topPerformers.length > 0 && (
              <vstack padding="medium" gap="small" backgroundColor="#00111180" cornerRadius="medium" width="100%">
                <text size="medium" weight="bold" color="#00ffff" alignment="center">
                  🏆 Top Performers
                </text>
                {topPerformers.map((player, index) => (
                  <hstack key={`player-${index}`} width="100%" alignment="middle" gap="small">
                    <text size="large" color="#ffd700">
                      {index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉'}
                    </text>
                    <text color="#ffffff" grow>{player.username}</text>
                    <text weight="bold" color="#00ffff">{player.score.toLocaleString()}</text>
                  </hstack>
                ))}
              </vstack>
            )}

            {/* Play Button */}
            <button
              size="large"
              appearance="primary"
              onPress={() => setWebviewVisible(true)}
              grow
              width="100%"
            >
              🎮 PLAY NOW
            </button>

            {/* Info */}
            <text size="small" color="#ffffff66" alignment="center">
              Tap to drop blocks • Perfect drops earn combos • Build the highest tower!
            </text>
          </vstack>
        </zstack>
      </blocks>
    );
  },
});

// Export the configured Devvit instance
export default Devvit;
