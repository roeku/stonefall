import { context, reddit, redis } from '@devvit/web/server';
import type { ShareSessionRequest } from '../../shared/types/api';

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

export const createLeaderboardPost = async () => {
  const { subredditName } = context;
  if (!subredditName) {
    throw new Error('subredditName is required');
  }

  const post = await reddit.submitCustomPost({
    subredditName,
    title: 'Stonefall Elo Leaderboard',
    entry: 'default',
    postData: {
      leaderboardView: true,
    },
  });

  try {
    const postRecord = await reddit.getPostById(post.id);
    const maybeSticky =
      (postRecord as any)?.sticky ??
      (postRecord as any)?.setSticky ??
      (postRecord as any)?.pin;

    if (typeof maybeSticky === 'function') {
      await maybeSticky.call(postRecord, true);
    }
  } catch (error) {
    console.warn('Leaderboard post created but could not be pinned automatically:', error);
  }

  return post;
};

export type SharePostOptions = Omit<ShareSessionRequest, 'username'> & {
  username: string;
};

export const createSharePost = async ({
  username,
  score,
  blocks,
  perfectStreak,
  rank,
  totalPlayers,
  madeTheGrid,
  sessionId,
  replayData,
}: SharePostOptions) => {
  const { subredditName } = context;
  if (!subredditName) {
    throw new Error('subredditName is required');
  }

  const scoreText = score.toLocaleString();
  const highlightPieces: string[] = [
    `${scoreText} pts`,
    `${blocks} blocks`,
    `${perfectStreak} perfect blocks`,
  ];

  if (typeof rank === 'number' && rank > 0) {
    const rankSummary = totalPlayers
      ? `Rank #${rank}/${totalPlayers}`
      : `Rank #${rank}`;
    highlightPieces.push(rankSummary);
  } else if (madeTheGrid === true) {
    highlightPieces.push('On The Grid');
  }

  if (sessionId) {
    const suffix = sessionId.slice(-8).toUpperCase();
    highlightPieces.push(`Session ${suffix}`);
  }

  const titleSegments = [`🏆 ${username}'s Tower`, `${scoreText} pts`];
  if (typeof rank === 'number' && rank > 0) {
    titleSegments.push(`#${rank}`);
  }
  const title = titleSegments.join(' • ');

  const post = await reddit.submitCustomPost({
    subredditName,
    title,
    entry: 'default',
    postData: {
      highlightPieces,
      sessionId: sessionId ?? null,
      rank: rank ?? null,
      totalPlayers: totalPlayers ?? null,
      madeTheGrid: madeTheGrid ?? null,
      replayData: (replayData as any) ?? null,
    },
    runAs: 'USER',
    userGeneratedContent: {
      text: title,
    },
  });

  // Backup: Store session ID in Redis for this post
  if (sessionId && post.id) {
    try {
      await redis.set(`post:${post.id}:session`, sessionId);
      console.log(`[Share] Backed up session ${sessionId} for post ${post.id}`);
    } catch (e) {
      console.error('Failed to backup session ID to Redis:', e);
    }
  }

  return post;
};
