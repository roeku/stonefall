/**
 * Stones: what a player's blocks are made of.
 *
 * Every block is dark glass with neon edges until the player earns another stone: marble veined
 * through, crystal, obsidian cracked open, and so on. The faction is still the colour; a stone
 * is only the finish, so a Rose player's marble is rose marble and the map still reads by colour
 * at a glance. A player's stone covers their blocks in a run and every tower they have standing,
 * and it is theirs to keep.
 *
 * Stones are earned two ways. Days in a row played, counted from the best streak so a broken one
 * never takes a stone back, and days a player said something about a run in the thread. Days, not
 * comments: posting five times in one day counts once, so nothing here rewards saying more, only
 * coming back. This is the reward Marble Mazes' free skin was, which is what got people talking
 * there, made to fit a game whose colours are its sides.
 */

export type StoneId =
  | 'neon'
  | 'marble'
  | 'slate'
  | 'crystal'
  | 'granite'
  | 'obsidian'
  | 'basalt'
  | 'quartz';

export type StoneUnlock =
  | { by: 'start' }
  /** Days in a row played. */
  | { by: 'streak'; days: number }
  /** Days a comment about a run was posted. */
  | { by: 'posts'; days: number };

export interface Stone {
  id: StoneId;
  name: string;
  /** The finish the block shader draws: an index into its table, never reordered. */
  shade: number;
  unlock: StoneUnlock;
}

/** In the order they are earned, which is the order the picker shows them. */
export const STONES: readonly Stone[] = [
  { id: 'neon', name: 'Neon', shade: 0, unlock: { by: 'start' } },
  { id: 'marble', name: 'Marble', shade: 1, unlock: { by: 'posts', days: 1 } },
  { id: 'slate', name: 'Slate', shade: 4, unlock: { by: 'streak', days: 3 } },
  { id: 'crystal', name: 'Crystal', shade: 2, unlock: { by: 'posts', days: 3 } },
  { id: 'granite', name: 'Granite', shade: 5, unlock: { by: 'streak', days: 5 } },
  { id: 'obsidian', name: 'Obsidian', shade: 3, unlock: { by: 'streak', days: 7 } },
  { id: 'basalt', name: 'Basalt', shade: 6, unlock: { by: 'posts', days: 7 } },
  { id: 'quartz', name: 'Quartz', shade: 7, unlock: { by: 'streak', days: 14 } },
] as const;

export const DEFAULT_STONE: StoneId = 'neon';

const BY_ID = new Map<string, Stone>(STONES.map((s) => [s.id, s]));

export const isStoneId = (value: unknown): value is StoneId =>
  typeof value === 'string' && BY_ID.has(value);

export const stoneOf = (id: StoneId | null | undefined): Stone =>
  BY_ID.get(id ?? DEFAULT_STONE) ?? BY_ID.get(DEFAULT_STONE)!;

/** The shader's index for a stone; the default for anything unknown. */
export const stoneShade = (id: StoneId | null | undefined): number => stoneOf(id).shade;

/** What a player has done that stones are earned by. */
export interface StoneProgress {
  /** The longest run of days in a row they have played. */
  bestStreak: number;
  /** Days they have posted a comment about a run. */
  postedDays: number;
}

export const isUnlocked = (stone: Stone, p: StoneProgress): boolean =>
  stone.unlock.by === 'start' ||
  (stone.unlock.by === 'streak' ? p.bestStreak : p.postedDays) >= stone.unlock.days;

/** Every stone a player has earned, in table order. */
export const unlockedStones = (p: StoneProgress): StoneId[] =>
  STONES.filter((s) => isUnlocked(s, p)).map((s) => s.id);

/** Stones earned between two moments, in table order. */
export const newlyUnlocked = (before: StoneProgress, after: StoneProgress): StoneId[] =>
  STONES.filter((s) => !isUnlocked(s, before) && isUnlocked(s, after)).map((s) => s.id);

/** How a stone is earned, said the way the picker says it. */
export const unlockWords = (stone: Stone): string => {
  const u = stone.unlock;
  if (u.by === 'start') return 'Everyone starts with it';
  if (u.by === 'streak') return `Play ${u.days} days in a row`;
  return u.days === 1 ? 'Post a comment about a run' : `Post on ${u.days} different days`;
};

/**
 * What posting a comment today would do towards a stone, for the line under the offer: the next
 * stone earned by posting, and whether this post earns it. Null when today has already counted
 * or every such stone is earned.
 */
export const postingWouldEarn = (
  p: StoneProgress,
  postedToday: boolean
): { stone: Stone; day: number; of: number } | null => {
  if (postedToday) return null;
  const next = STONES.find((s) => s.unlock.by === 'posts' && !isUnlocked(s, p));
  if (!next || next.unlock.by !== 'posts') return null;
  return { stone: next, day: p.postedDays + 1, of: next.unlock.days };
};
