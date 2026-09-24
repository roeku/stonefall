import type { PlacementVerdict } from '../../../shared/types/territory';

/**
 * Why a cell cannot be had, in the two or three words a card has room for.
 *
 * The rules' own reasons are sentences written for the placement line ("Out of reach. Hold
 * something within 2 cells of it."). On a card under a thumb, the sentence was most of the card;
 * the reach layer on the floor already shows where reach runs out.
 */
export const shortReason = (verdict: PlacementVerdict): string | null => {
  if (verdict.ok) return null;
  switch (verdict.code) {
    case 'out-of-reach':
      return 'Out of reach';
    case 'bar':
      return `Beat ${verdict.bar?.toLocaleString() ?? 'the bar'}`;
    case 'cap':
      return 'All your towers are up';
    case 'stack-full':
      return 'Cell is full';
    case 'foreign-keep':
      return 'Their keep';
    case 'reserved':
      return 'Kept for a newcomer';
    case 'road':
      return 'Road';
  }
};
