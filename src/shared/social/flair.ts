import { weekday } from '../types/days';
import { factionHex, factionName, isFactionId, type FactionId } from '../types/factions';
import { DEFAULT_STONE, stoneOf, type StoneId } from './stones';

/**
 * A player's flair in the subreddit: their colour, what they won yesterday, their stone and their
 * days in a row, next to their name on everything they post there. A comment then says which side
 * its author is on and what they have earned, so the thread shows the colours the map does, and a
 * stone or a win is something other people see.
 *
 * Worn when the player turns it on in the game, and by everyone who wins something for the day
 * it is held (`server/core/awards.ts`).
 */

/**
 * What a day's results give a player to hold until the next day's: their colour held the most
 * ground (`won`), or they had the best tower, the most land or the most relay blocks.
 */
export type Award = 'won' | 'best' | 'land' | 'blocks';

/** A player's awards, the day they were won on, and with `won` the colour that won. */
export interface AwardsHeld {
  day: string;
  faction: FactionId | null;
  list: Award[];
}

/** In the order the flair says them: the colour's win straight after the colour's name. */
const AWARD_ORDER: readonly Award[] = ['won', 'best', 'land', 'blocks'];

const AWARD_WORDS: Record<Exclude<Award, 'won'>, string> = {
  best: 'Best tower',
  land: 'Most land',
  blocks: 'Most blocks',
};

const isAward = (v: unknown): v is Award => AWARD_ORDER.includes(v as Award);

/** A record's stored awards, or null for none or anything unreadable. */
export const parseAwards = (raw: string | undefined): AwardsHeld | null => {
  if (!raw) return null;
  try {
    const a = JSON.parse(raw) as Partial<AwardsHeld>;
    const list = Array.isArray(a.list) ? a.list.filter(isAward) : [];
    if (typeof a.day !== 'string' || list.length === 0) return null;
    return { day: a.day, faction: isFactionId(a.faction) ? a.faction : null, list };
  } catch {
    return null;
  }
};

export interface FlairLook {
  text: string;
  /** The colour's own hex, so the flair is the side at a glance. */
  backgroundColor: string;
  textColor: 'light' | 'dark';
}

/** Reddit's limit on flair text. */
const FLAIR_MAX = 64;

/** Relative luminance of a #rrggbb colour, 0 to 1. */
const luminance = (hex: string): number => {
  const v = parseInt(hex.slice(1), 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((v >> 16) & 255) + 0.7152 * lin((v >> 8) & 255) + 0.0722 * lin(v & 255);
};

/** What the flair says for each award held, in order. */
const awardWords = (awards: AwardsHeld, faction: FactionId): string[] =>
  AWARD_ORDER.filter((a) => awards.list.includes(a)).flatMap((a) => {
    if (a !== 'won') return [AWARD_WORDS[a]];
    return awards.faction === faction ? [`Won ${weekday(awards.day)}`] : [];
  });

/**
 * "Cobalt · Won Sat · Best tower · Quartz · 14-day streak": the colour, its win, the player's own
 * awards, the stone once it isn't Neon, the streak from 2. A colour's win is said only while the
 * player is still on that colour. When it is too long, the end goes first: the streak, then the
 * stone.
 */
export const flairFor = (p: {
  faction: FactionId;
  stone: StoneId;
  streak: number;
  awards?: AwardsHeld | null;
}): FlairLook => {
  const words = [
    factionName(p.faction),
    ...(p.awards ? awardWords(p.awards, p.faction) : []),
    ...(p.stone !== DEFAULT_STONE ? [stoneOf(p.stone).name] : []),
    ...(p.streak >= 2 ? [`${p.streak.toLocaleString('en-US')}-day streak`] : []),
  ];
  while (words.length > 1 && words.join(' · ').length > FLAIR_MAX) words.pop();
  const hex = factionHex(p.faction);
  return {
    text: words.join(' · ').slice(0, FLAIR_MAX),
    backgroundColor: hex,
    // Every colour is a bright one today, but the text stays readable if that changes.
    textColor: luminance(hex) > 0.18 ? 'dark' : 'light',
  };
};

/**
 * The flair the version before the rewrite set on every player without asking, "ELO 1234 |
 * MAX 56" (archive/server/core/userFlairService.ts). Anything else is a flair someone chose.
 */
export const isOldFlair = (text: string | undefined): boolean =>
  /^ELO \d+ \| MAX \d+$/.test(text ?? '');
