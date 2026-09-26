/**
 * Names for a run of consecutive perfect placements.
 *
 * These thresholds drive the audio and the block-colour freeze in the game scene, and the HUD
 * says the name the moment a streak earns one: the word escalates with you. The words are the
 * ones a builder would use for a block laid exactly right, then for what a tower becomes when
 * every block is. They replaced a ladder of Godlike and Omni, which belonged to another game.
 */
export const STREAK_TIERS: ReadonlyArray<{ streak: number; name: string }> = [
  { streak: 1, name: 'Flush' },
  { streak: 2, name: 'Plumb' },
  // "Dead level", not "Level": on its own the word read as a level-up.
  { streak: 4, name: 'Dead level' },
  { streak: 6, name: 'True' },
  { streak: 9, name: 'Square' },
  { streak: 13, name: 'Seamless' },
  { streak: 18, name: 'Sheer' },
  { streak: 24, name: 'Monolith' },
  { streak: 31, name: 'Spire' },
  { streak: 39, name: 'Needle' },
  { streak: 48, name: 'Pinnacle' },
  { streak: 58, name: 'Summit' },
  { streak: 69, name: 'Zenith' },
  { streak: 81, name: 'Skyline' },
  { streak: 94, name: 'Stratosphere' },
  { streak: 108, name: 'Orbit' },
];

/** Which tier a streak of this length has reached, 0 for Flush. */
export const streakTierIndex = (streak: number): number => {
  let index = 0;
  for (let i = 0; i < STREAK_TIERS.length; i++) {
    if (streak >= STREAK_TIERS[i]!.streak) index = i;
    else break;
  }
  return index;
};

/** The name a streak of this length has earned. */
export const streakName = (streak: number): string =>
  STREAK_TIERS[streakTierIndex(streak)]?.name ?? 'Flush';
