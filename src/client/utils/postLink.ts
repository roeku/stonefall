import { context, navigateTo } from '@devvit/web/client';

/** Go to another post of this app, by id. Falls back to a new tab outside the platform. */
export const openPost = (postId: string): void => {
  const sub = context?.subredditName;
  const id = postId.replace(/^t3_/, '');
  const url = sub
    ? `https://www.reddit.com/r/${sub}/comments/${id}`
    : `https://www.reddit.com/comments/${id}`;
  try {
    navigateTo(url);
  } catch {
    window.open(url, '_blank');
  }
};
