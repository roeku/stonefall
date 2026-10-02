import { describe, expect, it } from 'vitest';
import {
  STONES,
  newlyUnlocked,
  postingWouldEarn,
  stoneShade,
  unlockWords,
  unlockedStones,
} from './stones';

const none = { bestStreak: 0, postedDays: 0 };

describe('stones', () => {
  it('gives a newcomer neon and nothing else', () => {
    expect(unlockedStones(none)).toEqual(['neon']);
  });

  it('earns marble with the first comment, slate with three days in a row', () => {
    expect(newlyUnlocked(none, { bestStreak: 1, postedDays: 1 })).toEqual(['marble']);
    expect(
      newlyUnlocked({ bestStreak: 2, postedDays: 1 }, { bestStreak: 3, postedDays: 1 })
    ).toEqual(['slate']);
  });

  it('keeps what the best streak earned after the streak breaks', () => {
    expect(unlockedStones({ bestStreak: 7, postedDays: 0 })).toEqual([
      'neon',
      'slate',
      'granite',
      'obsidian',
    ]);
  });

  it('gives every stone its own finish in the shader', () => {
    const shades = STONES.map((s) => s.shade);
    expect(new Set(shades).size).toBe(STONES.length);
    expect(stoneShade(null)).toBe(0);
  });

  it('says what the next post is worth, once a day', () => {
    expect(postingWouldEarn(none, false)).toMatchObject({
      stone: { id: 'marble' },
      day: 1,
      of: 1,
    });
    expect(postingWouldEarn({ bestStreak: 0, postedDays: 1 }, false)).toMatchObject({
      stone: { id: 'crystal' },
      day: 2,
      of: 3,
    });
    expect(postingWouldEarn(none, true)).toBeNull();
    expect(postingWouldEarn({ bestStreak: 0, postedDays: 7 }, false)).toBeNull();
  });

  it('says how each is earned', () => {
    expect(STONES.map(unlockWords)).toContain('Play 3 days in a row');
    expect(STONES.map(unlockWords)).toContain('Post a comment about a run');
  });
});
