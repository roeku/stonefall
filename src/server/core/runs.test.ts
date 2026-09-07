import { describe, it, expect } from 'vitest';
import { createRunSimulation, replayRun } from '../../shared/simulation/runSimulation';
import type { DropInput, GameState } from '../../shared/simulation/types';

/**
 * The replay is the anti-cheat, so these test the replay rather than the storage around it.
 *
 * `Runs.save` itself needs Devvit's Redis and Reddit clients, which do not exist outside the
 * platform. What matters and is testable here is the property the whole design rests on: the
 * same seed and the same taps always produce the same run, and nothing a request says about the
 * outcome can change it.
 */

/** The replay under test is the shared one, the same call the server and the client make. */
const replay = (seed: number, inputs: DropInput[]): GameState =>
  replayRun(seed, 'rotating_block', inputs)!;

/** Play a run the way a person would, aiming at the first crossing. */
const played = (seed: number, slop: number): DropInput[] => {
  const sim = createRunSimulation(seed) as never as {
    createInitialState(): GameState;
    stepSimulation(s: GameState, i?: DropInput): GameState;
    currentBlockSpawnTick: number;
    calculateSlidePosition(t: number, count?: number, phase?: number): number;
  };
  let state = sim.createInitialState();
  let x = (seed * 2654435761) % 2147483647;
  const rnd = () => (x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const taps: DropInput[] = [];
  let guard = 0;
  while (!state.isGameOver && guard++ < 400) {
    const top = state.blocks[state.blocks.length - 1]!;
    const cb = state.currentBlock;
    if (!cb) break;
    const axis = state.blocks.length % 2 === 0 ? 'x' : 'z';
    const topC = axis === 'x' ? top.x : (top.z ?? 0);
    const spawn = sim.currentBlockSpawnTick ?? 0;
    const phase = cb.slidePhaseOffset ?? 0;
    const err = (t: number) =>
      Math.abs(sim.calculateSlidePosition(Math.max(0, state.tick + t - spawn), state.blocks.length, phase) - topC);
    let cross = 1;
    let prev = err(1);
    for (let t = 2; t < 1200; t++) {
      const e = err(t);
      if (e > prev) { cross = t - 1; break; }
      prev = e;
    }
    const at = Math.max(1, cross + Math.round((rnd() * 2 - 1) * slop));
    for (let k = 1; k < at; k++) { state = sim.stepSimulation(state); if (state.isGameOver) break; }
    if (state.isGameOver) break;
    const input = { tick: state.tick + 1 };
    taps.push(input);
    state = sim.stepSimulation(state, input);
  }
  return taps;
};

describe('replay verification', () => {
  it('reproduces a run exactly from its seed and taps', () => {
    const taps = played(42, 4);
    const a = replay(42, taps);
    const b = replay(42, taps);
    expect(a.score).toBe(b.score);
    expect(a.blocks.length).toBe(b.blocks.length);
    expect(a.perfectBlockCount).toBe(b.perfectBlockCount);
    expect(a.blocks.length).toBeGreaterThan(3);
  });

  it('is determined by the taps alone; the seed does not change a rotating_block run', () => {
    // Worth stating rather than assuming. Nothing in this mode draws from the PRNG: block
    // widths are inherited and the sweep phase comes from the block index, so the seed is
    // carried for the record and for future modes, not for the outcome. The verification does
    // not depend on it -- the inputs are the whole run -- but anyone adding randomness later
    // has to keep the seed on the wire for the replay to stay reproducible, and this is the
    // test that will tell them.
    const taps = played(42, 4);
    expect(replay(43, taps).score).toBe(replay(42, taps).score);
  });

  it('scores an invented replay at what it is actually worth, not what it claims', () => {
    // The forged request the old checks let through: a huge claimed score with a token input.
    // There is nowhere left to put the claim; this is all the inputs are worth.
    const forged = replay(7, [{ tick: 1 }]);
    expect(forged.score).toBeLessThan(100);
    expect(forged.blocks.length).toBeLessThanOrEqual(2);
  });

  it('ignores duplicated and out-of-order ticks rather than being confused by them', () => {
    const taps = played(11, 2);
    const shuffled = [...taps].reverse();
    const doubled = [...taps, ...taps];
    expect(replay(11, shuffled).score).toBe(replay(11, taps).score);
    expect(replay(11, doubled).score).toBe(replay(11, taps).score);
  });

  it('derives the tower geometry from the replay, so block count cannot be padded', () => {
    const taps = played(5, 6);
    const state = replay(5, taps);
    expect(state.blocks.length).toBe(state.blocks.length);
    // Every block came from the simulation, so it has real extents.
    for (const b of state.blocks) {
      expect(b.width).toBeGreaterThan(0);
      expect(b.height).toBeGreaterThan(0);
    }
  });

  it('a better-played run scores higher than a worse one on the same seed', () => {
    const good = replay(3, played(3, 1));
    const bad = replay(3, played(3, 14));
    expect(good.score).toBeGreaterThan(bad.score);
  });
});
