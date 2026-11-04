import { describe, expect, it } from 'vitest';
import { RELAY, grantLives, livesLeft } from '../relay/rules';
import type { RelayPlayer } from '../types/api';
import {
  NEMESIS,
  earnedOn,
  extraLives,
  nemesisOf,
  openWays,
  rivalsOf,
  withEarned,
  withTopple,
  type Rivals,
} from './lives';

const kes = { userId: 't2_kes', username: 'kestrel' };
const ash = { userId: 't2_ash', username: 'ashlar' };

describe('lives won back', () => {
  it('pays each way once a day, and forgets them the next', () => {
    const once = withEarned(undefined, '2026-11-04', 'orders');
    expect(once).not.toBeNull();
    expect(earnedOn(once!, '2026-11-04')).toEqual(['orders']);
    expect(withEarned(once!, '2026-11-04', 'orders')).toBeNull();
    const both = withEarned(once!, '2026-11-04', 'nemesis');
    expect(earnedOn(both!, '2026-11-04')).toEqual(['orders', 'nemesis']);
    expect(earnedOn(both!, '2026-11-05')).toEqual([]);
    expect(earnedOn('not json', '2026-11-04')).toEqual([]);
  });

  it('adds what was earned to what a subscription gives', () => {
    expect(extraLives(false, [])).toBe(0);
    expect(extraLives(true, [])).toBe(RELAY.MEMBER_LIVES);
    expect(extraLives(true, ['orders', 'nemesis'])).toBe(
      RELAY.MEMBER_LIVES + 2 * RELAY.EARNED_LIVES
    );
  });

  it('brings somebody who is out back in with an earned life', () => {
    const p: RelayPlayer = {
      userId: 't2_me',
      username: 'me',
      faction: 'violet',
      snoovatar: null,
      joinedAt: 0,
      tower: 7,
      blocks: 3,
      perfects: 0,
      misses: RELAY.LIVES,
      out: { block: 40, at: 1 },
    };
    expect(grantLives(p, extraLives(false, ['orders']))).toBe(true);
    expect(p.out).toBeUndefined();
    expect(p.tower).toBeNull();
    expect(livesLeft(p)).toBe(RELAY.EARNED_LIVES);
    // The same lives again change nothing.
    expect(grantLives(p, extraLives(false, ['orders']))).toBe(false);
  });
});

describe('the nemesis', () => {
  it('is whoever toppled you most this week', () => {
    let rivals: Rivals = {};
    rivals = withTopple(rivals, kes, '2026-11-01');
    rivals = withTopple(rivals, ash, '2026-11-02');
    rivals = withTopple(rivals, kes, '2026-11-03');
    expect(nemesisOf(rivals, '2026-11-04')).toEqual({ ...kes, times: 2 });
  });

  it('goes to the fresher grudge on a tie', () => {
    let rivals: Rivals = {};
    rivals = withTopple(rivals, kes, '2026-11-01');
    rivals = withTopple(rivals, ash, '2026-11-03');
    expect(nemesisOf(rivals, '2026-11-04')?.userId).toBe(ash.userId);
  });

  it('counts only the last week, and forgets a name when it has nothing left in it', () => {
    let rivals: Rivals = withTopple({}, kes, '2026-10-20');
    expect(nemesisOf(rivals, '2026-10-26')?.userId).toBe(kes.userId);
    expect(nemesisOf(rivals, '2026-10-27')).toBeNull();
    rivals = withTopple(rivals, ash, '2026-10-27');
    expect(Object.keys(rivals)).toEqual([ash.userId]);
  });

  it('keeps a later day written before an earlier one', () => {
    let rivals = withTopple({}, kes, '2026-11-03');
    rivals = withTopple(rivals, kes, '2026-11-02');
    expect(nemesisOf(rivals, '2026-11-04')).toEqual({ ...kes, times: 2 });
  });

  it('keeps the takes per day, and the newest name', () => {
    let rivals = withTopple({}, kes, '2026-11-04');
    rivals = withTopple(rivals, { ...kes, username: 'kestrel_2' }, '2026-11-04');
    expect(rivals[kes.userId]).toEqual({ username: 'kestrel_2', days: { '2026-11-04': 2 } });
  });

  it('remembers only so many takers, the fewest going first', () => {
    let rivals: Rivals = withTopple({}, kes, '2026-11-04');
    rivals = withTopple(rivals, kes, '2026-11-04');
    for (let i = 0; i < NEMESIS.KEPT + 4; i++) {
      rivals = withTopple(rivals, { userId: `t2_${i}`, username: `p${i}` }, '2026-11-04');
    }
    expect(Object.keys(rivals)).toHaveLength(NEMESIS.KEPT);
    expect(rivals[kes.userId]).toBeDefined();
  });

  it('reads a stored field, and nothing from anything else', () => {
    const rivals = withTopple({}, kes, '2026-11-04');
    expect(rivalsOf(JSON.stringify(rivals))).toEqual(rivals);
    expect(rivalsOf(undefined)).toEqual({});
    expect(rivalsOf('[1,2]')).toEqual({});
    expect(rivalsOf('{"t2_x":{"days":{}}}')).toEqual({});
  });
});

describe('the ways back', () => {
  it('lists what can still pay, orders first', () => {
    const nemesis = { ...kes, times: 3, earned: false };
    expect(openWays({ orders: { done: 1, of: 3, earned: false }, nemesis, member: false })).toEqual(
      ['orders', 'nemesis']
    );
    expect(
      openWays({
        orders: { done: 3, of: 3, earned: true },
        nemesis: { ...nemesis, earned: true },
        member: true,
      })
    ).toEqual([]);
    // Orders all done before lives were earned for them: nothing left to do there.
    expect(
      openWays({ orders: { done: 3, of: 3, earned: false }, nemesis: null, member: false })
    ).toEqual([]);
  });
});
