import { RELAY } from '../relay/rules';
import type { FactionId } from '../types/factions';
import { dayBefore } from './streaks';

/**
 * Lives won back: relay lives a player earns on the map, on top of the day's RELAY.LIVES.
 *
 * Two ways, each worth RELAY.EARNED_LIVES once a day: every one of the day's orders done, and a
 * tower of your nemesis's toppled. Your nemesis is whoever toppled your towers most this week, so
 * a rivalry is something the game remembers and names, and paying it back is worth a turn in the
 * relay. Earned lives are added to the day's the way a subscriber's are: one who is out is back
 * in, watching, and takes their seat again with a tap of their own.
 *
 * Once a day each is the cap. A subscriber who earns both has five lives, and worked for two of
 * them, which is the difference from the five free ones that were too many.
 *
 * Everything here is pure. The server decides with it, the harness's mock decides with it, and the
 * relay's out screen draws with it.
 */

export type LifeWay = 'orders' | 'nemesis';

export const isLifeWay = (v: unknown): v is LifeWay => v === 'orders' || v === 'nemesis';

/** A way back, said the way the game says it: on the map's mark and in the relay. */
export const wayWords = (way: LifeWay): string =>
  way === 'orders' ? 'Every order done' : 'Nemesis toppled';

/** Lives earned on a map day, as the player's record keeps them (`lives`). */
interface StoredLives {
  day: string;
  ways: LifeWay[];
}

/** The ways a record's lives were earned on `day`. Anything from another day is nothing. */
export const earnedOn = (raw: string | undefined, day: string): LifeWay[] => {
  if (!raw) return [];
  try {
    const stored = JSON.parse(raw) as Partial<StoredLives>;
    if (stored.day !== day || !Array.isArray(stored.ways)) return [];
    return [...new Set(stored.ways.filter(isLifeWay))];
  } catch {
    return [];
  }
};

/** A record's lives once `way` has paid on `day`, to store; null when it had paid already. */
export const withEarned = (raw: string | undefined, day: string, way: LifeWay): string | null => {
  const ways = earnedOn(raw, day);
  if (ways.includes(way)) return null;
  return JSON.stringify({ day, ways: [...ways, way] } satisfies StoredLives);
};

/** Lives a day on top of RELAY.LIVES: the subscription's, and every way that has paid today. */
export const extraLives = (member: boolean, earned: readonly LifeWay[]): number =>
  (member ? RELAY.MEMBER_LIVES : 0) + earned.length * RELAY.EARNED_LIVES;

// --- The nemesis -----------------------------------------------------------------------------

export const NEMESIS = {
  /** Days a nemesis is counted over, today among them. */
  DAYS: 7,
  /** Players a record remembers toppling it, the most topples first. More is nobody's nemesis. */
  KEPT: 16,
} as const;

/** One player's takes of another's towers, by map day. */
export interface RivalRow {
  username: string;
  days: Record<string, number>;
}

/** Who toppled a player's towers, by taker id: the record's `rivals`. */
export type Rivals = Record<string, RivalRow>;

export interface Nemesis {
  userId: string;
  username: string;
  /** Takes of your towers in the last NEMESIS.DAYS days. */
  times: number;
}

/** The days counted on `today`: it and the NEMESIS.DAYS - 1 before it, newest first. */
export const nemesisDays = (today: string): string[] => {
  const days = [today];
  while (days.length < NEMESIS.DAYS) days.push(dayBefore(days[days.length - 1]!));
  return days;
};

/** Takes in a row's days that `today` still counts. */
export const timesIn = (row: RivalRow, today: string): number =>
  nemesisDays(today).reduce((n, d) => n + Math.max(0, Math.floor(Number(row.days[d]) || 0)), 0);

/** The last day in the window a row took a tower on, for ties: the fresher grudge wins. */
const lastIn = (row: RivalRow, today: string): string =>
  nemesisDays(today).find((d) => (Number(row.days[d]) || 0) > 0) ?? '';

/** A stored `rivals` field, or nobody. */
export const rivalsOf = (raw: string | undefined): Rivals => {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const rivals: Rivals = {};
    for (const [id, row] of Object.entries(parsed as Record<string, Partial<RivalRow>>)) {
      if (typeof row?.username !== 'string' || !row.days || typeof row.days !== 'object') continue;
      rivals[id] = { username: row.username, days: { ...row.days } };
    }
    return rivals;
  } catch {
    return {};
  }
};

/**
 * Rivals once `taker` has toppled this player's towers on `day`. Only the window's days are kept,
 * and a taker with none left in it is forgotten, so no name stays longer than the week it counts
 * for; past NEMESIS.KEPT takers the fewest go.
 */
export const withTopple = (
  rivals: Rivals,
  taker: { userId: string; username: string },
  day: string
): Rivals => {
  // Days sort as text. Anything from before the window goes; nothing after it is dropped.
  const oldest = nemesisDays(day)[NEMESIS.DAYS - 1]!;
  const next: Rivals = {};
  for (const [id, row] of Object.entries(rivals)) {
    const days = Object.fromEntries(
      Object.entries(row.days).filter(([d, n]) => d >= oldest && Number(n) > 0)
    );
    if (Object.keys(days).length > 0) next[id] = { username: row.username, days };
  }
  const row = next[taker.userId] ?? { username: taker.username, days: {} };
  next[taker.userId] = {
    username: taker.username,
    days: { ...row.days, [day]: (Number(row.days[day]) || 0) + 1 },
  };
  const kept = Object.entries(next)
    .sort(([, a], [, b]) => timesIn(b, day) - timesIn(a, day))
    .slice(0, NEMESIS.KEPT);
  return Object.fromEntries(kept);
};

/**
 * Whoever toppled this player's towers most this week: the most takes, the latest on a tie, then
 * by name so it is the same answer every time. Null when nobody has.
 */
export const nemesisOf = (rivals: Rivals, today: string): Nemesis | null => {
  let best: (Nemesis & { last: string }) | null = null;
  for (const [userId, row] of Object.entries(rivals)) {
    const times = timesIn(row, today);
    if (times <= 0) continue;
    const last = lastIn(row, today);
    if (
      !best ||
      times > best.times ||
      (times === best.times &&
        (last > best.last || (last === best.last && row.username < best.username)))
    ) {
      best = { userId, username: row.username, times, last };
    }
  }
  return best ? { userId: best.userId, username: best.username, times: best.times } : null;
};

// --- The ways back, as the relay's out screen shows them -------------------------------------

export interface WaysBack {
  /**
   * The day's orders: how many are done, of how many, whether doing them all has paid, and the
   * next one to do, as the map's order line says it.
   */
  orders: { done: number; of: number; earned: boolean; next?: string | null | undefined };
  /**
   * The player's nemesis, while they have a tower on today's map to be toppled, whether one has
   * been today, and their colour, which their name is set in.
   */
  nemesis: (Nemesis & { earned: boolean; faction?: FactionId | null | undefined }) | null;
  /** Subscribed through the game's own button: the subscription's lives are had already. */
  member: boolean;
}

/** The ways back still open: what the out screen lists, in the order it lists them. */
export const openWays = (ways: WaysBack): LifeWay[] => [
  ...(!ways.orders.earned && ways.orders.done < ways.orders.of ? (['orders'] as const) : []),
  ...(ways.nemesis && !ways.nemesis.earned ? (['nemesis'] as const) : []),
];
