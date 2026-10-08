import { factionName, type FactionId } from '../types/factions';
import { shortDay } from '../types/days';

/**
 * What a new day's posts say about the day before: the title the feed shows, and the pinned
 * comment at the top of the thread.
 *
 * The feed is where people decide whether to open a post or vote on it, and a date gave them
 * nothing to decide on. So the title is yesterday's challenge, the score to beat or the height to
 * pass, and how the colours did, in numbers only. Names never go in a title: a title can't be
 * edited, and a player who deletes their account has to be able to leave the game's posts. They
 * go in the pinned comment instead, where naming somebody also tells them.
 */

/** How yesterday's map ended. */
export interface MapRecap {
  /** Ground held when the day ended, most first. */
  ranked: ReadonlyArray<{ faction: FactionId; cells: number }>;
  /** The day's highest-scoring tower. */
  best: { username: string; score: number } | null;
  /** Who held the most land when the day ended. */
  most: { username: string; cells: number } | null;
}

/** How yesterday's relay ended. */
export interface RelayRecap {
  /** The tallest tower, in blocks. */
  tallest: number;
  /** Who landed the most blocks. */
  most: { username: string; blocks: number } | null;
}

const n = (v: number): string => v.toLocaleString('en-US');
const cells = (v: number): string => `${n(v)} ${v === 1 ? 'cell' : 'cells'}`;

/** How the colours finished, in a few words: who won, over whom, by how much. */
export const groundWords = (ranked: MapRecap['ranked']): string | null => {
  const [first, second] = ranked.filter((r) => r.cells > 0);
  if (!first) return null;
  const a = factionName(first.faction);
  if (!second) return `${a} held all the ground`;
  const b = factionName(second.faction);
  if (first.cells === second.cells) return `${a} and ${b} tied on ${cells(first.cells)}`;
  if (first.cells >= second.cells * 2) {
    return `${a} routed ${b}, ${n(first.cells)} cells to ${n(second.cells)}`;
  }
  const margin = first.cells - second.cells;
  return `${a} ${margin <= 2 ? 'edged' : 'topped'} ${b} by ${cells(margin)}`;
};

/**
 * Today's map title. "Beat 12,400, yesterday's best tower. Cobalt edged Rose by 2 cells.
 * Stonefall map, Sat 3 Oct". With nothing to say about yesterday, only the day.
 */
export const mapTitle = (day: string, recap: MapRecap | null): string => {
  const ground = recap ? groundWords(recap.ranked) : null;
  const best = recap?.best ?? null;
  const parts = [
    best ? `Beat ${n(best.score)}, yesterday's best tower.` : null,
    ground ? `${ground}.` : null,
    `Stonefall map, ${shortDay(day)}`,
  ];
  return parts.filter(Boolean).join(' ');
};

/** Today's relay title: how high yesterday's crews got, and the question that leaves. */
export const relayTitle = (day: string, recap: RelayRecap | null): string =>
  recap && recap.tallest > 1
    ? `Yesterday's crews stacked ${n(recap.tallest)} blocks. Can yours go higher? Relay tower, ${shortDay(day)}`
    : `Relay tower, ${shortDay(day)}`;

/**
 * The first paragraph of today's map's pinned comment: yesterday's best players, by name, so
 * each is told. At most two names, well under the three a comment can mention and still notify.
 */
export const mapRecapText = (recap: MapRecap | null): string | null => {
  if (!recap?.best) return null;
  const { best, most } = recap;
  const ground = groundWords(recap.ranked);
  const same = most && most.username.toLowerCase() === best.username.toLowerCase();
  const people = same
    ? `Best tower and most land: u/${best.username}, **${n(best.score)}** and ${cells(most.cells)}.`
    : `Best tower: u/${best.username}, **${n(best.score)}**.` +
      (most ? ` Most land: u/${most.username}, ${cells(most.cells)}.` : '');
  return `**Yesterday.** ${people}${ground ? ` ${ground}.` : ''}`;
};

/** The first paragraph of today's relay's pinned comment. */
export const relayRecapText = (recap: RelayRecap | null): string | null => {
  if (!recap || recap.tallest <= 1) return null;
  const most = recap.most
    ? ` Most blocks landed: u/${recap.most.username}, ${n(recap.most.blocks)}.`
    : '';
  return `**Yesterday.** The tallest tower reached **${n(recap.tallest)}** blocks.${most}`;
};
