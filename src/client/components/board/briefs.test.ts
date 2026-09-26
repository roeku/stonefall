import { describe, expect, it } from 'vitest';
import type { TowerMapEntry } from '../../../shared/types/api';
import type { FactionId } from '../../../shared/types/factions';
import {
  judgePlacement,
  type Holdings,
  type KeepRecord,
  type LandHold,
} from '../../../shared/types/territory';
import { REGION_PITCH, regionCenterCell } from '../../../shared/types/worldGrid';
import { cellBrief, towerBrief, type BriefViewer } from './briefs';

/**
 * What a tapped tower or cell offers: whose it is, its bar, and the one run it can start.
 */

const keep = (userId: string, faction: FactionId, rx: number, rz: number): KeepRecord => {
  const c = regionCenterCell({ rx, rz });
  return { userId, username: userId, faction, rx, rz, centerX: c.x, centerZ: c.z };
};

const hold = (
  x: number,
  z: number,
  userId: string,
  faction: FactionId,
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

const tower = (x: number, z: number, userId: string, faction: FactionId, score: number) =>
  ({
    sessionId: `t-${userId}-${x}-${z}`,
    userId,
    username: userId,
    score,
    blockCount: 10,
    perfectStreak: 0,
    gameMode: 'rotating_block',
    timestamp: 1,
    towerBlocks: [],
    faction,
    gridX: x,
    gridZ: z,
  }) satisfies TowerMapEntry;

const viewer: BriefViewer = { userId: 'me', faction: 'violet', region: { rx: 0, rz: 0 } };
const home = regionCenterCell({ rx: 0, rz: 0 });

const judgeWith = (holdings: Holdings) => (x: number, z: number, score: number) =>
  judgePlacement({
    x,
    z,
    score,
    userId: 'me',
    faction: 'violet',
    region: { rx: 0, rz: 0 },
    holdings,
    keepStacks: new Map(),
    maxStack: 8,
    standing: 0,
    maxStanding: 50,
  });

const holdings: Holdings = {
  keeps: [keep('me', 'violet', 0, 0), keep('r', 'rose', 1, 0)],
  land: [hold(home.x + 2, home.z, 'r', 'rose', 1240)],
};
const opts = { viewer, judge: judgeWith(holdings), live: true };
// Land beside a keep three plots away: land, but nowhere near anything the viewer holds.
const far = { x: home.x - REGION_PITCH * 3 + 2, z: home.z };

describe('a tapped cell', () => {
  it('offers to claim open land in reach, for the colour', () => {
    const b = cellBrief({ x: home.x, z: home.z + 2 }, holdings, opts);
    expect(b.who).toBe('Open land');
    expect(b.action?.verb).toMatch(/^Claim /);
    expect(b.action?.sub).toBe('+1 cell for Violet');
    expect(b.action?.aim.kind).toBe('claim');
  });

  it('offers to take a rival hold in reach, naming the bar and carrying their colour', () => {
    const b = cellBrief({ x: home.x + 2, z: home.z }, holdings, opts);
    expect(b).toMatchObject({ who: 'u/r', faction: 'rose', score: 1240 });
    expect(b.action?.sub).toBe(`Beat ${(1240).toLocaleString()}`);
    expect(b.action?.aim).toMatchObject({ kind: 'take', username: 'r', faction: 'rose' });
  });

  it('says why land out of reach cannot be had, and offers nothing', () => {
    const b = cellBrief(far, holdings, opts);
    expect(b.action).toBeNull();
    expect(b.blocked).toBe('Out of reach');
  });

  it('names a keep and whose it is, with nothing to start', () => {
    expect(cellBrief(home, holdings, opts)).toMatchObject({ who: 'Your keep', action: null });
  });

  it("starts nothing on an older post's day, and says nothing about it", () => {
    const b = cellBrief({ x: home.x, z: home.z + 2 }, holdings, { ...opts, live: false });
    expect(b).toMatchObject({ action: null, blocked: null });
    const t = towerBrief(tower(home.x + 2, home.z, 'r', 'rose', 1240), { ...opts, live: false });
    expect(t).toMatchObject({ who: 'u/r', score: 1240, action: null, blocked: null });
  });
});

describe('a tapped tower', () => {
  it('offers to take the cell of a rival tower in reach', () => {
    const b = towerBrief(tower(home.x + 2, home.z, 'r', 'rose', 1240), opts);
    expect(b.action?.aim).toMatchObject({ kind: 'take', username: 'r' });
  });

  it('falls back to beating a rival score it cannot take, and says why', () => {
    const b = towerBrief(tower(far.x, far.z, 'r', 'rose', 900), opts);
    expect(b.action).toMatchObject({ verb: 'Beat it', sub: 'Out of reach' });
    expect(b.action?.aim.kind).toBe('beat');
  });

  it('offers nothing on your own tower on your keep', () => {
    const b = towerBrief(tower(home.x, home.z, 'me', 'violet', 500), opts);
    expect(b).toMatchObject({ who: 'Your tower', action: null, blocked: null });
  });
});
