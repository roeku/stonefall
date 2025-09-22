// Core simulation types for deterministic gameplay
export interface GameConfig {
  readonly TICK_RATE: number;
  readonly POS_SCALE: number;
  readonly ANGLE_SCALE: number;
  readonly TOWER_WIDTH: number;
  readonly BLOCK_HEIGHT: number;
  readonly MIN_WIDTH_THRESHOLD: number;
  readonly SLIDE_BOUNDS: number;
  readonly ROTATION_SPEED: number;
  readonly GRAVITY?: number;
  readonly TERMINAL_VELOCITY?: number;
}

export const DEFAULT_CONFIG: GameConfig = {
  TICK_RATE: 60,
  POS_SCALE: 1000, // Fixed-point scaling for positions
  ANGLE_SCALE: 1000, // Fixed-point scaling for angles (millidegrees)
  TOWER_WIDTH: 4 * 1000, // 4 units * scale (reasonable gameplay width)
  BLOCK_HEIGHT: 0.8 * 1000, // 0.8 units * scale (reasonable block height)
  MIN_WIDTH_THRESHOLD: 0.5 * 1000, // 0.5 units * scale
  SLIDE_BOUNDS: 3 * 1000, // 3 units * scale (reasonable slide bounds)
  ROTATION_SPEED: 0, // No rotation for classic mode
  // Physics tuning (in fixed-point units matching POS_SCALE)
  GRAVITY: 4500, // ~4.5 units/s^2
  TERMINAL_VELOCITY: 12000, // max fall speed
};

export interface Block {
  readonly x: number; // Fixed-point position
  readonly y: number; // Fixed-point position
  readonly rotation: number; // Fixed-point angle in millidegrees
  readonly width: number; // Fixed-point width
  readonly height: number; // Fixed-point height
  readonly velocityY?: number; // vertical velocity in fixed-point units per second
  readonly isFalling?: boolean;
}

export interface TrimEffect {
  readonly originalBlock: Block;
  readonly trimmedPieces: ReadonlyArray<{
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly velocityX: number;
    readonly velocityY: number;
  }>;
  readonly tick: number;
}

export interface GameState {
  readonly tick: number;
  readonly score: number;
  readonly combo: number;
  readonly blocks: ReadonlyArray<Block>;
  readonly currentBlock: Block | null;
  readonly isGameOver: boolean;
  readonly seed: number;
  readonly recentTrimEffects: ReadonlyArray<TrimEffect>;
}

export interface DropInput {
  readonly tick: number;
}

export interface GameResult {
  readonly finalScore: number;
  readonly blockCount: number;
  readonly maxCombo: number;
  readonly gameOverReason: 'width' | 'fall' | 'manual';
  readonly finalState: GameState;
}

export interface ScoringConfig {
  readonly basePoints: number;
  readonly positionPerfectWindow: number; // Fixed-point pixels
  readonly anglePerfectWindow: number; // Fixed-point degrees
  readonly positionPerfectBonus: number;
  readonly anglePerfectBonus: number;
  readonly combinedPerfectMultiplier: number; // Fixed-point multiplier
  readonly comboStepMultiplier: number; // Fixed-point multiplier
  readonly maxComboMultiplier: number; // Fixed-point multiplier
  readonly milestoneRewards: ReadonlyArray<number>;
}

export const DEFAULT_SCORING: ScoringConfig = {
  basePoints: 10,
  positionPerfectWindow: 6 * 1000, // 6 pixels * scale
  anglePerfectWindow: 8 * 1000, // 8 degrees * scale
  positionPerfectBonus: 15,
  anglePerfectBonus: 15,
  combinedPerfectMultiplier: 1600, // 1.6 * 1000
  comboStepMultiplier: 1100, // 1.1 * 1000
  maxComboMultiplier: 2000, // 2.0 * 1000
  milestoneRewards: [10, 25, 50, 100],
};

export type GameMode = 'classic' | 'rotating_block' | 'rotating_base' | 'time_attack' | 'puzzle';
