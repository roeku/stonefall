import { context, reddit } from '@devvit/web/server';

export const createPost = async () => {
  const { subredditName } = context;
  if (!subredditName) {
    throw new Error('subredditName is required');
  }

  // Get current user for personalized title
  let username = 'Player';
  try {
    const currentUser = await reddit.getCurrentUser();
    if (currentUser) {
      username = currentUser.username;
    }
  } catch (error) {
    console.error('Error getting username:', error);
  }

  return await reddit.submitCustomPost({
    subredditName,
    title: `${username}'s Tower`,
    entry: 'default',
  });
};
