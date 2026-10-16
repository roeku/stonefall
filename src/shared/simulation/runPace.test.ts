import { describe, expect, it } from 'vitest';
import {
  LEGACY_RUN_PACE,
  RUN_PACE,
  SOLO_CAP_BLOCK,
  paceOr,
  paceToReplay,
  type RunPace,
} from './gameSimulation';
import { createRunSimulation, replayRun } from './runSimulation';
import type { DropInput, GameState } from './types';
import { DEFAULT_CONFIG } from './types';

/**
 * A run's pace (RunPace): what happens past the solo run's speed cap.
 *
 * At the legacy pace every block past the cap came in at the same moment after the last landing,
 * at the same speed, over a full top that could not be missed, whatever the seed: a beat, and a
 * player who had it stacked until the replay's time limit. These hold the legacy pace to exactly
 * what shipped, so every run on a map opened before the change replays as it was played, and
 * check that the new pace breaks the beat without becoming a guess.
 */

type Peek = {
  currentBlockSpawnTick: number;
  calculateSlidePosition(rel: number, count?: number, phase?: number): number;
};

interface Played {
  state: GameState;
  inputs: DropInput[];
  /** Tick of each landing, by block index. */
  landedAt: number[];
}

const axisOf = (n: number): 'x' | 'z' => (n % 2 === 0 ? 'x' : 'z');

/**
 * Play a run. Up to `readUntil` blocks the player reads the block: taps on the tick it passes
 * nearest the middle of the top. After that, if `rhythm` is set, they tap on the beat instead:
 * the same number of ticks after each landing as the last read block took.
 */
const play = (
  seed: number,
  pace: RunPace,
  opts: { maxBlocks: number; readUntil?: number; rhythm?: boolean }
): Played => {
  const sim = createRunSimulation(seed, 'rotating_block', pace);
  const peek = sim as unknown as Peek;
  let st: GameState = sim.createInitialState();
  const inputs: DropInput[] = [];
  const landedAt: number[] = [0];
  let beat = 0;
  let guard = 0;
  while (!st.isGameOver && st.blocks.length < opts.maxBlocks && guard++ < 400_000) {
    const cb = st.currentBlock;
    const n = st.blocks.length;
    let tap = false;
    if (cb && st.tick > 0) {
      const reading = opts.readUntil === undefined || n < opts.readUntil || !opts.rhythm;
      if (reading) {
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
      } else {
        tap = st.tick + 1 - landedAt[n - 1]! >= beat;
      }
    }
    if (tap) {
      const tick = st.tick + 1;
      inputs.push({ tick });
      st = sim.stepSimulation(st, { tick });
      if (!st.isGameOver) {
        landedAt[n] = tick;
        if (opts.readUntil === undefined || n < opts.readUntil) beat = tick - landedAt[n - 1]!;
      }
    } else {
      st = sim.stepSimulation(st);
    }
  }
  return { state: st, inputs, landedAt };
};

/** The tower's geometry as one number, to compare runs exactly. */
const fingerprint = (st: GameState): number => {
  let h = 0;
  for (const b of st.blocks) {
    h = (Math.imul(h, 31) + b.x * 7 + (b.z ?? 0) * 13 + b.width * 3 + (b.depth ?? 0)) | 0;
  }
  return h;
};

describe('the legacy pace', () => {
  it('plays exactly as the shipped simulation did', () => {
    // Measured on the simulation as it shipped (git HEAD before paces), with this same player.
    const run = play(7, LEGACY_RUN_PACE, { maxBlocks: 400 });
    expect(run.state.blocks).toHaveLength(400);
    expect(run.state.score).toBe(98288);
    expect(run.state.tick).toBe(6309);
    expect(fingerprint(run.state)).toBe(-69926912);
  });

  it('is what a run replays at unless told otherwise', () => {
    const run = play(31, LEGACY_RUN_PACE, { maxBlocks: 260 });
    const replayed = replayRun(31, 'rotating_block', run.inputs);
    expect(fingerprint(replayed!)).toBe(fingerprint(run.state));
    expect(replayed!.score).toBe(run.state.score);
  });

  it('is the same run whatever the seed, which is what made it a beat', () => {
    const a = play(7, LEGACY_RUN_PACE, { maxBlocks: 300 });
    const b = play(99991, LEGACY_RUN_PACE, { maxBlocks: 300 });
    expect(fingerprint(a.state)).toBe(fingerprint(b.state));
  });

  it('lets a player on the beat stack on past the cap without looking', () => {
    const run = play(7, LEGACY_RUN_PACE, {
      maxBlocks: SOLO_CAP_BLOCK + 150,
      readUntil: SOLO_CAP_BLOCK + 5,
      rhythm: true,
    });
    expect(run.state.isGameOver).toBe(false);
    expect(run.state.blocks).toHaveLength(SOLO_CAP_BLOCK + 150);
  });
});

describe('the swaying pace', () => {
  it('replays a run exactly, at its own pace', () => {
    const run = play(31, RUN_PACE, { maxBlocks: 320 });
    const replayed = replayRun(31, 'rotating_block', run.inputs, RUN_PACE);
    expect(fingerprint(replayed!)).toBe(fingerprint(run.state));
    // The same taps at the legacy pace are another run altogether.
    const legacy = replayRun(31, 'rotating_block', run.inputs, LEGACY_RUN_PACE);
    expect(fingerprint(legacy!)).not.toBe(fingerprint(run.state));
  });

  it('is the legacy run up to the cap', () => {
    const before = SOLO_CAP_BLOCK - 1;
    const legacy = play(7, LEGACY_RUN_PACE, { maxBlocks: before });
    const swaying = play(7, RUN_PACE, { maxBlocks: before });
    expect(fingerprint(swaying.state)).toBe(fingerprint(legacy.state));
    expect(swaying.state.tick).toBe(legacy.state.tick);
  });

  it('breaks the beat: a player who stops looking past the cap falls', () => {
    for (const seed of [7, 31, 4242]) {
      const run = play(seed, RUN_PACE, {
        maxBlocks: SOLO_CAP_BLOCK + 150,
        readUntil: SOLO_CAP_BLOCK + 5,
        rhythm: true,
      });
      expect(run.state.isGameOver).toBe(true);
      expect(run.state.blocks.length).toBeLessThan(SOLO_CAP_BLOCK + 120);
    }
  });

  it('can still be read: a player who watches every block keeps going', () => {
    for (const seed of [7, 31, 4242]) {
      const run = play(seed, RUN_PACE, { maxBlocks: 450 });
      expect(run.state.isGameOver).toBe(false);
      expect(run.state.blocks).toHaveLength(450);
    }
  });

  it('differs from seed to seed past the cap, and not before', () => {
    // A player who lands every block dead centre builds the same tower either way; what
    // differs is when each block had to be tapped.
    const a = play(7, RUN_PACE, { maxBlocks: 330 });
    const b = play(99991, RUN_PACE, { maxBlocks: 330 });
    const gaps = (r: Played, from: number, to: number) =>
      r.landedAt.slice(from, to).map((t, i) => t - (r.landedAt[from + i - 1] ?? 0));
    expect(gaps(a, 150, 180)).toEqual(gaps(b, 150, 180));
    expect(gaps(a, 280, 320)).not.toEqual(gaps(b, 280, 320));
  });

  it('reaches past the edges of a full top, so the end of the sweep misses', () => {
    const reach = (pace: RunPace, at: number) => {
      const sim = createRunSimulation(5, 'rotating_block', pace);
      const peek = sim as unknown as Peek;
      // The sweep over a full top (the opening block), as a tower kept whole by perfects has.
      sim.createInitialState();
      const full = DEFAULT_CONFIG.TOWER_WIDTH * 2;
      let far = 0;
      for (let rel = 1; rel < 120; rel++) {
        far = Math.max(far, Math.abs(peek.calculateSlidePosition(rel, at, 0)));
      }
      return far / full;
    };
    expect(reach(LEGACY_RUN_PACE, 300)).toBeLessThanOrEqual(1);
    expect(reach(RUN_PACE, SOLO_CAP_BLOCK - 1)).toBeLessThanOrEqual(1);
    expect(reach(RUN_PACE, SOLO_CAP_BLOCK + 80)).toBeGreaterThan(1.1);
  });
});

describe('the pace a saved run is replayed at', () => {
  it("is the one it was played at, when that is the live day's or the day before's", () => {
    // The day the tower first sways: a run begun the evening before is still yesterday's.
    expect(paceToReplay(1, 2, 1)).toBe(1);
    expect(paceToReplay(2, 2, 1)).toBe(2);
  });

  it("is the live day's otherwise, and for a client that sends none", () => {
    // A day later nobody can ask for the old one.
    expect(paceToReplay(1, 2, 2)).toBe(2);
    expect(paceToReplay(undefined, 2, 1)).toBe(2);
    expect(paceToReplay('banana', 2, 2)).toBe(2);
    expect(paceToReplay(undefined, 1, 1)).toBe(1);
  });
});

describe('a stored pace', () => {
  it('reads as the legacy pace unless it says otherwise', () => {
    expect(paceOr(undefined)).toBe(LEGACY_RUN_PACE);
    expect(paceOr('')).toBe(LEGACY_RUN_PACE);
    expect(paceOr('1')).toBe(1);
    expect(paceOr('2')).toBe(2);
    expect(paceOr(2)).toBe(2);
    expect(paceOr('7')).toBe(LEGACY_RUN_PACE);
  });
});
