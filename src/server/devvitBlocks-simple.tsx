import { Devvit } from '@devvit/public-api';

// Configure Devvit
Devvit.configure({
    redditAPI: true,
    redis: true,
    http: true,
    realtime: true,
});

// ============================================================================
// CUSTOM POST TYPE - Simple Blocks with WebView
// ============================================================================

Devvit.addCustomPostType({
    name: 'Stonefall Tower Game',
    description: 'Stack blocks to build the highest tower on The Grid',
    height: 'tall',
    render: (context) => {
        const { useState } = context;

        // Simple state - just track if webview is open
        const [showWebView, setShowWebView] = useState(false);

        // If webview is open, show it
        if (showWebView) {
            return (
                <blocks height="tall">
                    <vstack width="100%" height="100%" alignment="top start">
                        <webview
                            id="stonefall-game"
                            url="index.html"
                            width="100%"
                            height="100%"
                            grow
                        />
                    </vstack>
                </blocks>
            );
        }

        // Show static blocks preview - no async data loading
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
                            <text size="medium" color="#00ffff99">
                                STACK · SURVIVE · DOMINATE THE GRID
                            </text>
                        </vstack>

                        {/* Info Card */}
                        <vstack padding="medium" gap="small" backgroundColor="#00111180" cornerRadius="medium" width="100%">
                            <text size="large" weight="bold" color="#00ffff" alignment="center">
                                🎮 HOW TO PLAY
                            </text>
                            <text size="medium" color="#ffffff" alignment="center">
                                • Tap to drop blocks and build your tower
                            </text>
                            <text size="medium" color="#ffffff" alignment="center">
                                • Perfect drops earn combo multipliers
                            </text>
                            <text size="medium" color="#ffffff" alignment="center">
                                • Survive as long as possible
                            </text>
                            <text size="small" color="#ffd700" alignment="center">
                                ⭐ Reach the top 50 to join THE GRID
                            </text>
                        </vstack>

                        {/* Play Button */}
                        <button
                            size="large"
                            appearance="primary"
                            onPress={() => setShowWebView(true)}
                            grow
                            width="100%"
                        >
                            ▶ ENTER THE GRID
                        </button>

                        {/* Footer */}
                        <text size="small" color="#ffffff66" alignment="center">
                            A TRON-inspired block stacking experience
                        </text>
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
            ui.showToast({ text: 'Failed to create post', appearance: 'neutral' });
        }
    },
});

export default Devvit;
