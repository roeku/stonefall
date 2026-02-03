import type { PlayerColorChoice } from '../../shared/types/playerColors';
export type { PlayerColorChoice } from '../../shared/types/playerColors';
export { isPlayerColorChoice } from '../../shared/types/playerColors';

export interface PlayerColorTheme {
  id: PlayerColorChoice;
  label: string;
  accentHex: string;
  accentSecondaryHex: string;
  blockBaseHex: string;
  blockEmissiveHex: string;
  uiGlowHex: string;
  startButtonGradient: [string, string];
  beaconHex: string;
}

export const PLAYER_COLOR_THEMES: Record<PlayerColorChoice, PlayerColorTheme> = {
  blue: {
    id: 'blue',
    label: 'Neon Blue',
    accentHex: '#00f2fe',
    accentSecondaryHex: '#00b4ff',
    blockBaseHex: '#0a0a0a',
    blockEmissiveHex: '#00f2fe',
    uiGlowHex: '#2563eb',
    startButtonGradient: ['#0f4c81', '#00f2fe'],
    beaconHex: '#00f2fe',
  },
  orange: {
    id: 'orange',
    label: 'Solar Orange',
    accentHex: '#ff6b3d',
    accentSecondaryHex: '#ff4500',
    blockBaseHex: '#110705',
    blockEmissiveHex: '#ff6b3d',
    uiGlowHex: '#ff784e',
    startButtonGradient: ['#ff8c42', '#ff4500'],
    beaconHex: '#ff6b3d',
  },
};

export const PLAYER_COLOR_STORAGE_KEY = 'tron-player-color';

export const getPlayerColorTheme = (choice?: PlayerColorChoice | null): PlayerColorTheme | null => {
  if (!choice) {
    return null;
  }
  return PLAYER_COLOR_THEMES[choice];
};
