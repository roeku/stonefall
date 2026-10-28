import { describe, expect, it } from 'vitest';
import {
  KEEP_RADIUS,
  LEGACY_KEEP_RADIUS,
  LEGACY_RULES,
  REACH,
  RULES,
  cellKind,
  keepRadiusOr,
  cellsHeldBy,
  holdOfStack,
  judgePlacement,
  keepCellsOf,
  landCountByFaction,
  landHoldsFrom,
  rulesOr,
  withinReach,
  type Holdings,
  type KeepRecord,
  type LandHold,
} from './territory';
import { REGION_PITCH, REGION_RADIUS, regionCenterCell } from './worldGrid';

/**
 * The land rules, as the player experiences them: where the keep is, what is in reach on day
 * one, when the neighbour's edge opens up, and what a take needs.
 */

const keep = (
  userId: string,
  faction: KeepRecord['faction'],
  rx: number,
  rz: number
): KeepRecord => {
  const c = regionCenterCell({ rx, rz });
  return { userId, username: userId, faction, rx, rz, centerX: c.x, centerZ: c.z };
};

const hold = (
  x: number,
  z: number,
  userId: string,
  faction: LandHold['faction'],
  score: number
): LandHold => ({
  x,
  z,
  userId,
  username: userId,
  faction,
  score,
  sessionId: `run-${userId}-${x}-${z}`,
  placedAt: 1,
});

const K = KEEP_RADIUS;
const LEGACY = LEGACY_KEEP_RADIUS;

describe('cell kinds', () => {
  const kept = [{ rx: 0, rz: 0 }];

  it('makes a handed-out centre keep and every other cell land, the old road included', () => {
    expect(cellKind(0, 0, kept, K)).toBe('keep');
    expect(cellKind(1, -1, kept, K)).toBe('land');
    expect(cellKind(2, 0, kept, K)).toBe('land');
    expect(cellKind(REGION_RADIUS, REGION_RADIUS, kept, K)).toBe('land');
    // Where the road ran, between this region and the next.
    expect(cellKind(REGION_RADIUS + 1, 0, kept, K)).toBe('land');
    expect(cellKind(0, REGION_RADIUS + 1, kept, K)).toBe('land');
    // The next region over is nobody's, so its centre is land like the rest of it...
    expect(cellKind(REGION_PITCH, 0, kept, K)).toBe('land');
    // ...until somebody is handed it.
    const both = [...kept, { rx: 1, rz: 0 }];
    expect(cellKind(REGION_PITCH, 0, both, K)).toBe('keep');
    expect(cellKind(REGION_PITCH + 1, 0, both, K)).toBe('land');
    expect(cellKind(REGION_PITCH - REGION_RADIUS, 0, both, K)).toBe('land');
  });

  it('keeps the 3x3 on a map opened before the keep shrank', () => {
    expect(cellKind(1, -1, kept, LEGACY)).toBe('keep');
    expect(cellKind(2, 0, kept, LEGACY)).toBe('land');
    expect(cellKind(REGION_PITCH + 1, 0, kept, LEGACY)).toBe('land');
    expect(keepCellsOf({ rx: 0, rz: 0 }, LEGACY)).toHaveLength(9);
  });

  it('gives a keep one cell', () => {
    expect(keepCellsOf({ rx: 1, rz: 0 }, K)).toEqual([{ x: REGION_PITCH, z: 0 }]);
  });

  it('reads a stored keep size, and a map that stored none as the legacy one', () => {
    expect(keepRadiusOr('0')).toBe(0);
    expect(keepRadiusOr(0)).toBe(0);
    expect(keepRadiusOr('1')).toBe(1);
    expect(keepRadiusOr(undefined)).toBe(LEGACY);
    expect(keepRadiusOr(null)).toBe(LEGACY);
    expect(keepRadiusOr('')).toBe(LEGACY);
    expect(keepRadiusOr('x')).toBe(LEGACY);
    expect(keepRadiusOr(-1)).toBe(LEGACY);
    // A keep as wide as the region would leave no land at all.
    expect(keepRadiusOr(REGION_RADIUS)).toBe(LEGACY);
  });
});

describe('reach', () => {
  const mine = { rx: 0, rz: 0 };
  const empty: Holdings = { keeps: [], land: [] };

  it('covers the 5x5 round your keep on day one, and not the edge of your plot', () => {
    const held = cellsHeldBy('cyan', mine, empty, K);
    for (let x = -REGION_RADIUS; x <= REGION_RADIUS; x++) {
      for (let z = -REGION_RADIUS; z <= REGION_RADIUS; z++) {
        const edge = Math.max(Math.abs(x), Math.abs(z)) > REACH;
        expect(withinReach(x, z, held)).toBe(!edge);
      }
    }
  });

  it('opens the edge of your plot once you hold land nearer it', () => {
    const holdings: Holdings = { keeps: [], land: [hold(REACH, 0, 'me', 'cyan', 100)] };
    const held = cellsHeldBy('cyan', mine, holdings, K);
    expect(withinReach(REGION_RADIUS, 0, held)).toBe(true);
    expect(withinReach(REGION_RADIUS, REACH, held)).toBe(true);
    // Only near what is held: the far corner stays shut.
    expect(withinReach(-REGION_RADIUS, -REGION_RADIUS, held)).toBe(false);
  });

  it('covered the 7x7 round a 3x3 keep on day one', () => {
    const held = cellsHeldBy('cyan', mine, empty, LEGACY);
    for (let x = -REGION_RADIUS; x <= REGION_RADIUS; x++) {
      for (let z = -REGION_RADIUS; z <= REGION_RADIUS; z++) {
        expect(withinReach(x, z, held)).toBe(true);
      }
    }
    // The column where the road ran is one too far.
    expect(withinReach(REGION_RADIUS + 1, 0, held)).toBe(false);
  });

  it("opens the neighbour's edge once you hold your own", () => {
    const holdings: Holdings = { keeps: [], land: [hold(REGION_RADIUS, 0, 'me', 'cyan', 100)] };
    const held = cellsHeldBy('cyan', mine, holdings, K);
    expect(withinReach(REGION_PITCH - REGION_RADIUS, 0, held)).toBe(true);
    expect(REGION_PITCH - REGION_RADIUS - REGION_RADIUS).toBe(REACH);
  });

  it("is by colour: a faction mate's keep extends your reach, a rival's does not", () => {
    const holdings: Holdings = {
      keeps: [keep('mate', 'cyan', 1, 0), keep('rival', 'rose', 0, 1)],
      land: [],
    };
    const held = cellsHeldBy('cyan', mine, holdings, K);
    const mateKeep = regionCenterCell({ rx: 1, rz: 0 });
    const rivalKeep = regionCenterCell({ rx: 0, rz: 1 });
    expect(withinReach(mateKeep.x - REACH, mateKeep.z, held)).toBe(true);
    expect(withinReach(rivalKeep.x, rivalKeep.z - REACH, held)).toBe(false);
  });
});

describe('judging a placement on a plots map', () => {
  const base = {
    score: 500,
    userId: 'me',
    faction: 'cyan' as const,
    region: { rx: 0, rz: 0 },
    keepStacks: new Map<string, number>(),
    maxStack: 8,
    standing: 0,
    maxStanding: 50,
    keepRadius: K,
    rules: LEGACY_RULES,
  };
  const far = regionCenterCell({ rx: 2, rz: 0 });

  it('stacks on your own keep and nowhere else', () => {
    expect(judgePlacement({ ...base, x: 0, z: 0, holdings: { keeps: [], land: [] } })).toEqual({
      ok: true,
      kind: 'keep',
      stackOn: 0,
    });
    const theirs = judgePlacement({
      ...base,
      x: REGION_PITCH,
      z: 0,
      holdings: { keeps: [keep('them', 'rose', 1, 0)], land: [] },
    });
    expect(theirs).toMatchObject({
      ok: false,
      code: 'foreign-keep',
      reason: "That is u/them's keep.",
    });
  });

  it('builds on the old road and the centre of a region nobody keeps, as land', () => {
    // Held land next to both, so reach is not the question.
    const holdings: Holdings = {
      keeps: [],
      land: [hold(REGION_RADIUS, 0, 'me', 'cyan', 1), hold(far.x - 2, far.z, 'me', 'cyan', 1)],
    };
    expect(judgePlacement({ ...base, x: REGION_RADIUS + 1, z: 0, holdings })).toEqual({
      ok: true,
      kind: 'claim',
    });
    expect(judgePlacement({ ...base, x: far.x, z: far.z, holdings })).toEqual({
      ok: true,
      kind: 'claim',
    });
  });

  it('refuses full stacks and a full plot', () => {
    const full = judgePlacement({
      ...base,
      x: 0,
      z: 0,
      keepStacks: new Map([['0,0', 8]]),
      holdings: { keeps: [], land: [] },
    });
    expect(full.ok).toBe(false);
    if (!full.ok) expect(full.code).toBe('stack-full');
    const capped = judgePlacement({
      ...base,
      x: 0,
      z: 0,
      standing: 50,
      holdings: { keeps: [], land: [] },
    });
    expect(capped.ok).toBe(false);
    if (!capped.ok) expect(capped.code).toBe('cap');
  });

  it('claims empty land in reach and refuses land beyond it', () => {
    expect(judgePlacement({ ...base, x: 2, z: 2, holdings: { keeps: [], land: [] } })).toEqual({
      ok: true,
      kind: 'claim',
    });
    const beyond = judgePlacement({
      ...base,
      x: far.x - 3,
      z: far.z,
      holdings: { keeps: [], land: [] },
    });
    expect(beyond.ok).toBe(false);
    if (!beyond.ok) expect(beyond.code).toBe('out-of-reach');
  });

  it('claims the old keep ring as land, and stacks there only on a map that kept the 3x3', () => {
    const empty = { keeps: [], land: [] };
    expect(judgePlacement({ ...base, x: 1, z: -1, holdings: empty })).toEqual({
      ok: true,
      kind: 'claim',
    });
    expect(judgePlacement({ ...base, x: 1, z: -1, holdings: empty, keepRadius: LEGACY })).toEqual({
      ok: true,
      kind: 'keep',
      stackOn: 0,
    });
  });

  it('takes held land only by beating the bar, whoever holds it', () => {
    const holdings: Holdings = { keeps: [], land: [hold(2, 2, 'them', 'rose', 500)] };
    const short = judgePlacement({ ...base, x: 2, z: 2, holdings });
    expect(short.ok).toBe(false);
    if (!short.ok) {
      expect(short.code).toBe('bar');
      expect(short.bar).toBe(500);
    }
    const take = judgePlacement({ ...base, x: 2, z: 2, score: 501, holdings });
    expect(take.ok).toBe(true);
    if (take.ok) expect(take.kind).toBe('take');
    // A faction mate's tower is no easier: nobody can weaken a cell from inside.
    const mateHold: Holdings = { keeps: [], land: [hold(2, 2, 'mate', 'cyan', 900)] };
    const weak = judgePlacement({ ...base, x: 2, z: 2, score: 600, holdings: mateHold });
    expect(weak.ok).toBe(false);
  });
});

describe('judging a placement on a factions map', () => {
  // A colour's keep is region 0,0, founded by somebody else; "me" builds from it.
  const base = {
    score: 500,
    userId: 'me',
    faction: 'cyan' as const,
    region: { rx: 0, rz: 0 },
    keepStacks: new Map<string, number>(),
    maxStack: 8,
    standing: 0,
    maxStanding: 50,
    keepRadius: K,
    rules: RULES,
  };
  const founded = (faction: KeepRecord['faction'], rx: number, rz: number) =>
    keep(`founder-${faction}`, faction, rx, rz);

  it('opens new maps on the factions rules, and reads a map that stored none as plots', () => {
    expect(RULES).toBe('factions');
    expect(rulesOr('factions')).toBe('factions');
    expect(rulesOr('plots')).toBe('plots');
    expect(rulesOr(undefined)).toBe(LEGACY_RULES);
    expect(rulesOr('')).toBe(LEGACY_RULES);
    expect(LEGACY_RULES).toBe('plots');
  });

  it("stacks on the colour's keep, whoever founded it, counting everybody's towers there", () => {
    const holdings: Holdings = { keeps: [founded('cyan', 0, 0)], land: [] };
    expect(
      judgePlacement({ ...base, keepStacks: new Map([['0,0', 3]]), holdings, x: 0, z: 0 })
    ).toEqual({ ok: true, kind: 'keep', stackOn: 3 });
    // Before the player has been handed the colour's region, its keep is still theirs.
    expect(judgePlacement({ ...base, region: null, holdings, x: 0, z: 0 })).toEqual({
      ok: true,
      kind: 'keep',
      stackOn: 0,
    });
    const full = judgePlacement({
      ...base,
      keepStacks: new Map([['0,0', 8]]),
      holdings,
      x: 0,
      z: 0,
    });
    expect(full.ok).toBe(false);
    if (!full.ok) expect(full.code).toBe('stack-full');
  });

  it("refuses another colour's keep by its colour, and claims a centre no colour founded", () => {
    const holdings: Holdings = { keeps: [founded('rose', 1, 0)], land: [] };
    const theirs = judgePlacement({ ...base, holdings, x: REGION_PITCH, z: 0 });
    expect(theirs).toMatchObject({
      ok: false,
      code: 'foreign-keep',
      reason: "That is Rose's keep.",
    });
    const below = regionCenterCell({ rx: 0, rz: 1 });
    const reached: Holdings = {
      ...holdings,
      land: [hold(below.x, below.z - 2, 'me', 'cyan', 1)],
    };
    expect(judgePlacement({ ...base, holdings: reached, x: below.x, z: below.z })).toEqual({
      ok: true,
      kind: 'claim',
    });
  });

  it("stacks on an ally's land at any score instead of toppling it", () => {
    const mate = hold(2, 2, 'mate', 'cyan', 900);
    const holdings: Holdings = { keeps: [], land: [mate] };
    expect(judgePlacement({ ...base, score: 10, holdings, x: 2, z: 2 })).toEqual({
      ok: true,
      kind: 'stack',
      stackOn: 1,
      on: mate,
    });
    // Your own tower too: nothing of your colour comes down from inside.
    const own = hold(2, 2, 'me', 'cyan', 100);
    const mine = judgePlacement({
      ...base,
      score: 900,
      holdings: { keeps: [], land: [own] },
      x: 2,
      z: 2,
    });
    expect(mine).toMatchObject({ ok: true, kind: 'stack', stackOn: 1 });
  });

  it('refuses a full stack on land', () => {
    const full = { ...hold(2, 2, 'mate', 'cyan', 900), stack: 8 };
    const verdict = judgePlacement({ ...base, holdings: { keeps: [], land: [full] }, x: 2, z: 2 });
    expect(verdict).toMatchObject({ ok: false, code: 'stack-full' });
  });

  it('takes a rival stack only by beating its best tower', () => {
    const stack = holdOfStack(2, 2, [
      { ...hold(2, 2, 'a', 'rose', 300) },
      { ...hold(2, 2, 'b', 'rose', 800) },
      { ...hold(2, 2, 'c', 'rose', 100) },
    ]);
    expect(stack).toMatchObject({ userId: 'b', score: 800, stack: 3 });
    const holdings: Holdings = { keeps: [], land: [stack] };
    const short = judgePlacement({ ...base, score: 800, holdings, x: 2, z: 2 });
    expect(short).toMatchObject({ ok: false, code: 'bar', bar: 800 });
    const take = judgePlacement({ ...base, score: 801, holdings, x: 2, z: 2 });
    expect(take).toMatchObject({ ok: true, kind: 'take', from: { userId: 'b', score: 800 } });
  });

  it("reaches from the colour's keep and land, so a newcomer builds round its colour", () => {
    // A newcomer with no plot of their own: the colour's keep sets their reach.
    const holdings: Holdings = { keeps: [founded('cyan', 0, 0)], land: [] };
    expect(judgePlacement({ ...base, region: null, holdings, x: 2, z: -2 })).toEqual({
      ok: true,
      kind: 'claim',
    });
    const beyond = judgePlacement({ ...base, region: null, holdings, x: 3, z: 0 });
    expect(beyond).toMatchObject({ ok: false, code: 'out-of-reach' });
  });
});

describe('deriving holds and standings', () => {
  it('reads land holds off the towers standing on land cells only', () => {
    const towers = [
      {
        sessionId: 'a',
        userId: 'u',
        username: 'u',
        score: 1,
        faction: 'cyan' as const,
        gridX: 0,
        gridZ: 0,
        timestamp: 1,
      },
      {
        sessionId: 'b',
        userId: 'u',
        username: 'u',
        score: 2,
        faction: 'cyan' as const,
        gridX: 2,
        gridZ: 0,
        timestamp: 1,
      },
      {
        sessionId: 'c',
        userId: 'u',
        username: 'u',
        score: 3,
        faction: 'cyan' as const,
        timestamp: 1,
      },
      {
        sessionId: 'd',
        userId: 'u',
        username: 'u',
        score: 4,
        faction: 'cyan' as const,
        gridX: 1,
        gridZ: 1,
        timestamp: 1,
      },
    ];
    const kept = [{ rx: 0, rz: 0 }];
    expect(landHoldsFrom(towers, kept, K).map((h) => h.sessionId)).toEqual(['b', 'd']);
    // On a 3x3 map the ring cell is keep, and a keep tower holds no land.
    expect(landHoldsFrom(towers, kept, LEGACY).map((h) => h.sessionId)).toEqual(['b']);
    // A centre nobody keeps is land, so a tower there holds it.
    expect(landHoldsFrom(towers, [], K).map((h) => h.sessionId)).toEqual(['a', 'b', 'd']);
  });

  it('reads a stacked land cell as one hold, named for its best tower', () => {
    const at = (sessionId: string, score: number, userId = 'u') => ({
      sessionId,
      userId,
      username: userId,
      score,
      faction: 'cyan' as const,
      gridX: 2,
      gridZ: 0,
      timestamp: 1,
    });
    const holds = landHoldsFrom([at('a', 300), at('b', 900, 'v'), at('c', 900)], [], K);
    expect(holds).toHaveLength(1);
    // A tie goes to the tower that was there first.
    expect(holds[0]).toMatchObject({ sessionId: 'b', userId: 'v', score: 900, stack: 3 });
    expect(landHoldsFrom([at('a', 300)], [], K)[0]!.stack).toBeUndefined();
  });

  it('counts a keep shared by a colour once', () => {
    const holdings = {
      keeps: [keep('a', 'cyan', 0, 0), keep('b', 'cyan', 0, 0), keep('c', 'rose', 1, 0)],
      land: [],
    };
    expect(landCountByFaction(holdings, K).get('cyan')).toBe(1);
    expect(landCountByFaction(holdings, K).get('rose')).toBe(1);
  });

  it('counts a keep as its cells for the standings', () => {
    const holdings = {
      keeps: [keep('a', 'cyan', 0, 0)],
      land: [hold(2, 0, 'a', 'cyan', 1), hold(3, 0, 'b', 'rose', 1)],
    };
    expect(landCountByFaction(holdings, K).get('cyan')).toBe(2);
    expect(landCountByFaction(holdings, LEGACY).get('cyan')).toBe(10);
    expect(landCountByFaction(holdings, K).get('rose')).toBe(1);
  });
});
