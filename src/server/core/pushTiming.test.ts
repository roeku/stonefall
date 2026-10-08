import { describe, expect, it } from 'vitest';
import { hoursToTurn, isOffset, isQuiet, localHourAt, utcHourFor } from './pushTiming';
import { PUSH_COPY } from './notify';

const at = (iso: string) => Date.parse(iso);

describe('push timing', () => {
  it('finds the UTC hour of a local evening, east and west and half-hours', () => {
    expect(utcHourFor(19, 0)).toBe(19);
    expect(utcHourFor(19, -300)).toBe(0); // New York in winter: 19:00 is midnight UTC
    expect(utcHourFor(19, 120)).toBe(17); // Berlin in summer
    expect(utcHourFor(19, 330)).toBe(13); // Delhi: 13:30 UTC, sent at 13:05, 18:35 there
    expect(utcHourFor(19, 600)).toBe(9); // Sydney
  });

  it('keeps quiet at night where the player is', () => {
    expect(localHourAt(at('2026-10-03T02:00:00Z'), -300)).toBe(21);
    expect(isQuiet(at('2026-10-03T02:00:00Z'), -300)).toBe(false); // 21:00 in New York
    expect(isQuiet(at('2026-10-03T04:00:00Z'), -300)).toBe(true); // 23:00
    expect(isQuiet(at('2026-10-03T12:00:00Z'), -300)).toBe(true); // 07:00
    expect(isQuiet(at('2026-10-03T14:00:00Z'), -300)).toBe(false); // 09:00
  });

  it('counts the hours left before the map turns over at noon UTC', () => {
    expect(hoursToTurn(at('2026-10-03T00:05:00Z'))).toBe(12);
    expect(hoursToTurn(at('2026-10-03T11:30:00Z'))).toBe(1);
    expect(hoursToTurn(at('2026-10-03T12:00:00Z'))).toBe(24);
    expect(hoursToTurn(at('2026-10-03T19:05:00Z'))).toBe(17);
  });

  it('takes only a real offset from the client', () => {
    expect(isOffset(-300)).toBe(true);
    expect(isOffset(840)).toBe(true);
    expect(isOffset(900)).toBe(false);
    expect(isOffset(1.5)).toBe(false);
    expect(isOffset('60')).toBe(false);
  });
});

describe('push copy', () => {
  it('fits Devvit’s limits once filled with the longest values', () => {
    const fill = (t: string, data: Record<string, string>) =>
      t.replace(/\{\{(\w+)\}\}/g, (_, k: string) => data[k] ?? '');
    const longest = {
      taker: 'x'.repeat(20),
      cell: 'AA-99',
      score: '999,999',
      days: '1000',
      left: '24 hours',
    };
    for (const copy of Object.values(PUSH_COPY)) {
      expect(fill(copy.title, longest).length).toBeLessThanOrEqual(60);
      expect(fill(copy.body, longest).length).toBeLessThanOrEqual(100);
    }
  });
});
