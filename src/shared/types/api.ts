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
  perfectStreakCount: number;
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
  gameMode: string;
  timestamp: number;
  towerBlocks: TowerBlock[];
  // Placement coordinates in the tower world
  worldX?: number;
  worldZ?: number;
  gridX?: number;
  gridZ?: number;
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
