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
  { streak: 4, name: 'Level' },
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

/** The name a streak of this length has earned. */
export const streakName = (streak: number): string => {
  let name = STREAK_TIERS[0]?.name ?? 'Flush';
  for (const tier of STREAK_TIERS) {
    if (streak >= tier.streak) name = tier.name;
    else break;
  }
  return name;
};
