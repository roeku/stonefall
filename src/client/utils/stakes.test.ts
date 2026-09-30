import { describe, expect, it } from 'vitest';
import {
  KEEP_RADIUS,
  LEGACY_KEEP_RADIUS,
  judgePlacement,
  type Holdings,
  type KeepRecord,
  type LandHold,
} from '../../shared/types/territory';
import type { FactionId } from '../../shared/types/factions';
import { REGION_PITCH, regionCenterCell } from '../../shared/types/worldGrid';
import { aimFor, chaseFor, chaseLadder, ordinal, standingOf, type Judge } from './stakes';

/**
 * The defaults a run is given: what to chase, where the finished tower is aimed, and what the
 * standings line will say about it.
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

const me = { userId: 'me', faction: 'cyan' as FactionId };
const home = { x: 0, z: 0 };

const judgeWith =
  (holdings: Holdings, standing = 0): Judge =>
  (x, z, score) =>
    judgePlacement({
      x,
      z,
      score,
      userId: me.userId,
      faction: me.faction,
      region: { rx: 0, rz: 0 },
      holdings,
      keepStacks: new Map(),
      maxStack: 8,
      standing,
      maxStanding: 50,
      keepRadius: KEEP_RADIUS,
    });

describe('what an unaimed run chases', () => {
  it('is nothing on a fresh plot', () => {
    const holdings: Holdings = { keeps: [keep('me', 'cyan', 0, 0)], land: [] };
    expect(chaseFor(holdings, judgeWith(holdings), me, home)).toBeNull();
  });

  it('is the lowest rival bar in reach, not an ally and not your own', () => {
    const holdings: Holdings = {
      keeps: [keep('me', 'cyan', 0, 0)],
      land: [
        hold(2, 0, 'rose1', 'rose', 900),
        hold(-2, 0, 'rose2', 'rose', 400),
        hold(0, 2, 'ally', 'cyan', 100),
        hold(0, -2, 'me', 'cyan', 50),
      ],
    };
    expect(chaseFor(holdings, judgeWith(holdings), me, home)?.userId).toBe('rose2');
  });

  it('lines up every rival bar in reach, lowest first, leaving out a cell just raised on', () => {
    const holdings: Holdings = {
      keeps: [keep('me', 'cyan', 0, 0)],
      land: [
        hold(2, 0, 'rose1', 'rose', 900),
        hold(-2, 0, 'rose2', 'rose', 400),
        hold(0, 2, 'gold1', 'gold', 650),
        hold(0, -2, 'ally', 'cyan', 100),
      ],
    };
    const judge = judgeWith(holdings);
    expect(chaseLadder(holdings, judge, me, home).map((h) => h.score)).toEqual([400, 650, 900]);
    expect(chaseLadder(holdings, judge, me, home, { x: -2, z: 0 }).map((h) => h.userId)).toEqual([
      'gold1',
      'rose1',
    ]);
    expect(chaseLadder(holdings, judge, me, home, null, 2)).toHaveLength(2);
  });

  it('ignores holds out of reach', () => {
    const far = REGION_PITCH * 3;
    const holdings: Holdings = {
      keeps: [keep('me', 'cyan', 0, 0)],
      land: [hold(far + 2, 0, 'rose1', 'rose', 10)],
    };
    expect(chaseFor(holdings, judgeWith(holdings), me, home)).toBeNull();
  });
});

describe('where a finished tower is aimed', () => {
  const holdings: Holdings = {
    keeps: [keep('me', 'cyan', 0, 0)],
    land: [hold(2, 0, 'rose1', 'rose', 900), hold(-2, 0, 'rose2', 'rose', 400)],
  };
  const judge = judgeWith(holdings);
  const keepCell = { x: 0, z: 0 };

  it('takes the highest rival bar the score beats', () => {
    const aim = aimFor({
      holdings,
      judge,
      me,
      score: 1000,
      home,
      keep: keepCell,
      keepRadius: KEEP_RADIUS,
    });
    expect(aim).toMatchObject({ x: 2, z: 0, kind: 'take' });
    expect(aim?.from?.userId).toBe('rose1');
  });

  it('takes a lower bar when the higher one is out of its league', () => {
    const aim = aimFor({
      holdings,
      judge,
      me,
      score: 500,
      home,
      keep: keepCell,
      keepRadius: KEEP_RADIUS,
    });
    expect(aim).toMatchObject({ x: -2, z: 0, kind: 'take' });
  });

  it('claims the nearest open land when it beats nobody', () => {
    const aim = aimFor({
      holdings,
      judge,
      me,
      score: 100,
      home,
      keep: keepCell,
      keepRadius: KEEP_RADIUS,
    });
    expect(aim?.kind).toBe('claim');
    // Right beside the keep: the ring that was keep on a 3x3 map is land now.
    expect(Math.max(Math.abs(aim!.x), Math.abs(aim!.z))).toBe(1);
  });

  it('prefers the cell the run was chasing when the tower can have it', () => {
    const aim = aimFor({
      holdings,
      judge,
      me,
      score: 1000,
      home,
      keep: keepCell,
      chased: { x: -2, z: 0 },
      keepRadius: KEEP_RADIUS,
    });
    expect(aim).toMatchObject({ x: -2, z: 0, kind: 'take' });
  });

  it('falls back to the keep when no land can be had', () => {
    const capped = judgeWith(holdings, 50);
    expect(
      aimFor({
        holdings,
        judge: capped,
        me,
        score: 1000,
        home,
        keep: keepCell,
        keepRadius: KEEP_RADIUS,
      })
    ).toEqual({
      x: 0,
      z: 0,
      kind: 'keep',
    });
  });
});

describe('standings', () => {
  it('ranks by cells, a keep counting its one cell, so land decides', () => {
    const holdings: Holdings = {
      keeps: [keep('me', 'cyan', 0, 0), keep('r', 'rose', 1, 0), keep('r2', 'rose', 2, 0)],
      land: [hold(2, 0, 'me', 'cyan', 10), hold(1, 0, 'me', 'cyan', 10)],
    };
    expect(standingOf(holdings, 'cyan', KEEP_RADIUS)).toEqual({ place: 1, of: 2, cells: 3 });
    expect(standingOf(holdings, 'rose', KEEP_RADIUS)).toEqual({ place: 2, of: 2, cells: 2 });
    expect(standingOf(holdings, 'gold', KEEP_RADIUS)).toEqual({ place: 0, of: 2, cells: 0 });
    // On a map that kept the 3x3, keeps counted nine each and outweighed the land.
    expect(standingOf(holdings, 'cyan', LEGACY_KEEP_RADIUS)).toMatchObject({ place: 2, cells: 11 });
    expect(standingOf(holdings, 'rose', LEGACY_KEEP_RADIUS)).toMatchObject({ place: 1, cells: 18 });
  });

  it('says places the way people do', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
    ]);
  });
});
