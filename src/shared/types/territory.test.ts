import { describe, expect, it } from 'vitest';
import {
  KEEP_RADIUS,
  LEGACY_KEEP_RADIUS,
  REACH,
  cellKind,
  keepRadiusOr,
  cellsHeldBy,
  judgePlacement,
  keepCellsOf,
  landCountByFaction,
  landHoldsFrom,
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
  it('splits a region into a one-cell keep, land, and the road round it', () => {
    expect(cellKind(0, 0, K)).toBe('keep');
    expect(cellKind(1, -1, K)).toBe('land');
    expect(cellKind(2, 0, K)).toBe('land');
    expect(cellKind(REGION_RADIUS, REGION_RADIUS, K)).toBe('land');
    expect(cellKind(REGION_RADIUS + 1, 0, K)).toBe('road');
    // The next region over, one pitch away, has its own keep at its centre.
    expect(cellKind(REGION_PITCH, 0, K)).toBe('keep');
    expect(cellKind(REGION_PITCH + 1, 0, K)).toBe('land');
    expect(cellKind(REGION_PITCH - REGION_RADIUS, 0, K)).toBe('land');
  });

  it('keeps the 3x3 on a map opened before the keep shrank', () => {
    expect(cellKind(1, -1, LEGACY)).toBe('keep');
    expect(cellKind(2, 0, LEGACY)).toBe('land');
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

  it('covered exactly your own plot on day one with a 3x3 keep', () => {
    const held = cellsHeldBy('cyan', mine, empty, LEGACY);
    for (let x = -REGION_RADIUS; x <= REGION_RADIUS; x++) {
      for (let z = -REGION_RADIUS; z <= REGION_RADIUS; z++) {
        expect(withinReach(x, z, held)).toBe(true);
      }
    }
    // The neighbour's nearest land cell, across the road, is one too far.
    expect(withinReach(REGION_PITCH - REGION_RADIUS, 0, held)).toBe(false);
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

describe('judging a placement', () => {
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
    expect(theirs.ok).toBe(false);
    if (!theirs.ok) expect(theirs.code).toBe('foreign-keep');
    const unassigned = judgePlacement({
      ...base,
      x: far.x,
      z: far.z,
      holdings: { keeps: [], land: [] },
    });
    expect(unassigned.ok).toBe(false);
    if (!unassigned.ok) expect(unassigned.code).toBe('reserved');
  });

  it('refuses roads, full stacks and a full plot', () => {
    const road = judgePlacement({
      ...base,
      x: REGION_RADIUS + 1,
      z: 0,
      holdings: { keeps: [], land: [] },
    });
    expect(road.ok).toBe(false);
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
    expect(landHoldsFrom(towers, K).map((h) => h.sessionId)).toEqual(['b', 'd']);
    // On a 3x3 map the ring cell is keep, and a keep tower holds no land.
    expect(landHoldsFrom(towers, LEGACY).map((h) => h.sessionId)).toEqual(['b']);
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
