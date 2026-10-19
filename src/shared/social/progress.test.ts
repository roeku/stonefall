import { describe, expect, it } from 'vitest';
import {
  XP,
  advanceOrder,
  allDone,
  capstoneFor,
  countEvent,
  dayProgressOf,
  freshDay,
  levelOf,
  ordersFor,
  raiseMult,
  raiseXp,
  xpAtLevel,
  xpBefore,
  xpToNext,
} from './progress';
import { FACTION_IDS } from '../types/factions';

describe('levels', () => {
  it('starts at level 1 with nothing', () => {
    expect(levelOf(0)).toEqual({ level: 1, into: 0, need: XP.LEVEL_FIRST });
  });

  it('needs a little more for each level', () => {
    expect(xpToNext(1)).toBe(100);
    expect(xpToNext(2)).toBe(150);
    expect(xpAtLevel(3)).toBe(250);
    expect(levelOf(249).level).toBe(2);
    expect(levelOf(250)).toEqual({ level: 3, into: 0, need: 200 });
  });

  it('agrees with itself at every level boundary', () => {
    for (let l = 1; l < 60; l++) {
      expect(levelOf(xpAtLevel(l)).level).toBe(l);
      expect(levelOf(xpAtLevel(l + 1) - 1).level).toBe(l);
      expect(xpAtLevel(l + 1) - xpAtLevel(l)).toBe(xpToNext(l));
    }
  });
});

describe('raise XP', () => {
  const run = { blocks: 40, perfects: 20 };

  it('pays a safe raise its blocks and perfects', () => {
    expect(raiseXp({ kind: 'keep', ...run })).toEqual({ why: 'keep', base: 60, mult: 1, xp: 60 });
  });

  it('pays ground more than safety, and a fight most', () => {
    const claim = raiseXp({ kind: 'claim', ...run }).xp;
    const take = raiseXp({ kind: 'take', ...run }).xp;
    const back = raiseXp({ kind: 'take', back: true, ...run }).xp;
    expect(claim).toBeGreaterThan(60);
    expect(take).toBeGreaterThan(claim);
    expect(back).toBeGreaterThan(take);
  });

  it('pays a replace of your own tower like a keep', () => {
    expect(raiseXp({ kind: 'take', own: true, ...run }).why).toBe('replace');
    expect(raiseMult({ kind: 'take', own: true })).toBe(1);
  });

  it('adds for every tower a take brings down, up to a cap', () => {
    expect(raiseMult({ kind: 'take', fell: 3 })).toBe(XP.MULT.take + 2 * XP.PER_TOPPLED);
    expect(raiseMult({ kind: 'take', back: true, fell: 8 })).toBe(XP.MULT_MAX);
  });
});

describe('orders', () => {
  it('gives every colour three a day, the same for all its players', () => {
    for (const f of FACTION_IDS) {
      const a = ordersFor('2026-10-19', f);
      expect(a).toHaveLength(3);
      expect(ordersFor('2026-10-19', f)).toEqual(a);
    }
  });

  it('draws a fight first and ground second', () => {
    for (const f of FACTION_IDS) {
      const [fight, ground] = ordersFor('2026-10-20', f);
      expect(['take', 'take-up', 'topple']).toContain(fight!.kind);
      expect(ground!.kind).toBe('claim');
    }
  });

  it('counts a take as ground won, but not a replace', () => {
    const claim = { kind: 'claim' as const, n: 2, xp: 60 };
    const take = {
      type: 'raise' as const,
      kind: 'take' as const,
      ahead: false,
      fell: 1,
      perfects: 0,
    };
    expect(advanceOrder(claim, 0, { ...take, own: false })).toBe(1);
    expect(advanceOrder(claim, 0, { ...take, own: true })).toBe(0);
  });

  it('counts a topple only when two or more came down', () => {
    const topple = { kind: 'topple' as const, n: 1, xp: 60 };
    const take = {
      type: 'raise' as const,
      kind: 'take' as const,
      own: false,
      ahead: false,
      perfects: 0,
    };
    expect(advanceOrder(topple, 0, { ...take, fell: 1 })).toBe(0);
    expect(advanceOrder(topple, 0, { ...take, fell: 2 })).toBe(1);
  });

  it('counts relay blocks up to the order and no further', () => {
    const relay = { kind: 'relay' as const, n: 5, xp: 60 };
    expect(advanceOrder(relay, 3, { type: 'relay', blocks: 4 })).toBe(5);
  });

  it('says which orders an event finished, and when all are done', () => {
    const p = freshDay('2026-10-19', 'cobalt');
    const orders = ordersFor(p.day, p.faction);
    p.counts = orders.map((o) => o.n);
    p.counts[1] = orders[1]!.n - 1;
    expect(allDone(p)).toBe(false);
    const done = countEvent(p, {
      type: 'raise',
      kind: 'claim',
      own: false,
      ahead: false,
      fell: 0,
      perfects: 0,
    });
    expect(done).toEqual([1]);
    expect(allDone(p)).toBe(true);
  });

  it('starts over on a new day or a new colour', () => {
    const raw = JSON.stringify({ ...freshDay('2026-10-18', 'rose'), counts: [1, 2, 3] });
    expect(dayProgressOf(raw, '2026-10-19', 'rose').counts).toEqual([0, 0, 0]);
    expect(dayProgressOf(raw, '2026-10-18', 'gold').counts).toEqual([0, 0, 0]);
    expect(dayProgressOf(raw, '2026-10-18', 'rose').counts).toEqual([1, 2, 3]);
  });
});

describe('the capstone', () => {
  it('grows with the streak and the ground held yesterday', () => {
    const plain = capstoneFor('u1', '2026-10-19', { streak: 1, held: 0, won: false });
    const loyal = capstoneFor('u1', '2026-10-19', { streak: 5, held: 4, won: true });
    expect(loyal.xp / (loyal.golden ? 3 : 1)).toBeGreaterThan(plain.xp / (plain.golden ? 3 : 1));
  });

  it('is gold every seventh day in a row', () => {
    expect(capstoneFor('u1', '2026-10-19', { streak: 7, held: 0, won: false }).golden).toBe(true);
    expect(capstoneFor('u1', '2026-10-19', { streak: 14, held: 0, won: false }).golden).toBe(true);
  });

  it('is gold now and then otherwise, about one day in eight, and never rerolled', () => {
    let gold = 0;
    for (let i = 0; i < 4000; i++) {
      const c = capstoneFor(`user${i}`, '2026-10-19', { streak: 1, held: 0, won: false });
      if (c.golden) gold++;
      expect(capstoneFor(`user${i}`, '2026-10-19', { streak: 1, held: 0, won: false })).toEqual(c);
    }
    expect(gold / 4000).toBeGreaterThan(0.08);
    expect(gold / 4000).toBeLessThan(0.17);
  });

  it('pays three times as much when gold', () => {
    const c = capstoneFor('u1', '2026-10-19', { streak: 7, held: 0, won: false });
    expect(c.xp).toBe((XP.CAPSTONE.BASE + 7 * XP.CAPSTONE.PER_STREAK_DAY) * XP.CAPSTONE.GOLD);
  });
});

describe('news', () => {
  it('knows where the ring started filling from', () => {
    expect(
      xpBefore({
        xp: 500,
        gains: [
          { kind: 'raise', xp: 120, base: 60, mult: 2, why: 'take' },
          { kind: 'order', xp: 60, order: 0 },
        ],
      })
    ).toBe(320);
  });
});
