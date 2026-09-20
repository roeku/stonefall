import { context, reddit, redis } from '@devvit/web/server';
import { MAP_POST } from './keys';

/**
 * The map post: the shared grid, the keeps, the land.
 *
 * `postData.kind` is how the client tells this post from a relay post; both are served by the
 * same bundle. Posts from before the field existed have no postData and are read as the map.
 */
export const createPost = async () => {
  const { subredditName } = context;
  if (!subredditName) {
    throw new Error('subredditName is required');
  }

  const post = await reddit.submitCustomPost({
    subredditName,
    title: 'Stonefall',
    entry: 'default',
    postData: { kind: 'map' },
    textFallback: {
      text: 'Stack a tower, raise it on the shared grid, hold your ground. Open the post to play.',
    },
  });
  // The newest map post is where the relay sends people back to.
  await redis.set(MAP_POST, post.id);
  return post;
};
