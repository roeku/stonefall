import { FACTIONS, factionHex, type FactionId } from '../../shared/types/factions';

export {
  FACTIONS,
  FACTION_IDS,
  factionHex,
  factionName,
  isFactionId,
} from '../../shared/types/factions';
export type { FactionId } from '../../shared/types/factions';

/** How a faction's colour is applied to the run: rims, glow, body tint. */
export interface FactionTheme {
  id: FactionId | null;
  accentHex: string;
  /** The rim while a chain is running: the accent pushed toward white. */
  accentSecondaryHex: string;
  blockBaseHex: string;
  blockEmissiveHex: string;
  uiGlowHex: string;
  beaconHex: string;
}

const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

const parse = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const toHex = (r: number, g: number, b: number): string =>
  `#${[r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('')}`;

/** Mix a colour toward another by `t`. */
export const mixHex = (a: string, b: string, t: number): string => {
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  return toHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
};

/** A faction's colour as the run's theme. Null gives the neutral a pre-faction tower wears. */
export const factionTheme = (id: FactionId | null | undefined): FactionTheme => {
  const hex = factionHex(id);
  return {
    id: id ?? null,
    accentHex: hex,
    accentSecondaryHex: mixHex(hex, '#ffffff', 0.45),
    // The body is near-black tinted toward the colour, so a tower reads as its colour even
    // where the rim is thin.
    blockBaseHex: mixHex('#05070c', hex, 0.08),
    blockEmissiveHex: hex,
    uiGlowHex: hex,
    beaconHex: hex,
  };
};

/** Every faction with its colour, for the swatch row. */
export const FACTION_SWATCHES = FACTIONS.map((f) => ({ id: f.id, name: f.name, hex: f.hex }));
