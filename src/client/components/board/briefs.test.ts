import { describe, expect, it } from 'vitest';
import type { TowerMapEntry } from '../../../shared/types/api';
import type { FactionId } from '../../../shared/types/factions';
import {
  KEEP_RADIUS,
  LEGACY_RULES,
  RULES,
  judgePlacement,
  type MapRules,
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

const judgeWith =
  (
    holdings: Holdings,
    rules: MapRules = LEGACY_RULES,
    region: BriefViewer['region'] = { rx: 0, rz: 0 }
  ) =>
  (x: number, z: number, score: number) =>
    judgePlacement({
      x,
      z,
      score,
      userId: 'me',
      faction: 'violet',
      region,
      holdings,
      keepStacks: new Map(),
      maxStack: 8,
      standing: 0,
      maxStanding: 50,
      keepRadius: KEEP_RADIUS,
      rules,
    });

const holdings: Holdings = {
  keeps: [keep('me', 'violet', 0, 0), keep('r', 'rose', 1, 0)],
  land: [hold(home.x + 2, home.z, 'r', 'rose', 1240)],
};
const opts = {
  viewer,
  judge: judgeWith(holdings),
  live: true,
  keepRadius: KEEP_RADIUS,
  rules: LEGACY_RULES,
};
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
    const t = towerBrief(tower(home.x + 2, home.z, 'r', 'rose', 1240), holdings, {
      ...opts,
      live: false,
    });
    expect(t).toMatchObject({ who: 'u/r', score: 1240, action: null, blocked: null });
  });
});

describe('a tapped tower', () => {
  it('offers to take the cell of a rival tower in reach', () => {
    const b = towerBrief(tower(home.x + 2, home.z, 'r', 'rose', 1240), holdings, opts);
    expect(b.action?.aim).toMatchObject({ kind: 'take', username: 'r' });
  });

  it('falls back to beating a rival score it cannot take, and says why', () => {
    const b = towerBrief(tower(far.x, far.z, 'r', 'rose', 900), holdings, opts);
    expect(b.action).toMatchObject({ verb: 'Beat it', sub: 'Out of reach' });
    expect(b.action?.aim.kind).toBe('beat');
  });

  it('offers nothing on your own tower on your keep', () => {
    const b = towerBrief(tower(home.x, home.z, 'me', 'violet', 500), holdings, opts);
    expect(b).toMatchObject({ who: 'Your tower', action: null, blocked: null });
  });
});

describe('on a factions map', () => {
  const ally = { ...hold(home.x + 2, home.z, 'mate', 'violet', 900), stack: 3 };
  const theirs: Holdings = {
    keeps: [keep('founder', 'violet', 0, 0), keep('r', 'rose', 1, 0)],
    land: [ally],
  };
  // A newcomer to the colour: no plot of their own, building from the colour's keep.
  const newcomer: BriefViewer = { userId: 'me', faction: 'violet', region: null };
  const factionOpts = {
    viewer: newcomer,
    judge: judgeWith(theirs, RULES, null),
    live: true,
    keepRadius: KEEP_RADIUS,
    rules: RULES,
  };

  it("names a keep by its colour, and the viewer's colour's keep as theirs", () => {
    expect(cellBrief(home, theirs, factionOpts).who).toBe('Your keep');
    const rose = regionCenterCell({ rx: 1, rz: 0 });
    expect(cellBrief(rose, theirs, factionOpts).who).toBe("Rose's keep");
  });

  it("offers no take of the colour's own land, and counts its stack", () => {
    const b = cellBrief({ x: ally.x, z: ally.z }, theirs, factionOpts);
    expect(b).toMatchObject({ who: 'u/mate +2', score: 900, action: null, blocked: null });
  });

  it("offers an ally's score to beat, never their cell to take", () => {
    const b = towerBrief(tower(ally.x, ally.z, 'mate', 'violet', 900), theirs, factionOpts);
    expect(b.action).toMatchObject({ verb: 'Beat it', aim: { kind: 'beat' } });
  });
});

describe('a tapped tower built in a stone', () => {
  const t = tower(home.x + 2, home.z, 'r', 'rose', 1240);
  const stoneOf = (userId: string) => (userId === 'r' ? ('obsidian' as const) : ('neon' as const));

  it('names the stone under the cell', () => {
    expect(towerBrief(t, holdings, { ...opts, stoneOf }).where).toMatch(/ · Obsidian$/);
  });

  it('says nothing of the default', () => {
    const b = towerBrief(tower(home.x + 2, home.z, 'me', 'violet', 900), holdings, {
      ...opts,
      stoneOf,
    });
    expect(b.where).not.toMatch(/·/);
  });
});
