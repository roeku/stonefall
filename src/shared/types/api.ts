export type InitResponse = {
  type: 'init';
  postId: string;
  count: number;
  username: string;
};

export type IncrementResponse = {
  type: 'increment';
  postId: string;
  count: number;
};

export type DecrementResponse = {
  type: 'decrement';
  postId: string;
  count: number;
};

// Game session and tower tracking types
export interface TowerBlock {
  x: number;
  y: number;
  z?: number;
  rotation: number;
  width: number;
  depth?: number;
  height: number;
}

export interface GameSessionData {
  sessionId: string;
  userId: string;
  username: string;
  postId: string;
  gameMode: string;
  seed: number;
  startTime: number;
  endTime?: number;
  finalScore: number;
  blockCount: number;
  maxCombo: number;
  perfectStreakCount: number; // Total perfect block placements during the run
  gameOverReason: 'width' | 'fall' | 'manual';
  towerBlocks: TowerBlock[];
}

export interface UserStats {
  userId: string;
  username: string;
  totalGames: number;
  highScore: number;
  bestTowerHeight: number;
  longestPerfectStreak: number;
  totalPerfectBlocks: number;
  averageScore: number;
  lastPlayed: number;
}

export interface TowerMapEntry {
  sessionId: string;
  userId: string;
  username: string;
  score: number;
  blockCount: number;
  perfectStreak: number;
  // For compatibility, this still represents total perfect blocks displayed in the grid
  maxCombo?: number; // Longest perfect streak achieved during this session
  gameMode: string;
  timestamp: number;
  towerBlocks: TowerBlock[];
  // Placement coordinates in the tower world
  worldX?: number;
  worldZ?: number;
  gridX?: number;
  gridZ?: number;
  isPersonalBest?: boolean;
}

export type SaveGameSessionRequest = {
  sessionData: Omit<GameSessionData, 'sessionId' | 'userId' | 'username' | 'postId'>;
};

export type SaveGameSessionResponse = {
  type: 'save_session';
  sessionId: string;
  success: boolean;
  message?: string;
  rank?: number; // Player's rank in the leaderboard (1-based, undefined if outside top limit)
  totalPlayers: number; // Total number of players
  madeTheGrid: boolean; // Whether the player's score is in the top 50 displayed on grid
  scoreToGrid?: number; // Points needed to reach the grid (if not made it)
  improvement?: {
    lastScore?: number;
    lastBlocks?: number;
    lastPerfectStreak?: number;
  };
  personalBest?: boolean; // Whether this session set a new personal best score
  bestSessionId?: string; // Session ID representing the player's current best score
  bestScore?: number; // Player's best score after this session
  previousBestScore?: number; // Player's best score before this session (if it existed)
  bestPerfectStreak?: number; // Player's best perfect streak after this session
  previousBestPerfectStreak?: number; // Player's previous best perfect streak (if it existed)
  personalBestPerfectStreak?: boolean; // Whether this session set a new perfect streak best
};

export type GetUserStatsResponse = {
  type: 'user_stats';
  stats: UserStats | null;
  recentSessions: GameSessionData[];
};

export type GetTowerMapResponse = {
  type: 'tower_map';
  towers: TowerMapEntry[];
  totalCount: number;
};

export type UpdateTowerPlacementRequest = {
  sessionId: string;
  worldX: number;
  worldZ: number;
  gridX: number;
  gridZ: number;
};

export type UpdateTowerPlacementResponse = {
  type: 'update_placement';
  success: boolean;
  message?: string;
};

export interface ShareSessionRequest {
  username: string;
  score: number;
  blocks: number;
  perfectStreak: number; // Total perfect block placements highlighted when sharing
  rank?: number;
  totalPlayers?: number;
  madeTheGrid?: boolean;
  sessionId?: string;
}

export type ShareSessionResponse = {
  type: 'share_session';
  success: boolean;
  message?: string;
  postUrl?: string;
  postId?: string;
  subreddit?: string;
};

export type GetLeaderboardResponse = {
  type: 'leaderboard';
  highScores: Array<{
    userId: string;
    username: string;
    score: number;
    blockCount: number;
    timestamp: number;
    sessionId: string;
  }>;
  perfectStreaks: Array<{
    userId: string;
    username: string;
    perfectStreak: number;
    score: number;
    timestamp: number;
    sessionId: string;
  }>;
};

export type ClearTowersResponse = {
  status: 'success' | 'error';
  message: string;
};
