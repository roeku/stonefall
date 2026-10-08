import { describe, expect, it } from 'vitest';
import {
  groundWords,
  mapRecapText,
  mapTitle,
  relayRecapText,
  relayTitle,
  type MapRecap,
} from './daily';

/**
 * What a new day's posts say about yesterday: a title with the challenge and no names, and a
 * pinned comment that names the best players, which tells them.
 */

const DAY = '2026-10-03'; // a Saturday

const recap: MapRecap = {
  ranked: [
    { faction: 'cobalt', cells: 14 },
    { faction: 'rose', cells: 12 },
    { faction: 'lime', cells: 3 },
  ],
  best: { username: 'kv_nine', score: 12400 },
  most: { username: 'orbit_wren', cells: 6 },
};

describe('groundWords', () => {
  it('says who won, over whom, and by how much', () => {
    expect(groundWords(recap.ranked)).toBe('Cobalt edged Rose by 2 cells');
    expect(
      groundWords([
        { faction: 'cobalt', cells: 14 },
        { faction: 'rose', cells: 9 },
      ])
    ).toBe('Cobalt topped Rose by 5 cells');
    expect(
      groundWords([
        { faction: 'jade', cells: 30 },
        { faction: 'gold', cells: 11 },
      ])
    ).toBe('Jade routed Gold, 30 cells to 11');
  });

  it('says a tie, a lone colour, and nothing for no ground', () => {
    expect(
      groundWords([
        { faction: 'jade', cells: 4 },
        { faction: 'gold', cells: 4 },
      ])
    ).toBe('Jade and Gold tied on 4 cells');
    expect(groundWords([{ faction: 'ember', cells: 1 }])).toBe('Ember held all the ground');
    expect(groundWords([{ faction: 'ember', cells: 0 }])).toBeNull();
  });
});

describe('titles', () => {
  it('lead with the score to beat and how the colours did, and end with the day', () => {
    expect(mapTitle(DAY, recap)).toBe(
      "Beat 12,400, yesterday's best tower. Cobalt edged Rose by 2 cells. Stonefall map, Sat 3 Oct"
    );
  });

  it('never name a player: a title cannot be edited once posted', () => {
    expect(mapTitle(DAY, recap)).not.toMatch(/u\/|kv_nine|orbit_wren/);
    expect(relayTitle(DAY, { tallest: 84, most: { username: 'kv_nine', blocks: 23 } })).not.toMatch(
      /u\/|kv_nine/
    );
  });

  it('are only the day when yesterday has nothing to say', () => {
    expect(mapTitle(DAY, null)).toBe('Stonefall map, Sat 3 Oct');
    expect(mapTitle(DAY, { ranked: [], best: null, most: null })).toBe('Stonefall map, Sat 3 Oct');
    expect(relayTitle(DAY, null)).toBe('Relay tower, Sat 3 Oct');
    expect(relayTitle(DAY, { tallest: 1, most: null })).toBe('Relay tower, Sat 3 Oct');
  });

  it('say how high yesterday’s relay got', () => {
    expect(relayTitle(DAY, { tallest: 84, most: null })).toBe(
      "Yesterday's crews stacked 84 blocks. Can yours go higher? Relay tower, Sat 3 Oct"
    );
  });
});

describe('the pinned comment', () => {
  it('names the best tower and the most land, two mentions at most', () => {
    const text = mapRecapText(recap)!;
    expect(text).toBe(
      '**Yesterday.** Best tower: u/kv_nine, **12,400**. Most land: u/orbit_wren, 6 cells. ' +
        'Cobalt edged Rose by 2 cells.'
    );
    expect(text.match(/u\//g)).toHaveLength(2);
  });

  it('names one player once when they did both', () => {
    expect(mapRecapText({ ...recap, most: { username: 'KV_nine', cells: 6 } })).toBe(
      '**Yesterday.** Best tower and most land: u/kv_nine, **12,400** and 6 cells. ' +
        'Cobalt edged Rose by 2 cells.'
    );
  });

  it('says nothing about a day nobody built on', () => {
    expect(mapRecapText(null)).toBeNull();
    expect(mapRecapText({ ranked: [], best: null, most: null })).toBeNull();
  });

  it('names the relay’s best builder', () => {
    expect(relayRecapText({ tallest: 84, most: { username: 'kv_nine', blocks: 23 } })).toBe(
      '**Yesterday.** The tallest tower reached **84** blocks. Most blocks landed: u/kv_nine, 23.'
    );
    expect(relayRecapText({ tallest: 1, most: null })).toBeNull();
  });
});
