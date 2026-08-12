import type { PlayerColorChoice } from './playerColors';
import type { DropInput } from '../simulation/types';

export type InitResponse = {
  type: 'init';
  postId: string;
  username: string;
  replayData?: ReplayData;
  sessionId?: string;
  postAuthor?: string;
  leaderboardView?: boolean;
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

export interface ReplayData {
  version: number;
  seed: number;
  gameMode: string;
  inputs: DropInput[];
  finalScore: number;
  finalTick: number;
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
  playerColorChoice?: PlayerColorChoice | null;
  replayData?: ReplayData;
  // Placement coordinates (optional, merged from tower map)
  worldX?: number;
  worldZ?: number;
  gridX?: number;
  gridZ?: number;
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
  elo?: number;
  score: number;
  blockCount: number;
  perfectStreak: number;
  // For compatibility, this still represents total perfect blocks displayed in the grid
  maxCombo?: number; // Longest perfect streak achieved during this session
  gameMode: string;
  timestamp: number;
  towerBlocks: TowerBlock[];
  playerColorChoice?: PlayerColorChoice | null;
  // Placement coordinates in the tower world
  worldX?: number;
  worldZ?: number;
  gridX?: number;
  gridZ?: number;
  isPersonalBest?: boolean;
  isDefeated?: boolean; // Whether this tower has been defeated by the current player
  /**
   * Vertical offset when this tower is stacked on others in the same cell: the summed height
   * of everything beneath it. Absent or 0 means it sits on the ground.
   *
   * Fixed-point at the same scale as TowerBlock coordinates (1000 = one world unit). Computed
   * server-side by PlayerGridService.resolveGrid(), which is what holds the stack order.
   */
  stackBaseY?: number;
  // Challenge-mode towers additionally carry their own id and replay payload
  towerId?: string;
  replayData?: ReplayData | null;
}

export type SaveGameSessionRequest = {
  sessionData: Omit<GameSessionData, 'sessionId' | 'userId' | 'username' | 'postId'>;
  replayData: ReplayData; // Required for server-side score verification
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

export type TowerColorTotals = Record<
  PlayerColorChoice | 'unknown',
  {
    count: number;
    percentage: number;
  }
>;

export type GetTowerColorStatsResponse = {
  type: 'tower_color_stats';
  totalCount: number;
  colorTotals: TowerColorTotals;
  leadingColor: PlayerColorChoice | 'tie' | 'unknown';
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

// Player home grid
//
// A player's grid is stored as a placement list, never as geometry. Each entry points at a
// tower that already exists under `tower:{sessionId}`, so a grid costs a few dozen bytes per
// placement regardless of how large the towers on it are. This is what keeps storage
// proportional to players rather than to games played.

export interface GridPlacement {
  /** Session id of the tower being placed. */
  sessionId: string;
  gridX: number;
  gridZ: number;
  /** Position within the cell's stack, 0 = on the ground. */
  stackIndex: number;
  /**
   * Vertical extent, used to offset whatever sits above it. Fixed-point at the same scale as
   * TowerBlock coordinates (1000 = one world unit); divide by 1000 when rendering.
   */
  height: number;
  placedAt: number;
}

export interface PlayerGrid {
  userId: string;
  username: string;
  placements: GridPlacement[];
  updatedAt: number;
}

export type GetPlayerGridResponse = {
  type: 'player_grid';
  grid: PlayerGrid | null;
};

export type PlaceTowerRequest = {
  sessionId: string;
  gridX: number;
  gridZ: number;
};

export type PlaceTowerResponse = {
  type: 'place_tower';
  success: boolean;
  message?: string;
  grid?: PlayerGrid;
};

export type RemovePlacementRequest = {
  sessionId: string;
};

export type RemovePlacementResponse = {
  type: 'remove_placement';
  success: boolean;
  message?: string;
  grid?: PlayerGrid;
};

export interface ShareSessionRequest {
  username: string;
  score: number;
  blocks: number;
  perfectStreak: number; // Total perfect block placements highlighted when sharing
  rank?: number | undefined;
  totalPlayers?: number | undefined;
  madeTheGrid?: boolean | undefined;
  sessionId?: string | undefined;
  replayData?: ReplayData | undefined;
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

// Tournament Types

export interface TournamentStatusResponse {
  rank: string;
  elo: number;
  tickets: number;
  seasonId: string;
  seasonEndsAt: number;
}

export interface TournamentLeaderboardEntry {
  userId: string;
  username: string;
  elo: number;
  rank: number;
}

export interface TournamentLeaderboardResponse {
  type: 'tournament_leaderboard';
  seasonId: string;
  totalPlayers: number;
  view: 'top' | 'around';
  page: number;
  pageSize: number;
  totalPages: number;
  players: TournamentLeaderboardEntry[];
  topPlayers: TournamentLeaderboardEntry[];
  currentPlayer: TournamentLeaderboardEntry | null;
}

export interface SubmitTournamentRequest {
  replayData: ReplayData;
  score: number;
}

export interface SubmitTournamentResponse {
  success: boolean;
  newElo: number;
  rank: string;
}

export interface FindMatchResponse {
  matchId: string;
  opponent: {
    userId: string; // 'practice' for practice matches
    username: string;
    rank: string;
    elo: number;
    ghostData?: string; // Base64 compressed replay - optional for practice matches
    bestScore?: number; // Optional for practice matches
  };
  isPractice?: boolean; // Flag to indicate practice match
}

export interface ReportMatchRequest {
  matchId: string;
  result: 'win' | 'loss';
  score: number;
}

export interface ReportMatchResponse {
  success: boolean;
  eloChange: number;
  newElo: number;
  newTickets: number;
  newRank: string;
}
