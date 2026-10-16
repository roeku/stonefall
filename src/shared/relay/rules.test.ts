import { describe, expect, it } from 'vitest';
import { GameSimulation, RELAY_TUNING, RUN_TUNING } from '../simulation/gameSimulation';
import { createTurnSimulation } from '../simulation/runSimulation';
import type { Block } from '../simulation/types';
import { DEFAULT_CONFIG } from '../simulation/types';
import type { RelayPlayer } from '../types/api';
import {
  RELAY,
  applyDrop,
  chooseTower,
  decodeColors,
  encodeColors,
  featuredTower,
  freshTower,
  grantLives,
  inSeatOrder,
  livesLeft,
  laidCount,
  livesToday,
  markLaid,
  moreLives,
  parseTaps,
  settleTurn,
  viewOf,
  type RelayTowerState,
} from './rules';

const player = (id: string, seatedAt: number, extra: Partial<RelayPlayer> = {}): RelayPlayer => ({
  userId: id,
  username: id,
  faction: 'jade',
  snoovatar: null,
  joinedAt: seatedAt,
  tower: 1,
  seatedAt,
  blocks: 0,
  perfects: 0,
  ...extra,
});

const standing = (n: number): Block[] => {
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

const towerOf = (n: number): RelayTowerState => {
  const t = freshTower(1, '2026-09-23', 0);
  t.blocks = standing(n);
  t.colors = t.blocks.map(() => null);
  return t;
};

/** Milliseconds into a turn by which `ticks` of sweep have run, and a little more. */
const clockFor = (ticks: number): number => Math.ceil((ticks * 1000) / 60) + 50;

/**
 * The tick at which the moving block first comes nearest the centre, by walking its first
 * sweep; `laid` is how many blocks the turn has laid before it.
 */
const crossingTick = (blocks: Block[], laid = 0): number => {
  const turn = createTurnSimulation(blocks, laid);
  const sim = turn.sim;
  let state = turn.state;
  const axis = blocks.length % 2 === 0 ? 'x' : 'z';
  let best = 1;
  let bestErr = Infinity;
  // One half sweep: from where the block comes in to the far side, past the centre once.
  const half = Math.ceil(100000 / sim.getSlideSpeedForBlockCount(blocks.length) / 2);
  for (let t = 1; t <= half; t++) {
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

/** A tick at which the block is as far off the tower as the sweep takes it. */
const worstTick = (blocks: Block[]): number => {
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
  let worst = 1;
  let worstErr = -1;
  for (let t = 1; t < 400; t++) {
    state = sim.stepSimulation(state);
    const cb = state.currentBlock!;
    const err = Math.abs(axis === 'x' ? cb.x : (cb.z ?? 0));
    if (err > worstErr) {
      worstErr = err;
      worst = state.tick + 1;
    }
  }
  return worst;
};

describe('turns', () => {
  it('rotates through the crew in seat order and wraps', () => {
    const tower = towerOf(3);
    const crew = inSeatOrder([player('c', 30), player('a', 10), player('b', 20)]);
    const seen: string[] = [];
    let now = 1000;
    for (let i = 0; i < 4; i++) {
      settleTurn(tower, crew, now);
      seen.push(tower.turn!.userId);
      now = tower.turn!.endsAt;
    }
    expect(seen).toEqual(['a', 'b', 'c', 'a']);
  });

  it('passes a turn on when its holder leaves', () => {
    const tower = towerOf(3);
    settleTurn(tower, [player('a', 1), player('b', 2)], 0);
    expect(tower.turn?.userId).toBe('a');
    settleTurn(tower, [player('b', 2)], 5);
    expect(tower.turn?.userId).toBe('b');
  });

  it('skips a holder who lets the clock run out once too often', () => {
    const tower = towerOf(3);
    const crew = [player('a', 1), player('b', 2)];
    settleTurn(tower, crew, 0);
    expect(tower.turn?.userId).toBe('a');
    const timedOut: string[] = [];
    settleTurn(tower, crew, RELAY.TURN_MS, (id) => {
      timedOut.push(id);
      return true;
    });
    expect(timedOut).toEqual(['a']);
    expect(tower.turn?.userId).toBe('b');
  });

  it('gives a lone crew member the next turn, a beat after the last one ended', () => {
    const tower = towerOf(3);
    const crew = [player('a', 1)];
    settleTurn(tower, crew, 0);
    settleTurn(tower, crew, RELAY.TURN_MS, () => false);
    expect(tower.turn?.userId).toBe('a');
    expect(tower.turn?.startedAt).toBe(RELAY.TURN_MS + RELAY.TURN_GRACE_MS);
  });

  it('starts the next turn when it is settled, if that is later than the beat', () => {
    const tower = towerOf(3);
    const crew = [player('a', 1), player('b', 2)];
    settleTurn(tower, crew, 0);
    const late = RELAY.TURN_MS + RELAY.TURN_GRACE_MS + 4000;
    settleTurn(tower, crew, late);
    expect(tower.turn?.userId).toBe('b');
    expect(tower.turn?.startedAt).toBe(late);
  });

  it('counts only a turn that laid nothing as let run out', () => {
    const tower = towerOf(8);
    const a = player('a', 1);
    const crew = [a, player('b', 2)];
    settleTurn(tower, crew, 0);
    const tick = crossingTick(tower.blocks);
    expect(applyDrop(tower, a, tick, 8, clockFor(tick))).toMatchObject({ ok: true });
    const idle: string[] = [];
    settleTurn(tower, crew, RELAY.TURN_MS, (id) => {
      idle.push(id);
      return true;
    });
    expect(idle).toEqual([]);
    expect(tower.turn?.userId).toBe('b');
  });
});

describe('a turn', () => {
  it('keeps going after a landing, one block taller, and hands the same player the next', () => {
    const tower = towerOf(8);
    const a = player('a', 1, { faction: 'rose' });
    settleTurn(tower, [a, player('b', 2)], 0);
    const first = crossingTick(tower.blocks);
    const out = applyDrop(tower, a, first, 8, clockFor(first));
    expect(out).toMatchObject({ ok: true, turnOver: false });
    expect(tower.turn).toMatchObject({ userId: 'a', index: 9, laid: 1, ticks: first });

    const second = crossingTick(tower.blocks, 1);
    applyDrop(tower, a, second, 9, clockFor(first + second));
    expect(tower.blocks).toHaveLength(10);
    expect(tower.turn).toMatchObject({ userId: 'a', index: 10, laid: 2 });
    expect(tower.builders).toBe(1);
    expect(a.blocks).toBe(2);
    // Both blocks are hers, as one run.
    expect(a.runs).toEqual({ '1': [[8, 10]] });
    expect(laidCount(a.runs?.['1'])).toBe(2);
  });

  it('ends on a landing made after its time, inside the slack for the round trip', () => {
    const tower = towerOf(8);
    const a = player('a', 1);
    settleTurn(tower, [a], 0);
    const tick = crossingTick(tower.blocks);
    const out = applyDrop(tower, a, tick, 8, RELAY.TURN_MS + 200);
    expect(out).toMatchObject({ ok: true, turnOver: true });
    expect(tower.turn).toBeNull();
  });

  it('ends on a miss', () => {
    const tower = towerOf(8);
    const top = tower.blocks[7]!;
    tower.blocks[7] = { ...top, width: 1200, depth: 1200 };
    const a = player('a', 1);
    settleTurn(tower, [a, player('b', 2)], 0);
    const tick = worstTick(tower.blocks);
    expect(applyDrop(tower, a, tick, 8, clockFor(tick))).toMatchObject({
      ok: true,
      result: 'fell',
      turnOver: true,
    });
    expect(tower.turn).toBeNull();
  });

  it('cannot hold more sweep than the clock has run', () => {
    const tower = towerOf(8);
    const a = player('a', 1);
    settleTurn(tower, [a], 0);
    // Blocks already laid this turn said they took five seconds of sweep, a second in.
    tower.turn!.ticks = 300;
    const tick = crossingTick(tower.blocks);
    expect(applyDrop(tower, a, tick, 8, 1000)).toMatchObject({ ok: false, stale: true });
    tower.turn!.ticks = 0;
    expect(applyDrop(tower, a, tick, 8, 1000)).toMatchObject({ ok: true });
  });

  it('says how many perfects in a row on each perfect', () => {
    const tower = towerOf(8);
    const a = player('a', 1);
    settleTurn(tower, [a], 0);
    let ticks = 0;
    for (let i = 0; i < 3; i++) {
      const tick = crossingTick(tower.blocks, i);
      ticks += tick;
      const out = applyDrop(tower, a, tick, 8 + i, clockFor(ticks));
      expect(out.ok && out.result).toBe('perfect');
    }
    expect(tower.events.filter((e) => e.kind === 'perfect').map((e) => e.streak)).toEqual([
      1, 2, 3,
    ]);
    expect(tower.turn?.streak).toBe(3);
  });
});

describe('whose blocks', () => {
  it('keeps a turn as one run and starts another when someone else built between', () => {
    const a = player('a', 1);
    markLaid(a, 1, 4);
    markLaid(a, 1, 5);
    markLaid(a, 1, 9);
    markLaid(a, 2, 0);
    expect(a.runs).toEqual({
      '1': [
        [4, 6],
        [9, 10],
      ],
      '2': [[0, 1]],
    });
    expect(laidCount(a.runs?.['1'])).toBe(3);
    expect(laidCount(undefined)).toBe(0);
  });

  it('reads a batch of taps, or the single tap older clients send', () => {
    expect(
      parseTaps({
        drops: [
          { tick: 3, index: 4 },
          { tick: '5', index: 5 },
        ],
      })
    ).toEqual([
      { tick: 3, index: 4 },
      { tick: 5, index: 5 },
    ]);
    expect(parseTaps({ tick: 7, index: 2 })).toEqual([{ tick: 7, index: 2 }]);
    expect(parseTaps({})).toEqual([]);
    expect(parseTaps(null)).toEqual([]);
  });
});

describe('a drop', () => {
  it('lands at the crossing, colours the block and counts the builder once', () => {
    const tower = towerOf(8);
    const a = player('a', 1, { faction: 'rose' });
    settleTurn(tower, [a], 0);
    const tick = crossingTick(tower.blocks);
    const out = applyDrop(tower, a, tick, 8, clockFor(tick));
    expect(out.ok).toBe(true);
    expect(tower.blocks).toHaveLength(9);
    expect(tower.colors[8]).toBe('rose');
    expect(tower.builders).toBe(1);

    // Another turn of hers, later: still one builder.
    settleTurn(tower, [a], RELAY.TURN_MS);
    const start = tower.turn!.startedAt;
    const next = crossingTick(tower.blocks);
    applyDrop(tower, a, next, 9, start + clockFor(next));
    expect(tower.builders).toBe(1);
    expect(a.blocks).toBe(2);
  });

  it('costs a miss one life, heals the top, and says where the block went', () => {
    const tower = towerOf(8);
    // Narrow the top so a wide miss cannot land.
    const top = tower.blocks[7]!;
    tower.blocks[7] = { ...top, width: 1200, depth: 1200 };
    const a = player('a', 1, { idle: 1 });
    settleTurn(tower, [a], 0);
    const out = applyDrop(tower, a, worstTick(tower.blocks), 8, 100);
    expect(out.ok && out.result).toBe('fell');
    expect(a.misses).toBe(1);
    expect(a.out).toBeUndefined();
    expect(livesLeft(a)).toBe(RELAY.LIVES - 1);
    // Playing, even badly, is not letting the turn run out.
    expect(a.idle).toBe(0);
    expect(tower.blocks).toHaveLength(8);
    expect(tower.blocks[7]!.width).toBe(DEFAULT_CONFIG.TOWER_WIDTH * 2);
    expect(tower.fallen).toBe(0);
    const fell = tower.events.find((e) => e.kind === 'fell');
    expect(fell?.left).toBe(RELAY.LIVES - 1);
    expect(fell?.missed).toBeDefined();
    expect(fell!.missed!.y).toBeGreaterThan(top.y + top.height);
    expect(tower.events[tower.events.length - 1]!.kind).toBe('healed');
  });

  it('keeps a player who still has lives in the rotation, and puts them out on the last', () => {
    const tower = towerOf(8);
    const a = player('a', 1);
    let now = 0;
    for (let miss = 1; miss <= RELAY.LIVES; miss++) {
      settleTurn(tower, a.out ? [] : [a], now);
      expect(tower.turn?.userId).toBe('a');
      const top = tower.blocks[tower.blocks.length - 1]!;
      tower.blocks[tower.blocks.length - 1] = { ...top, width: 1200, depth: 1200 };
      const out = applyDrop(tower, a, worstTick(tower.blocks), tower.blocks.length, now + 100);
      expect(out.ok && out.result).toBe('fell');
      expect(!!a.out).toBe(miss === RELAY.LIVES);
      now += 1000;
    }
    expect(a.out?.block).toBe(8);
    expect(livesLeft(a)).toBe(0);
    expect(tower.fallen).toBe(1);
    expect(tower.events.filter((e) => e.kind === 'fell').map((e) => e.left)).toEqual(
      Array.from({ length: RELAY.LIVES }, (_, i) => RELAY.LIVES - 1 - i)
    );
    expect(applyDrop(tower, a, 30, 8, now)).toMatchObject({ ok: false });
  });

  it('refuses a tap aimed at a tower that has moved on, or at somebody else’s turn', () => {
    const tower = towerOf(5);
    const a = player('a', 1);
    const b = player('b', 2);
    settleTurn(tower, [a, b], 0);
    expect(applyDrop(tower, b, 30, 5, 10)).toMatchObject({ ok: false, stale: true });
    expect(applyDrop(tower, a, 30, 4, 10)).toMatchObject({ ok: false, stale: true });
    expect(applyDrop(tower, a, 30, 5, RELAY.TURN_MS + RELAY.LATE_MS)).toMatchObject({
      ok: false,
      stale: true,
    });
  });
});

describe('a subscriber’s lives', () => {
  /** Miss on purpose: narrow the top so the widest swing goes over. */
  const miss = (tower: RelayTowerState, p: RelayPlayer, now: number) => {
    settleTurn(tower, [p], now);
    const top = tower.blocks[tower.blocks.length - 1]!;
    tower.blocks[tower.blocks.length - 1] = { ...top, width: 1200, depth: 1200 };
    return applyDrop(tower, p, worstTick(tower.blocks), tower.blocks.length, now + 100);
  };

  it('play to RELAY.LIVES plus MEMBER_LIVES, and say so on every fall', () => {
    const tower = towerOf(8);
    const a = player('a', 1, { extra: RELAY.MEMBER_LIVES });
    const total = RELAY.LIVES + RELAY.MEMBER_LIVES;
    expect(livesToday(a)).toBe(total);
    for (let n = 1; n <= total; n++) {
      miss(tower, a, n * 1000);
      expect(!!a.out).toBe(n === total);
    }
    const falls = tower.events.filter((e) => e.kind === 'fell');
    expect(falls.map((e) => e.lives)).toEqual(Array.from({ length: total }, () => total));
    expect(falls[falls.length - 1]!.left).toBe(0);
  });

  it('bring back somebody who was out, watching, without seating them', () => {
    const tower = towerOf(8);
    const a = player('a', 1);
    for (let n = 1; n <= RELAY.LIVES; n++) miss(tower, a, n * 1000);
    expect(a.out).toBeDefined();
    expect(grantLives(a, RELAY.MEMBER_LIVES)).toBe(true);
    expect(a.out).toBeUndefined();
    expect(a.tower).toBeNull();
    expect(livesLeft(a)).toBe(RELAY.MEMBER_LIVES);
    // Once a day is enough: asking again changes nothing, and never takes lives away.
    expect(grantLives(a, RELAY.MEMBER_LIVES)).toBe(false);
    expect(grantLives(a, 0)).toBe(false);
    expect(livesToday(a)).toBe(RELAY.LIVES + RELAY.MEMBER_LIVES);
  });

  it('say what subscribing adds in words that agree with the number', () => {
    expect(moreLives(1)).toBe('1 more life');
    expect(moreLives(2)).toBe('2 more lives');
    expect(moreLives()).toBe(moreLives(RELAY.MEMBER_LIVES));
  });

  it('only add lives to somebody still playing, and leave their seat alone', () => {
    const a = player('a', 1, { misses: 1 });
    expect(grantLives(a, RELAY.MEMBER_LIVES)).toBe(false);
    expect(a.tower).toBe(1);
    expect(livesLeft(a)).toBe(RELAY.LIVES + RELAY.MEMBER_LIVES - 1);
  });
});

describe('seating', () => {
  const towers = [
    { id: 1, crew: 6, height: 40 },
    { id: 2, crew: 3, height: 12 },
    { id: 3, crew: 0, height: 90 },
    { id: 4, crew: 0, height: 20 },
  ];

  it('joins the tower being watched when it has room', () => {
    expect(chooseTower(towers, 3)).toBe(3);
  });

  it('otherwise joins the busiest crew with room', () => {
    expect(chooseTower(towers, 1)).toBe(2);
    expect(chooseTower(towers, null)).toBe(2);
  });

  it('picks up the tallest abandoned tower before starting a fresh one', () => {
    expect(
      chooseTower(
        towers.filter((t) => t.id !== 2),
        null
      )
    ).toBe(3);
  });

  it('starts a new tower only when every crew is full', () => {
    expect(chooseTower([{ id: 1, crew: 6, height: 5 }], 1)).toBeNull();
    expect(chooseTower([{ id: 1, crew: 2, height: 5, closed: true }], 1)).toBeNull();
  });

  it('shows a newcomer the busiest tower', () => {
    expect(featuredTower(towers)).toBe(1);
    expect(featuredTower([])).toBe(1);
  });

  it('shows a day that has topped out by its tallest tower', () => {
    const ended = [
      { id: 1, crew: 0, height: 12, closed: true },
      { id: 2, crew: 0, height: 40, closed: true },
      { id: 3, crew: 0, height: 25, closed: true },
    ];
    expect(featuredTower(ended)).toBe(2);
  });
});

describe('the view', () => {
  it('lists the crew from whoever holds the turn', () => {
    const tower = towerOf(3);
    const crew = inSeatOrder([player('a', 1), player('b', 2), player('c', 3)]);
    settleTurn(tower, crew, 0);
    settleTurn(tower, crew, RELAY.TURN_MS);
    const view = viewOf({
      postId: 't3_x',
      day: '2026-09-23',
      tower,
      crew,
      me: null,
      towers: [],
      now: 0,
      closed: false,
    });
    expect(view.lobby.map((p) => p.userId)).toEqual(['b', 'c', 'a']);
    expect(view.crewMax).toBe(RELAY.CREW_MAX);
  });

  it('packs block colours one character each and back', () => {
    const colors = [null, 'ember', 'rose', null, 'cyan'] as const;
    const packed = encodeColors(colors);
    expect(packed).toBe('01805');
    expect(decodeColors(packed)).toEqual(colors);
  });
});
