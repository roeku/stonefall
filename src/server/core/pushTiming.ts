/**
 * When a push may go, in the player's own time.
 *
 * Devvit's guidance for game notifications: none at night, evenings work best, and a reminder
 * should come while there is still time to act on it. The player's offset from UTC is all the
 * game knows of where they are, sent by the game when they turn notifications on.
 */

/** The local hour a streak reminder goes out at. */
export const EVENING_HOUR = 19;

/** No push from this local hour... */
const QUIET_FROM = 22;
/** ...until this one. */
const QUIET_UNTIL = 9;

/** Whether a value is a UTC offset in minutes east, as `-new Date().getTimezoneOffset()` gives. */
export const isOffset = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= -12 * 60 && v <= 14 * 60;

/** The UTC hour in which it is `localHour` for a player `offset` minutes east of UTC. */
export const utcHourFor = (localHour: number, offset: number): number =>
  ((Math.floor((localHour * 60 - offset) / 60) % 24) + 24) % 24;

/** The player's local hour at `now`. */
export const localHourAt = (now: number, offset: number): number =>
  new Date(now + offset * 60_000).getUTCHours();

/** Whether it is too late or too early to send a player anything. */
export const isQuiet = (now: number, offset: number): boolean => {
  const hour = localHourAt(now, offset);
  return hour >= QUIET_FROM || hour < QUIET_UNTIL;
};

/** Whole hours, rounded up, until the map turns over at 12:00 UTC. */
export const hoursToTurn = (now: number): number => {
  const d = new Date(now);
  let turn = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12);
  if (turn <= now) turn += 86_400_000;
  return Math.max(1, Math.ceil((turn - now) / 3_600_000));
};
