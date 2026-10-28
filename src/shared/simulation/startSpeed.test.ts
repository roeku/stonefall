import { describe, expect, it } from 'vitest';
import { RUN_PACE, RUN_TUNING, startSpeedOr, type StartSpeed } from './gameSimulation';
import { createRunSimulation, replayRun } from './runSimulation';
import type { DropInput, GameState } from './types';

/**
 * The start speed (StartSpeed): a solo run opened at ×2 or ×4 holds that speed until the ramp
 * catches it up, and from there is anyone's run. The server replays at the speed the player
 * says, so these check that a replay at that speed is the run, and the same taps at another
 * speed are not.
 */

type Peek = {
  currentBlockSpawnTick: number;
  calculateSlidePosition(rel: number, count?: number, phase?: number): number;
};

const axisOf = (n: number): 'x' | 'z' => (n % 2 === 0 ? 'x' : 'z');

/** A player who reads every block: taps on the tick it passes nearest the middle of the top. */
const play = (seed: number, start: StartSpeed, maxBlocks: number) => {
  const sim = createRunSimulation(seed, 'rotating_block', RUN_PACE, start);
  const peek = sim as unknown as Peek;
  let st: GameState = sim.createInitialState();
  const inputs: DropInput[] = [];
  let guard = 0;
  while (!st.isGameOver && st.blocks.length < maxBlocks && guard++ < 400_000) {
    const cb = st.currentBlock;
    const n = st.blocks.length;
    let tap = false;
    if (cb && st.tick > 0) {
      const top = st.blocks[n - 1]!;
      const axis = axisOf(n);
      const centre = axis === 'x' ? top.x : (top.z ?? 0);
      const extent = axis === 'x' ? top.width : (top.depth ?? top.width);
      const now = Math.abs((axis === 'x' ? cb.x : (cb.z ?? 0)) - centre);
      const rel = st.tick - peek.currentBlockSpawnTick;
      const next = Math.abs(
        peek.calculateSlidePosition(rel + 1, n, cb.slidePhaseOffset ?? 0) - centre
      );
      tap = now <= next && now <= Math.max(90, extent / 10) * 0.95;
    }
    if (tap) {
      const tick = st.tick + 1;
      inputs.push({ tick });
      st = sim.stepSimulation(st, { tick });
    } else {
      st = sim.stepSimulation(st);
    }
  }
  return { state: st, inputs };
};

const speedAt = (
  start: StartSpeed,
  block: number,
  mode: 'rotating_block' | 'relay' = 'rotating_block'
) => createRunSimulation(1, mode, RUN_PACE, start).getSlideSpeedForBlockCount(block);

describe('the start speed', () => {
  it('opens the run at a multiple of the base speed', () => {
    expect(speedAt(1, 0)).toBe(RUN_TUNING.BASE_SPEED);
    expect(speedAt(2, 0)).toBe(RUN_TUNING.BASE_SPEED * 2);
    expect(speedAt(4, 0)).toBe(RUN_TUNING.BASE_SPEED * 4);
  });

  it('holds until the ramp catches it up, then is the ramp', () => {
    expect(speedAt(2, 41)).toBe(920);
    expect(speedAt(2, 42)).toBe(speedAt(1, 42));
    expect(speedAt(4, 125)).toBe(1840);
    expect(speedAt(4, 126)).toBe(speedAt(1, 126));
    // The cap and the sway past it are everyone's.
    for (const block of [195, 220, 300, 600]) {
      expect(speedAt(4, block)).toBe(speedAt(1, block));
    }
  });

  it('leaves the relay alone: its sweep is the whole crew’s', () => {
    for (const block of [0, 50, 400]) {
      expect(speedAt(4, block, 'relay')).toBe(speedAt(1, block, 'relay'));
    }
  });

  it('replays a run at the speed it was played at, and only that one', () => {
    const run = play(31, 4, 80);
    expect(run.state.blocks.length).toBe(80);
    const replayed = replayRun(31, 'rotating_block', run.inputs, RUN_PACE, 4);
    expect(replayed!.score).toBe(run.state.score);
    expect(replayed!.blocks).toHaveLength(run.state.blocks.length);
    // The same taps at ×1 drop blocks where the sweep was not: another run, and a short one.
    const slow = replayRun(31, 'rotating_block', run.inputs, RUN_PACE, 1);
    expect(slow!.score).toBeLessThan(run.state.score);
  });

  it('takes nothing but ×1, ×2 and ×4 from a request', () => {
    expect(startSpeedOr(2)).toBe(2);
    expect(startSpeedOr('4')).toBe(4);
    expect(startSpeedOr(3)).toBe(1);
    expect(startSpeedOr(8)).toBe(1);
    expect(startSpeedOr(undefined)).toBe(1);
    expect(startSpeedOr('fast')).toBe(1);
  });
});
