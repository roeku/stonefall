// Lazy loader for the game simulation
// This helps avoid bundling the heavy simulation code in the main chunk

let simulationModule: typeof import('../../shared/simulation') | null = null;

export const getSimulation = async () => {
  if (!simulationModule) {
    // Dynamically import the simulation module
    simulationModule = await import('../../shared/simulation');
  }
  return simulationModule;
};

export const getGameSimulation = async () => {
  const sim = await getSimulation();
  return sim.GameSimulation;
};

// Re-export types for type checking (these don't add to bundle size)
export type { GameState, DropInput, GameMode } from '../../shared/simulation';
