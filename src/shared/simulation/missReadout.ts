import type { GameState } from './types';

type Placement = NonNullable<GameState['lastPlacement']>;

/**
 * What a landing that was not perfect says about itself: how far off centre it came down, as a
 * share of the tower's width. A share rather than pixels, so it reads the same at any zoom and on
 * any screen. A perfect says nothing here; its streak word already speaks for it.
 */
export const offWord = (p: Placement | null | undefined): string | null => {
  if (!p || p.isPositionPerfect || !p.offset || p.offset.extent <= 0) return null;
  return `${Math.max(1, Math.round((p.offset.error * 100) / p.offset.extent))}% off`;
};
