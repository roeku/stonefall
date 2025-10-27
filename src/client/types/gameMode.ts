// Unified game mode system
export type GameMode = 'playing' | 'exploring' | 'post-game';

export interface GameModeState {
  mode: GameMode;
  playerTower?: any;
  selectedCoordinate?: any;
}

// Camera settings that must be preserved for RTS-style view
export const RTS_CAMERA_CONFIG = {
  position: [30.4, 21.1, 30] as const,
  rotation: [(-30 * Math.PI) / 180, (30 * Math.PI) / 180, 0] as const,
  fov: 14,
  lookAt: [0, 4, 0] as const,
  offsetX: 30.4, // Horizontal offset for following
} as const;
