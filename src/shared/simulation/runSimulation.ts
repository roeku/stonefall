import { GameSimulation, RUN_TUNING } from './gameSimulation';
import type { DropInput, GameMode, GameState } from './types';

/**
 * The one place a run's simulation is configured, and the one place a run is replayed.
 *
 * This exists because the client and the server now have to agree exactly. The client plays the
 * run and records the taps; the server replays those taps to work out what the run was worth. If
 * the two configured the simulation even slightly differently, every honest player's score would
 * be quietly wrong -- and the setup used to be hand-written in three places, with the client's
 * copy carrying leftovers from a debugging session ("temporarily disable seeding", a fallback to
 * a slide speed of 1000 that no longer exists anywhere else).
 *
 * So there is one configure function and one replay loop, imported by the client, the server, the
 * local harness and the tests. Disagreement is no longer something anyone can introduce by
 * editing one of them.
 */

/** The tuning knobs live on the simulation as loosely-typed setters; this is their shape. */
type Tunable = GameSimulation & {
  setSlideSpeedMultiplier(multiplier: number): void;
  setSlideBounds(bounds: number): void;
  setFallSpeedMultiplier(multiplier: number): void;
  setInstantPlaceMain(enabled: boolean): void;
};

/** A simulation set up the way a real run is played. */
export const createRunSimulation = (seed: number, mode: GameMode = 'rotating_block'): Tunable => {
  const sim = new GameSimulation(seed, mode) as Tunable;
  sim.setSlideSpeedMultiplier(RUN_TUNING.BASE_SPEED);
  sim.setSlideBounds(RUN_TUNING.DEFAULT_SLIDE_BOUNDS);
  sim.setFallSpeedMultiplier(RUN_TUNING.FALL_SPEED_MULTIPLIER);
  sim.setInstantPlaceMain(true);
  return sim;
};

/** Ticks a replay may run for before it is treated as junk. About sixteen minutes of play. */
export const MAX_REPLAY_TICKS = 60000;

/** Taps a replay may contain. */
export const MAX_REPLAY_INPUTS = 4000;

/**
 * Play a run back from its taps.
 *
 * Inputs are applied at `tick + 1`, which is the rule the client's frame loop uses when it steps
 * the simulation on a drop. Ticks are sorted and de-duplicated first: a replay listing the same
 * tick twice, or listing them out of order, is not something the game can produce, so it is
 * normalised rather than trusted or rejected.
 */
export const replayRun = (
  seed: number,
  mode: GameMode,
  inputs: ReadonlyArray<DropInput>
): GameState | null => {
  const ticks = [...new Set(inputs.map((i) => i.tick))].sort((a, b) => a - b);
  if (ticks.length === 0) return null;

  const sim = createRunSimulation(seed, mode);
  let state = sim.createInitialState();
  let next = 0;
  const limit = Math.min(MAX_REPLAY_TICKS, (ticks[ticks.length - 1] ?? 0) + 2);

  while (state.tick < limit && !state.isGameOver) {
    const want = ticks[next];
    const input: DropInput | undefined =
      want !== undefined && want === state.tick + 1 ? { tick: want } : undefined;
    if (input) next++;
    state = sim.stepSimulation(state, input);
  }
  return state;
};
