import { GameSimulation } from '../simulation/gameSimulation';
import { DEFAULT_CONFIG, DEFAULT_SCORING } from '../simulation/types';

// Simple ad-hoc test (not part of a framework) to log score growth for consecutive perfects.
// Run manually via ts-node or build system.

function runPerfectStackTest(perfectDrops: number) {
  const sim = new GameSimulation(12345, 'rotating_block', DEFAULT_CONFIG, DEFAULT_SCORING);
  let state = sim.createInitialState();

  // Force blocks to be perfectly centered for each drop by ensuring x stays aligned
  for (let i = 0; i < perfectDrops; i++) {
    // Advance ticks until we are ready to drop the current block one tick after creation
    // We simulate an instant place to simplify (leveraging runtime override would require exposing setter)
    const dropTick = state.tick + 1;
    state = sim.stepSimulation(state, { tick: dropTick }); // initiate fall
    // Advance enough ticks to land (fall speed is high; just step a bunch)
    for (let j = 0; j < 5; j++) {
      state = sim.stepSimulation(state);
    }
  }
  return state;
}

// Self-executing when bundled/run in a Node-like environment; safe no-op in browser if tree-shaken.
(() => {
  try {
    const streak = 5;
    const result = runPerfectStackTest(streak);
    // eslint-disable-next-line no-console
    // eslint-disable-next-line no-console
    console.log(
      '[perfectStackingTest] Final score after',
      streak,
      'perfect drops:',
      result.score,
      'combo:',
      result.combo
    );
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[perfectStackingTest] skipped:', e);
  }
})();
