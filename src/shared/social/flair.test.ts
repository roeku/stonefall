import { describe, expect, it } from 'vitest';
import { flairFor, isOldFlair, parseAwards, type AwardsHeld } from './flair';
import { FACTIONS } from '../types/factions';

describe('flairFor', () => {
  it('says the colour, the stone and the streak, on the colour itself', () => {
    expect(flairFor({ faction: 'cobalt', stone: 'quartz', streak: 14 })).toEqual({
      text: 'Cobalt · Quartz · 14-day streak',
      backgroundColor: '#5c8dff',
      textColor: 'dark',
    });
  });

  it('leaves out Neon, which everybody has, and a streak of one day', () => {
    expect(flairFor({ faction: 'rose', stone: 'neon', streak: 1 }).text).toBe('Rose');
    expect(flairFor({ faction: 'rose', stone: 'neon', streak: 3 }).text).toBe(
      'Rose · 3-day streak'
    );
    expect(flairFor({ faction: 'rose', stone: 'marble', streak: 0 }).text).toBe('Rose · Marble');
  });

  it('stays within Reddit’s 64 characters, readable on every colour', () => {
    for (const f of FACTIONS) {
      const look = flairFor({ faction: f.id, stone: 'obsidian', streak: 1000 });
      expect(look.text.length).toBeLessThanOrEqual(64);
      expect(look.textColor).toBe('dark');
    }
  });
});

describe('awards in the flair', () => {
  const held = (list: AwardsHeld['list'], faction: AwardsHeld['faction'] = 'cobalt') => ({
    day: '2026-10-03',
    faction,
    list,
  });

  it('says the colour’s win after its name, then the player’s own', () => {
    const look = flairFor({
      faction: 'cobalt',
      stone: 'quartz',
      streak: 14,
      awards: held(['best', 'won']),
    });
    expect(look.text).toBe('Cobalt · Won Sat · Best tower · Quartz · 14-day streak');
    expect(look.backgroundColor).toBe('#5c8dff');
  });

  it('says nothing of a win once the player is on another colour', () => {
    const awards = held(['won', 'land']);
    expect(flairFor({ faction: 'rose', stone: 'neon', streak: 1, awards }).text).toBe(
      'Rose · Most land'
    );
  });

  it('drops the streak, then the stone, before it would run past 64 characters', () => {
    const awards = held(['won', 'best', 'land', 'blocks']);
    const text = flairFor({ faction: 'cobalt', stone: 'obsidian', streak: 120, awards }).text;
    expect(text).toBe('Cobalt · Won Sat · Best tower · Most land · Most blocks');
  });

  it('reads back only awards it knows, and none from nothing', () => {
    expect(parseAwards(undefined)).toBeNull();
    expect(parseAwards('')).toBeNull();
    expect(parseAwards('{"day":"2026-10-03","faction":null,"list":["elo"]}')).toBeNull();
    expect(parseAwards('{"day":"2026-10-03","faction":"jade","list":["best","x"]}')).toEqual({
      day: '2026-10-03',
      faction: 'jade',
      list: ['best'],
    });
  });
});

describe('isOldFlair', () => {
  it('knows the old version’s flair, and nothing a player would write', () => {
    expect(isOldFlair('ELO 1234 | MAX 56')).toBe(true);
    expect(isOldFlair('ELO 0 | MAX 0')).toBe(true);
    expect(isOldFlair('Cobalt · Quartz')).toBe(false);
    expect(isOldFlair('ELO hell | MAX fun')).toBe(false);
    expect(isOldFlair(undefined)).toBe(false);
  });
});
