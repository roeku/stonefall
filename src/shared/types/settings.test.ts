import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, settingsFrom } from './settings';

describe('settings from a record or a request', () => {
  it('keeps what is valid', () => {
    expect(settingsFrom({ sound: false, shake: false, quality: 'low', start: 4 })).toEqual({
      sound: false,
      shake: false,
      quality: 'low',
      start: 4,
    });
  });

  it('fills what is missing from the base', () => {
    const base = { sound: false, shake: true, quality: 'low' as const, start: 2 as const };
    expect(settingsFrom({ shake: false }, base)).toEqual({ ...base, shake: false });
    expect(settingsFrom(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('turns anything unknown into the default rather than trusting it', () => {
    expect(settingsFrom({ sound: 'yes', quality: 'ultra', start: 3 })).toEqual({
      ...DEFAULT_SETTINGS,
      start: 1,
    });
  });
});
