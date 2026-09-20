/**
 * Factions: the eight colours a player can build under.
 *
 * A faction is a colour and nothing more. There is no name to moderate, no roster to manage and
 * no leader; players who pick the same colour hold land together, and that is the whole
 * institution. Eight is enough that a small group can have a colour of its own and few enough
 * that the map still reads at a glance on a phone.
 *
 * The two colours this replaces (blue and orange, users versus programs) were a Tron leftover
 * that the shell never even offered: `colorChoice` was hard-wired to null and every tower got a
 * hashed coin flip. A colour nobody chose cannot mean anything.
 *
 * Hues are spaced round the wheel and kept at the saturation the rims need to survive bloom on
 * black. Cobalt rather than a pale ice blue, because a pale blue is indistinguishable from cyan
 * once it glows.
 */
export type FactionId = 'ember' | 'gold' | 'lime' | 'jade' | 'cyan' | 'cobalt' | 'violet' | 'rose';

export interface Faction {
  id: FactionId;
  /** Display name. One word, so it fits a swatch and a comment. */
  name: string;
  /** Rim and tile colour. */
  hex: string;
}

export const FACTIONS: readonly Faction[] = [
  { id: 'ember', name: 'Ember', hex: '#ff6b3d' },
  { id: 'gold', name: 'Gold', hex: '#ffd23d' },
  { id: 'lime', name: 'Lime', hex: '#b6ff3d' },
  { id: 'jade', name: 'Jade', hex: '#3dffb0' },
  { id: 'cyan', name: 'Cyan', hex: '#00f2fe' },
  { id: 'cobalt', name: 'Cobalt', hex: '#5c8dff' },
  { id: 'violet', name: 'Violet', hex: '#b18cff' },
  { id: 'rose', name: 'Rose', hex: '#ff5c9e' },
] as const;

export const FACTION_IDS: readonly FactionId[] = FACTIONS.map((f) => f.id);

const BY_ID: Record<FactionId, Faction> = Object.fromEntries(
  FACTIONS.map((f) => [f.id, f])
) as Record<FactionId, Faction>;

export const isFactionId = (value: unknown): value is FactionId =>
  typeof value === 'string' && (FACTION_IDS as readonly string[]).includes(value);

export const factionOf = (id: FactionId): Faction => BY_ID[id];

/** The faction's display name, or a neutral for anything unknown. */
export const factionName = (id: FactionId | null | undefined): string =>
  id && BY_ID[id] ? BY_ID[id].name : 'Unaligned';

/** Rim colour for a faction; a neutral for towers built before factions existed. */
export const factionHex = (id: FactionId | null | undefined): string =>
  id && BY_ID[id] ? BY_ID[id].hex : '#8ab4c8';

/**
 * The colour a player starts with before choosing one.
 *
 * Hashed from the user id so it is stable across sessions and spread evenly, and so the first
 * tap on the post plays a run instead of opening a menu. The swatch row is one tap away for
 * anyone who wants a different flag; most people never touch it, and eight roughly even blocs
 * is a fine place for a map to start.
 */
export const defaultFactionFor = (userId: string): FactionId => {
  let hash = 2166136261;
  for (let i = 0; i < userId.length; i += 1) {
    hash ^= userId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return FACTION_IDS[(hash >>> 0) % FACTION_IDS.length] ?? 'cyan';
};

/**
 * A faction's colour as "r, g, b", for CSS that needs to set its own alpha. The chrome is lit in
 * the viewer's colour and each card in the colour of whoever it is about, and a rim at 50% and a
 * glow at 20% are the same colour, so the channels are what get passed around.
 */
export const factionRgb = (id: FactionId | null | undefined): string => {
  const n = parseInt(factionHex(id).replace('#', ''), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
};
