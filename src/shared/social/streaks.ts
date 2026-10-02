/**
 * Days in a row: how a streak grows, holds and breaks, by map day.
 *
 * A day is a map day (YYYY-MM-DD in UTC, the day its map opened; maps turn over at 12:00 UTC),
 * so a streak counts the days a player played the game, whatever the clock said.
 */

/** The day before a map day. */
export const dayBefore = (day: string): string =>
  new Date(Date.parse(`${day}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/** A streak as stored: its length, and the last day that counted towards it. */
export interface Streak {
  streak: number;
  day: string | null;
}

/**
 * The streak after playing on `day`: unchanged if today already counted, one longer the day
 * after the last, otherwise a fresh start.
 */
export const nextStreak = (prev: Streak, day: string): number =>
  prev.day === day
    ? Math.max(1, prev.streak)
    : prev.day !== null && prev.day === dayBefore(day)
      ? prev.streak + 1
      : 1;

/**
 * A streak as it stands on `day`: alive while the last play was that day or the day before, so a
 * player opening the game before their first run of the day still shows yesterday's run of days.
 */
export const streakOn = (prev: Streak, day: string): number =>
  prev.day !== null && (prev.day === day || prev.day === dayBefore(day)) ? prev.streak : 0;
