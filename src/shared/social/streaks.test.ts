import { describe, expect, it } from 'vitest';
import { dayBefore, nextStreak, streakOn } from './streaks';

describe('streaks', () => {
  it('knows the day before, across a month and a year', () => {
    expect(dayBefore('2026-10-01')).toBe('2026-09-30');
    expect(dayBefore('2027-01-01')).toBe('2026-12-31');
  });

  it('counts a day once, grows the day after, and starts over after a gap', () => {
    expect(nextStreak({ streak: 0, day: null }, '2026-10-02')).toBe(1);
    expect(nextStreak({ streak: 4, day: '2026-10-02' }, '2026-10-02')).toBe(4);
    expect(nextStreak({ streak: 4, day: '2026-10-01' }, '2026-10-02')).toBe(5);
    expect(nextStreak({ streak: 4, day: '2026-09-29' }, '2026-10-02')).toBe(1);
  });

  it('stands until a whole day is missed', () => {
    expect(streakOn({ streak: 5, day: '2026-10-02' }, '2026-10-02')).toBe(5);
    expect(streakOn({ streak: 5, day: '2026-10-01' }, '2026-10-02')).toBe(5);
    expect(streakOn({ streak: 5, day: '2026-09-30' }, '2026-10-02')).toBe(0);
    expect(streakOn({ streak: 5, day: null }, '2026-10-02')).toBe(0);
  });
});
