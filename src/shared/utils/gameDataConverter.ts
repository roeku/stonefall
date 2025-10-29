import { GameState, GameResult, GameMode } from '../simulation/types';
import { TowerBlock, SaveGameSessionRequest } from '../types/api';

/**
 * Convert game simulation blocks to storage format
 */
export function convertBlocksToTowerBlocks(blocks: readonly any[]): TowerBlock[] {
  return blocks.map((block) => ({
    x: block.x,
    y: block.y,
    z: block.z || 0,
    rotation: block.rotation,
    width: block.width,
    depth: block.depth || block.width, // Use width as depth if not specified
    height: block.height,
  }));
}

/**
 * Calculate total perfect block count from game state
 */
export function calculatePerfectStreakCount(gameState: GameState): number {
  if (typeof gameState.perfectBlockCount === 'number') {
    return gameState.perfectBlockCount;
  }

  // Fallback for legacy game states that didn't track total perfect blocks
  const legacyCombo = (gameState as any).combo;
  return typeof legacyCombo === 'number' ? legacyCombo : 0;
}

/**
 * Convert game result to session data for storage
 */
export function convertGameResultToSessionData(
  gameResult: GameResult,
  gameMode: GameMode,
  seed: number,
  startTime: number
): SaveGameSessionRequest['sessionData'] {
  const endTime = Date.now();
  const perfectStreakCount = calculatePerfectStreakCount(gameResult.finalState);

  return {
    gameMode,
    seed,
    startTime,
    endTime,
    finalScore: gameResult.finalScore,
    blockCount: gameResult.blockCount,
    maxCombo: gameResult.maxCombo,
    perfectStreakCount,
    gameOverReason: gameResult.gameOverReason,
    towerBlocks: convertBlocksToTowerBlocks(gameResult.finalState.blocks),
  };
}

/**
 * Convert stored tower blocks back to game blocks for recreation
 */
export function convertTowerBlocksToGameBlocks(towerBlocks: TowerBlock[]): any[] {
  return towerBlocks.map((block) => ({
    x: block.x,
    y: block.y,
    z: block.z || 0,
    rotation: block.rotation,
    width: block.width,
    depth: block.depth || block.width,
    height: block.height,
    velocityY: 0,
    isFalling: false,
  }));
}

/**
 * Calculate tower statistics for display
 */
export function calculateTowerStats(towerBlocks: TowerBlock[]) {
  if (towerBlocks.length === 0) {
    return {
      height: 0,
      width: 0,
      volume: 0,
      centerOfMass: { x: 0, y: 0, z: 0 },
    };
  }

  let totalVolume = 0;
  let totalMass = 0;
  let centerX = 0;
  let centerY = 0;
  let centerZ = 0;

  let minX = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const block of towerBlocks) {
    const volume = block.width * block.height * (block.depth || block.width);
    totalVolume += volume;
    totalMass += volume; // Assuming uniform density

    centerX += block.x * volume;
    centerY += block.y * volume;
    centerZ += (block.z || 0) * volume;

    const halfWidth = block.width / 2;
    minX = Math.min(minX, block.x - halfWidth);
    maxX = Math.max(maxX, block.x + halfWidth);
    maxY = Math.max(maxY, block.y + block.height);
  }

  return {
    height: maxY,
    width: maxX - minX,
    volume: totalVolume,
    centerOfMass: {
      x: centerX / totalMass,
      y: centerY / totalMass,
      z: centerZ / totalMass,
    },
  };
}
