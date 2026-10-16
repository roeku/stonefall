import { describe, expect, it } from 'vitest';
import { GameSimulation, RELAY_TUNING, RUN_TUNING } from './gameSimulation';
import { MAX_TURN_TICKS, createTurnSimulation, healedTop, replayTurn } from './runSimulation';
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

/** The crossing of a block `laid` blocks into a turn, as a tick from its sweep's start. */
const crossingTickAfter = (blocks: Block[], laid: number): number => {
  const { sim, state } = createTurnSimulation(blocks, laid);
  let s = state;
  const axis = blocks.length % 2 === 0 ? 'x' : 'z';
  const top = blocks[blocks.length - 1]!;
  const centre = axis === 'x' ? top.x : (top.z ?? 0);
  const half = Math.ceil(100000 / sim.getSlideSpeedForBlockCount(blocks.length) / 2);
  let best = 1;
  let bestErr = Infinity;
  for (let t = 1; t <= half; t++) {
    s = sim.stepSimulation(s);
    const err = Math.abs((axis === 'x' ? s.currentBlock!.x : (s.currentBlock!.z ?? 0)) - centre);
    if (err < bestErr) {
      bestErr = err;
      best = s.tick + 1;
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

  it('ramps far more gently than a solo run, and keeps climbing past the knee', () => {
    const solo = new GameSimulation(0, 'rotating_block');
    const relay = new GameSimulation(0, 'relay');
    expect(relay.getSlideSpeedForBlockCount(300)).toBeLessThan(
      solo.getSlideSpeedForBlockCount(300)
    );
    const knee = relay.getSlideSpeedForBlockCount(RELAY_TUNING.SPEED_KNEE);
    const late = relay.getSlideSpeedForBlockCount(2000);
    // Two thousand blocks used to sweep exactly like three hundred and twenty.
    expect(late).toBeGreaterThan(knee + 300);
    expect(late).toBeLessThan(RELAY_TUNING.MAX_SPEED);
    // A solo run's ramp is one slope, as it was.
    expect(solo.getSlideSpeedForBlockCount(100)).toBe(
      solo.getSlideSpeedForBlockCount(0) + RUN_TUNING.SPEED_PER_BLOCK * 100
    );
  });

  it('speeds up with every block a turn has laid, up to a limit', () => {
    const blocks = tower(40);
    const speedAfter = (laid: number) =>
      createTurnSimulation(blocks, laid).sim.getSlideSpeedForBlockCount(40);
    expect(speedAfter(1)).toBe(speedAfter(0) + RELAY_TUNING.BURST_SPEED_STEP);
    expect(speedAfter(100)).toBe(speedAfter(0) + RELAY_TUNING.MAX_BURST_SPEED);
    // The same tap lands differently on the third block of a turn than on the first.
    const tick = crossingTick(blocks);
    expect(replayTurn(blocks, tick, 'relay', 0)!.lastPlacement?.isPositionPerfect).toBe(true);
    expect(JSON.stringify(replayTurn(blocks, tick, 'relay', 3)!.blocks)).not.toBe(
      JSON.stringify(replayTurn(blocks, tick, 'relay', 0)!.blocks)
    );
  });

  it('plays a whole turn in one simulation exactly as the server replays it block by block', () => {
    // The client (useRelayTurn) keeps one simulation for a turn and sends each tap counted from
    // where its block's sweep began; the server replays each from fresh with the turn's count.
    for (const start of [12, 640, 2001]) {
      const standing = tower(start);
      const { sim, state } = createTurnSimulation(standing, 0);
      let s = state;
      let spawn = 0;
      let laid = 0;
      let server = standing;
      // Taps around the middle of each sweep, a few ticks either side: some perfect, some not.
      const jitter = [0, 3, -2, 5, -4, 1, 6, -6];
      for (const off of jitter) {
        const wait = Math.max(1, crossingTickAfter(server, laid) + off);
        for (let k = 1; k < wait; k++) s = sim.stepSimulation(s);
        const tick = s.tick + 1;
        const next = sim.stepSimulation(s, { tick });
        const replay = replayTurn(server, tick - spawn, 'relay', laid);
        expect(replay!.isGameOver).toBe(next.isGameOver);
        if (next.isGameOver) break;
        expect(JSON.stringify(replay!.blocks)).toBe(JSON.stringify(next.blocks));
        server = replay!.blocks;
        s = next;
        spawn = next.tick;
        laid += 1;
        sim.setBurst(laid);
      }
      expect(laid).toBeGreaterThan(3);
    }
  });

  it('can miss a whole top only on a tall tower, at the end of the sweep', () => {
    /** The furthest the sweep takes the block off the top, in units of the top's width. */
    const reach = (n: number) => {
      const { sim, state } = createTurnSimulation(tower(n));
      let s = state;
      let far = 0;
      const axis = n % 2 === 0 ? 'x' : 'z';
      for (let t = 0; t < 400; t++) {
        s = sim.stepSimulation(s);
        far = Math.max(far, Math.abs(axis === 'x' ? s.currentBlock!.x : (s.currentBlock!.z ?? 0)));
      }
      return far / (DEFAULT_CONFIG.TOWER_WIDTH * 2);
    };
    expect(reach(300)).toBeLessThanOrEqual(1);
    expect(reach(RELAY_TUNING.OVERSHOOT_FROM)).toBeLessThanOrEqual(1);
    expect(reach(2000)).toBeGreaterThan(1.08);
    // And a tap out there misses it.
    const blocks = tower(2000);
    expect(replayTurn(blocks, 1)!.isGameOver).toBe(true);
  });
});
