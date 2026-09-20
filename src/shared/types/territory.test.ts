import { describe, expect, it } from 'vitest';
import {
  REACH,
  cellKind,
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

describe('cell kinds', () => {
  it('splits a region into a 3x3 keep, land, and the road round it', () => {
    expect(cellKind(0, 0)).toBe('keep');
    expect(cellKind(1, -1)).toBe('keep');
    expect(cellKind(2, 0)).toBe('land');
    expect(cellKind(REGION_RADIUS, REGION_RADIUS)).toBe('land');
    expect(cellKind(REGION_RADIUS + 1, 0)).toBe('road');
    // The next region over, one pitch away, has its own keep at its centre.
    expect(cellKind(REGION_PITCH, 0)).toBe('keep');
    expect(cellKind(REGION_PITCH - REGION_RADIUS, 0)).toBe('land');
  });

  it('gives a keep nine cells', () => {
    expect(keepCellsOf({ rx: 0, rz: 0 })).toHaveLength(9);
  });
});

describe('reach', () => {
  const mine = { rx: 0, rz: 0 };
  const empty: Holdings = { keeps: [], land: [] };

  it('covers exactly your own plot on day one', () => {
    const held = cellsHeldBy('cyan', mine, empty);
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
    const held = cellsHeldBy('cyan', mine, holdings);
    expect(withinReach(REGION_PITCH - REGION_RADIUS, 0, held)).toBe(true);
    expect(REGION_PITCH - REGION_RADIUS - REGION_RADIUS).toBe(REACH);
  });

  it("is by colour: a faction mate's keep extends your reach, a rival's does not", () => {
    const holdings: Holdings = {
      keeps: [keep('mate', 'cyan', 1, 0), keep('rival', 'rose', 0, 1)],
      land: [],
    };
    const held = cellsHeldBy('cyan', mine, holdings);
    const mateEdge = regionCenterCell({ rx: 1, rz: 0 });
    const rivalEdge = regionCenterCell({ rx: 0, rz: 1 });
    expect(withinReach(mateEdge.x - 3, mateEdge.z, held)).toBe(true);
    expect(withinReach(rivalEdge.x, rivalEdge.z - 3, held)).toBe(false);
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
    ];
    expect(landHoldsFrom(towers).map((h) => h.sessionId)).toEqual(['b']);
  });

  it('counts a keep as nine cells for the standings', () => {
    const counts = landCountByFaction({
      keeps: [keep('a', 'cyan', 0, 0)],
      land: [hold(2, 0, 'a', 'cyan', 1), hold(3, 0, 'b', 'rose', 1)],
    });
    expect(counts.get('cyan')).toBe(10);
    expect(counts.get('rose')).toBe(1);
  });
});
