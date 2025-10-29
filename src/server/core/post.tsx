import { context, reddit } from '@devvit/web/server';
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
    splash: {
      appDisplayName: 'STONEFALL',
      backgroundUri: 'loading.gif',
      buttonLabel: '▶ ENTER THE GRID',
      description: 'Stack blocks to build the highest tower on The Grid',
      heading: 'Build Your Tower',
    },
    subredditName: subredditName,
    title: `${username}'s Tower - STONEFALL`,
  });
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

  const splashDescription = highlightPieces.join(' • ');
  const buttonLabel = typeof rank === 'number' && rank <= 3 ? '▶ CHALLENGE' : '▶ PLAY NOW';
  const heading = `${username.toUpperCase()}'S TOWER`;

  const titleSegments = [`🏆 ${username}'s Stonefall Tower`, `${scoreText} pts`];
  if (typeof rank === 'number' && rank > 0) {
    titleSegments.push(`#${rank}`);
  }
  const title = titleSegments.join(' • ');

  return await reddit.submitCustomPost({
    splash: {
      appDisplayName: 'STONEFALL',
      backgroundUri: 'loading.gif',
      buttonLabel,
      description: splashDescription,
      heading,
    },
    subredditName,
    title,
  });
};
