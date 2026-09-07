import { describe, it, expect } from 'vitest';
import { GameSimulation, RUN_TUNING } from './gameSimulation';
import type { GameState, DropInput } from './types';

/**
 * These lock the shape of the difficulty curve, not the exact numbers.
 *
 * The run had been shipped in a state where random tapping survived three blocks and a 67ms
 * difference in timing consistency moved the final score by a factor of 139. Both were
 * invisible in code review and obvious in measurement, so they are measured here.
 */

/**
 * The tuning lives on private methods, which is right: nothing outside the simulation should be
 * able to move the difficulty curve. A test is the one caller allowed to look at them, so the
 * shape is named here rather than reached for with `any` at each call site.
 */
type SimInternals = GameSimulation & {
  gameState: unknown;
  currentBlockSpawnTick: number;
  setSlideSpeedMultiplier(m: number): void;
  setSlideBounds(b: number): void;
  setInstantPlaceMain(v: boolean): void;
  currentSweepBounds(blockIndex: number): number;
  perfectBandFor(extent: number): number;
  calculateSlidePosition(relativeTick: number, blockCount?: number, phaseOffset?: number): number;
  calculateDrop(
    dropped: Record<string, number>,
    top: Record<string, number>,
    axis: 'x' | 'z'
  ): { newCenter: number; newExtent: number; overlapArea: number };
  createInitialState(): GameState;
  stepSimulation(state: GameState, input?: DropInput): GameState;
};

const sim = (seed = 1): SimInternals => {
  const s = new GameSimulation(seed, 'rotating_block') as unknown as SimInternals;
  s.setSlideSpeedMultiplier(RUN_TUNING.BASE_SPEED);
  s.setSlideBounds(8000);
  s.setInstantPlaceMain(true);
  return s;
};

/** Play a whole run, aiming at the first crossing and missing it by up to `slop` ticks. */
const play = (seed: number, slop: number) => {
  const s = sim(seed);
  let st: GameState = s.createInitialState();
  let x = (seed * 2654435761) % 2147483647;
  const rnd = () => (x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  let guard = 0;
  while (!st.isGameOver && guard++ < 2000) {
    const top = st.blocks[st.blocks.length - 1]!;
    const cb = st.currentBlock;
    if (!cb) break;
    const axis = st.blocks.length % 2 === 0 ? 'x' : 'z';
    const topC = axis === 'x' ? top.x : (top.z ?? 0);
    const spawn = s.currentBlockSpawnTick ?? 0;
    const phase = cb.slidePhaseOffset ?? 0;
    const err = (t: number) =>
      Math.abs(s.calculateSlidePosition(Math.max(0, st.tick + t - spawn), st.blocks.length, phase) - topC);
    let cross = 1;
    let prev = err(1);
    for (let t = 2; t < 1200; t++) {
      const e = err(t);
      if (e > prev) { cross = t - 1; break; }
      prev = e;
    }
    const at = Math.max(1, cross + Math.round((rnd() * 2 - 1) * slop));
    for (let k = 1; k < at; k++) { st = s.stepSimulation(st); if (st.isGameOver) break; }
    if (st.isGameOver) break;
    const input: DropInput = { tick: st.tick + 1 };
    st = s.stepSimulation(st, input);
  }
  return st;
};

const avg = (slop: number, n = 12) => {
  let blocks = 0, score = 0;
  for (let i = 0; i < n; i++) { const st = play(i + 1, slop); blocks += st.blocks.length; score += st.score; }
  return { blocks: blocks / n, score: score / n };
};

describe('sweep bounds follow the block', () => {
  it('narrows the sweep as the tower narrows, so the odds of a drop stay comparable', () => {
    const s = sim();
    const wide = s.currentSweepBounds(0);
    s.gameState = { blocks: [{ x: 0, z: 0, y: 0, width: 2000, depth: 2000, height: 1500, rotation: 0 }] };
    const narrow = s.currentSweepBounds(0);
    expect(narrow).toBeLessThan(wide);
    // A two unit block must still have somewhere to land across most of its sweep.
    const survivable = (2 * Math.asin(Math.min(1, 2000 / narrow))) / Math.PI;
    expect(survivable).toBeGreaterThan(0.4);
  });

  it('never collapses to nothing', () => {
    const s = sim();
    s.gameState = { blocks: [{ x: 0, z: 0, y: 0, width: 1, depth: 1, height: 1500, rotation: 0 }] };
    expect(s.currentSweepBounds(0)).toBeGreaterThanOrEqual(RUN_TUNING.MIN_SWEEP_BOUNDS);
  });
});

describe('the close band gives the run a middle', () => {
  it('charges only part of the error for a near miss', () => {
    const s = sim();
    const top = { x: 0, z: 0, y: 0, width: 8000, depth: 8000, height: 1500, rotation: 0 };
    const band = s.perfectBandFor(8000);
    const err = band + 100; // just outside perfect, well inside close
    const close = s.calculateDrop({ ...top, x: err }, top, 'x');
    expect(close.newExtent).toBeGreaterThan(8000 - err); // cheaper than a full trim
    expect(close.newExtent).toBeLessThan(8000); // but not free
  });

  it('charges the whole error outside the close band', () => {
    const s = sim();
    const top = { x: 0, z: 0, y: 0, width: 8000, depth: 8000, height: 1500, rotation: 0 };
    const err = Math.floor((8000 * RUN_TUNING.CLOSE_BAND_RATIO) / 1000) + 500;
    expect(s.calculateDrop({ ...top, x: err }, top, 'x').newExtent).toBe(8000 - err);
  });
});

describe('the difficulty curve is a curve', () => {
  it('rewards precision monotonically', () => {
    const a = avg(2), b = avg(6), c = avg(16);
    expect(a.blocks).toBeGreaterThan(b.blocks);
    expect(b.blocks).toBeGreaterThan(c.blocks);
    expect(a.score).toBeGreaterThan(b.score);
    expect(b.score).toBeGreaterThan(c.score);
  });

  it('keeps scores on one scale so a leaderboard means something', () => {
    // Was 139x across this range, which made two players' numbers incomparable.
    const best = avg(2).score, worst = avg(16).score;
    expect(best / worst).toBeLessThan(60);
  });

  it('gives a careless player a run rather than an instant loss', () => {
    expect(avg(16).blocks).toBeGreaterThan(8);
  });

  it('ends a skilled run instead of running forever', () => {
    expect(avg(0, 6).blocks).toBeLessThan(400);
  });
});
