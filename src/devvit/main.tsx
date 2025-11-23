import { Devvit } from '@devvit/public-api';

Devvit.configure({
  redditAPI: true,
  redis: true,
});

Devvit.addCustomPostType({
  name: 'Stonefall Tower Game',
  description: 'Stack blocks to build the highest tower on The Grid',
  height: 'tall',
  render: (_context) => {
    return (
      <webview
        id="stonefall-webview"
        url="index.html"
        width="100%"
        height="100%"
        onMessage={async (msg) => {
          const message = msg as unknown as { type: string };
          if (message.type === 'APP_READY' && _context.postId) {
            const currentPost = await _context.reddit.getPostById(_context.postId);
            const username = currentPost.authorName;

            _context.ui.webView.postMessage('stonefall-webview', {
              type: 'INIT_CONTEXT',
              payload: {
                username: username,
                postId: _context.postId
              }
            });
          }
        }}
      />
    );
  },
});

export default Devvit;
