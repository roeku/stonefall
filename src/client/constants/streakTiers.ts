/**
 * Names for a run of consecutive perfect placements.
 *
 * These thresholds already drive the audio and the block-colour freeze in the game scene, where
 * they were an unexported list. Surfacing them in the HUD gives a streak a name the moment it
 * earns one, which is the whole feel of a rhythm chain: the word escalates with you.
 */
export const STREAK_TIERS: ReadonlyArray<{ streak: number; name: string }> = [
  { streak: 1, name: 'Perfect' },
  { streak: 2, name: 'Clean' },
  { streak: 4, name: 'Precise' },
  { streak: 6, name: 'Sharper' },
  { streak: 9, name: 'Flawless' },
  { streak: 13, name: 'Transcendent' },
  { streak: 18, name: 'Ascendant' },
  { streak: 24, name: 'Celestial' },
  { streak: 31, name: 'Ethereal' },
  { streak: 39, name: 'Divine' },
  { streak: 48, name: 'Mythic' },
  { streak: 58, name: 'Legendary' },
  { streak: 69, name: 'Apex' },
  { streak: 81, name: 'Omni' },
  { streak: 94, name: 'Infinite' },
  { streak: 108, name: 'Godlike' },
];

/** The name a streak of this length has earned. */
export const streakName = (streak: number): string => {
  let name = STREAK_TIERS[0]?.name ?? 'Perfect';
  for (const tier of STREAK_TIERS) {
    if (streak >= tier.streak) name = tier.name;
    else break;
  }
  return name;
};
