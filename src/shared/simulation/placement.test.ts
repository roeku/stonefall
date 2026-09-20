import { describe, it, expect } from 'vitest';
import { RUN_TUNING } from './gameSimulation';
import { createRunSimulation } from './runSimulation';
import type { GameState } from './types';

/**
 * What a landing reports about itself.
 *
 * The run had two answers to "was that perfect?" and they disagreed. The score used the grace
 * band; the client lit its flash, its chain and its sound from `lastPlacement.noTrim`, which
 * was true only when the moving block's extent came out exactly equal to the tower's. A block
 * spawned square from the tower's *width* while the tower's depth had gone its own way, so for
 * the thirty ticks the size took to lerp into agreement, every drop -- however flush -- landed
 * a few thousandths off and was announced as a miss. These lock the two answers together.
 */

const axisOf = (blockCount: number): 'x' | 'z' => (blockCount % 2 === 0 ? 'x' : 'z');

const alignmentError = (state: GameState): number => {
  const moving = state.currentBlock;
  const top = state.blocks[state.blocks.length - 1];
  if (!moving || !top) return Infinity;
  return axisOf(state.blocks.length) === 'x'
    ? Math.abs(moving.x - top.x)
    : Math.abs((moving.z ?? 0) - (top.z ?? 0));
};

/** Step until the drop would land within `window` of the tower's centre, then tap. */
const dropInside = (
  sim: ReturnType<typeof createRunSimulation>,
  start: GameState,
  window: number
): GameState => {
  let state = start;
  for (let guard = 0; guard < 4000; guard++) {
    const next = sim.stepSimulation(state);
    if (alignmentError(next) <= window) return sim.stepSimulation(next, { tick: next.tick + 1 });
    state = next;
  }
  throw new Error('the block never swept through the window');
};

/** Step until the drop would land at least `offset` off centre, then tap. */
const dropOutside = (
  sim: ReturnType<typeof createRunSimulation>,
  start: GameState,
  offset: number
): GameState => {
  let state = start;
  for (let guard = 0; guard < 4000; guard++) {
    const next = sim.stepSimulation(state);
    if (alignmentError(next) >= offset) return sim.stepSimulation(next, { tick: next.tick + 1 });
    state = next;
  }
  throw new Error('the block never swept past the offset');
};

describe('a landing reports one answer', () => {
  it('calls a drop inside the band perfect and untrimmed, taken as early as it can be', () => {
    const sim = createRunSimulation(4242);
    // A miss first, so the tower's two axes differ and the next block has something to
    // inherit wrongly.
    let state = dropOutside(sim, sim.createInitialState(), 1500);
    expect(state.lastPlacement?.isPositionPerfect).toBe(false);

    // Three in a row, each taken the moment the block enters the window -- which is while the
    // old code was still lerping the spawned block toward the tower's footprint.
    for (let i = 0; i < 3; i++) {
      state = dropInside(sim, state, 200);
      expect(state.lastPlacement?.isPositionPerfect).toBe(true);
      expect(state.lastPlacement?.noTrim).toBe(true);
      expect(state.combo).toBe(i + 1);
    }
  });

  it("spawns the next block with the tower's footprint on both axes", () => {
    const sim = createRunSimulation(99);
    const state = dropOutside(sim, sim.createInitialState(), 1500);
    const top = state.blocks[state.blocks.length - 1]!;
    const moving = state.currentBlock!;

    expect(top.width).not.toBe(top.depth); // the miss narrowed one axis only
    expect(moving.width).toBe(top.width);
    expect(moving.depth).toBe(top.depth);
  });

  it('keeps a perfect free: nothing is cut and the tower keeps its size', () => {
    const sim = createRunSimulation(7);
    const state = dropInside(sim, sim.createInitialState(), 200);
    const landed = state.blocks[state.blocks.length - 1]!;

    expect(state.recentTrimEffects).toHaveLength(0);
    expect(landed.width).toBe(8000);
    expect(landed.depth).toBe(8000);
  });
});

describe('the perfect band is the share of the block the tuning says', () => {
  it('scales with the landing extent instead of stopping at a fixed width', () => {
    const sim = createRunSimulation(1) as unknown as {
      perfectBandFor(extent: number): number;
    };
    expect(sim.perfectBandFor(8000)).toBe((8000 * RUN_TUNING.PERFECT_BAND_RATIO) / 1000);
    expect(sim.perfectBandFor(4000)).toBe((4000 * RUN_TUNING.PERFECT_BAND_RATIO) / 1000);
    // ...down to the floor that keeps a needle landable.
    expect(sim.perfectBandFor(200)).toBe(RUN_TUNING.MIN_PERFECT_BAND);
  });
});
