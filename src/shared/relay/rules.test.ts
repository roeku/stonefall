import { describe, expect, it } from 'vitest';
import { GameSimulation, RELAY_TUNING, RUN_TUNING } from '../simulation/gameSimulation';
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
  inSeatOrder,
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

/** The tick at which the moving block is nearest the centre, by walking the sweep. */
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

  it('gives a lone crew member the next turn after a timeout they survive', () => {
    const tower = towerOf(3);
    const crew = [player('a', 1)];
    settleTurn(tower, crew, 0);
    settleTurn(tower, crew, RELAY.TURN_MS, () => false);
    expect(tower.turn?.userId).toBe('a');
    expect(tower.turn?.startedAt).toBe(RELAY.TURN_MS);
  });
});

describe('a drop', () => {
  it('lands at the crossing, colours the block and counts the builder once', () => {
    const tower = towerOf(8);
    const a = player('a', 1, { faction: 'rose' });
    settleTurn(tower, [a], 0);
    const tick = crossingTick(tower.blocks);
    const out = applyDrop(tower, a, tick, 8, 100);
    expect(out.ok).toBe(true);
    expect(tower.blocks).toHaveLength(9);
    expect(tower.colors[8]).toBe('rose');
    expect(tower.builders).toBe(1);
    expect(tower.turn).toBeNull();

    settleTurn(tower, [a], 200);
    applyDrop(tower, a, crossingTick(tower.blocks), 9, 300);
    expect(tower.builders).toBe(1);
    expect(a.blocks).toBe(2);
  });

  it('puts a miss out for the day, heals the top, and says where the block went', () => {
    const tower = towerOf(8);
    // Narrow the top so a wide miss cannot land.
    const top = tower.blocks[7]!;
    tower.blocks[7] = { ...top, width: 1200, depth: 1200 };
    const a = player('a', 1);
    settleTurn(tower, [a], 0);
    const out = applyDrop(tower, a, worstTick(tower.blocks), 8, 100);
    expect(out.ok && out.result).toBe('fell');
    expect(a.out?.block).toBe(8);
    expect(tower.blocks).toHaveLength(8);
    expect(tower.blocks[7]!.width).toBe(DEFAULT_CONFIG.TOWER_WIDTH * 2);
    expect(tower.fallen).toBe(1);
    const fell = tower.events.find((e) => e.kind === 'fell');
    expect(fell?.missed).toBeDefined();
    expect(fell!.missed!.y).toBeGreaterThan(top.y + top.height);
    expect(tower.events[tower.events.length - 1]!.kind).toBe('healed');
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
