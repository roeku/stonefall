import type { TowerMapEntry } from '../../shared/types/api';

/**
 * How a day on the map ended, read off its board: how many built, how much, the best score
 * standing, and the viewer's own part in it. What an older post says about its day.
 */
export interface DayResult {
  builders: number;
  towers: number;
  /** The highest score standing when the day ended, and where. */
  best: TowerMapEntry | null;
  /** The viewer's best that day and where it placed among everyone's bests. Null if none. */
  mine: { best: number; place: number } | null;
}

export const dayResult = (towers: readonly TowerMapEntry[], userId: string | null): DayResult => {
  const bests = new Map<string, number>();
  let best: TowerMapEntry | null = null;
  for (const t of towers) {
    bests.set(t.userId, Math.max(bests.get(t.userId) ?? 0, t.score));
    if (t.gridX !== undefined && t.gridZ !== undefined && (!best || t.score > best.score)) best = t;
  }
  const own = userId ? bests.get(userId) : undefined;
  const mine =
    own === undefined
      ? null
      : { best: own, place: 1 + [...bests.values()].filter((b) => b > own).length };
  return { builders: bests.size, towers: towers.length, best, mine };
};

const count = (n: number, one: string, many: string): string =>
  `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

const ordinal = (n: number): string => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

/** The day in one line under its map: "38 builders, 112 towers · you placed 4th". */
export const dayLine = (r: DayResult): string => {
  if (r.towers === 0) return 'Nobody built that day';
  const all = `${count(r.builders, 'builder', 'builders')}, ${count(r.towers, 'tower', 'towers')}`;
  return r.mine ? `${all} · you placed ${ordinal(r.mine.place)}` : all;
};
