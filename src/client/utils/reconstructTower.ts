import { GameSimulation, GameState, ReplayData, GameMode } from '../../shared/simulation';
import { Block } from '../../shared/simulation/types';

/**
 * Reconstructs the final blocks of a tower from its replay data.
 * This runs a fast-forward simulation on the client.
 */
export function reconstructTowerBlocks(replay: ReplayData): Block[] {
  try {
    const { seed, gameMode, inputs } = replay;

    // Sort inputs by tick to ensure efficient consuming
    const sortedInputs = [...inputs].sort((a, b) => a.tick - b.tick);
    let inputIndex = 0;

    const sim = new GameSimulation(seed, gameMode as GameMode);

    // Config optimizations for reconstruction (skip effects calculation?)
    // Note: GameSimulation doesn't have an explicit 'headless' mode but we can ignore effect arrays

    let state = sim.createInitialState();

    // Safety break
    const MAX_TICKS = 200000;
    // Typical game is ~2000 ticks. 200k is plenty safe.

    // Fast-forward
    while (!state.isGameOver && state.tick < MAX_TICKS) {
      // If next input is exactly at this tick, or we passed it (shouldn't happen with step-by-step)
      let currentInput = undefined;

      // Handle multiple inputs per tick if valid, but simulation usually accepts one
      if (inputIndex < sortedInputs.length && sortedInputs[inputIndex].tick === state.tick) {
        currentInput = sortedInputs[inputIndex];
        inputIndex++;
      }

      state = sim.stepSimulation(state, currentInput);

      // Optimization: If we ran out of inputs, and we just want to settle the physics?
      // Actually, without inputs, the game might continue forever if blocks don't drop?
      // In Stonefall, blocks drop automatically. So we must continue until GameOver.
    }

    return state.blocks;
  } catch (e) {
    console.error('Failed to reconstruct tower:', e);
    return [];
  }
}
