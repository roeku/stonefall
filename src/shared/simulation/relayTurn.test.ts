import { describe, expect, it } from 'vitest';
import { GameSimulation, RELAY_TUNING, RUN_TUNING } from './gameSimulation';
import { MAX_TURN_TICKS, healedTop, replayTurn } from './runSimulation';
import type { Block } from './types';
import { DEFAULT_CONFIG } from './types';

/**
 * One turn on the shared tower: the same sweep from the same blocks, whoever rebuilds it.
 */

/** A standing tower of `n` blocks, all full width. */
const tower = (n: number): Block[] => {
  const w = DEFAULT_CONFIG.TOWER_WIDTH * 2;
  const h = DEFAULT_CONFIG.BLOCK_HEIGHT;
  return Array.from({ length: n }, (_, i) => ({
    x: 0,
    z: 0,
    y: i * h,
    rotation: 0,
    width: w,
    depth: w,
    height: h,
  }));
};

/** The tick at which the moving block first crosses the centre, found by walking the sweep. */
const crossingTick = (blocks: Block[]): number => {
  const sim = new GameSimulation(0, 'relay') as GameSimulation & {
    setSlideSpeedMultiplier(m: number): void;
    setSlideBounds(b: number): void;
    setInstantPlaceMain(v: boolean): void;
  };
  sim.setSlideSpeedMultiplier(RELAY_TUNING.BASE_SPEED);
  sim.setSlideBounds(RUN_TUNING.DEFAULT_SLIDE_BOUNDS);
  sim.setInstantPlaceMain(true);
  let state = sim.createStateFromBlocks(blocks);
  const axis = blocks.length % 2 === 0 ? 'x' : 'z';
  let best = 1;
  let bestErr = Infinity;
  for (let t = 1; t < 400; t++) {
    state = sim.stepSimulation(state);
    const cb = state.currentBlock!;
    const err = Math.abs(axis === 'x' ? cb.x : (cb.z ?? 0));
    if (err < bestErr) {
      bestErr = err;
      best = state.tick + 1;
    }
  }
  return best;
};

describe('a relay turn', () => {
  it('lands a block on a tap at the crossing, and reproduces exactly', () => {
    const blocks = tower(12);
    const tick = crossingTick(blocks);
    const a = replayTurn(blocks, tick);
    const b = replayTurn(blocks, tick);
    expect(a).not.toBeNull();
    expect(a!.isGameOver).toBe(false);
    expect(a!.blocks).toHaveLength(13);
    expect(a!.lastPlacement?.isPositionPerfect).toBe(true);
    expect(JSON.stringify(a!.blocks)).toBe(JSON.stringify(b!.blocks));
  });

  it('is a miss on a tap at the start of the sweep', () => {
    const result = replayTurn(tower(12), 1);
    expect(result).not.toBeNull();
    expect(result!.isGameOver).toBe(true);
  });

  it('refuses ticks outside a turn', () => {
    expect(replayTurn(tower(3), 0)).toBeNull();
    expect(replayTurn(tower(3), MAX_TURN_TICKS + 1)).toBeNull();
    expect(replayTurn(tower(3), 2.5)).toBeNull();
  });

  it('heals the top to full width and nothing else', () => {
    const blocks = tower(5);
    const narrow: Block[] = [
      ...blocks.slice(0, -1),
      { ...blocks[4]!, width: 2000, depth: 3000, x: 500 },
    ];
    const healed = healedTop(narrow);
    expect(healed).toHaveLength(5);
    expect(healed[4]!.width).toBe(DEFAULT_CONFIG.TOWER_WIDTH * 2);
    expect(healed[4]!.depth).toBe(DEFAULT_CONFIG.TOWER_WIDTH * 2);
    expect(healed[4]!.x).toBe(500);
    expect(healed[3]).toEqual(blocks[3]);
  });

  it('ramps far more gently than a solo run', () => {
    const solo = new GameSimulation(0, 'rotating_block');
    const relay = new GameSimulation(0, 'relay');
    expect(relay.getSlideSpeedForBlockCount(300)).toBeLessThan(
      solo.getSlideSpeedForBlockCount(300)
    );
    expect(relay.getSlideSpeedForBlockCount(2000)).toBe(RELAY_TUNING.MAX_SPEED);
  });
});
