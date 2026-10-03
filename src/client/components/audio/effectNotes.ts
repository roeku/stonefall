import type { Chord } from './music';

/**
 * The notes the effects play.
 *
 * Every effect with a pitch takes it from the chord the music is on, or the one the last run ended
 * on (MusicManager.chord), so nothing an effect plays is out of tune with what is sounding: a
 * milestone climbs the chord, a fall comes down it, the end of a run is the chord itself. Variety
 * comes from the chord moving under them, never from detuning: the old effects drifted a few
 * percent at random, which put them between the music's notes.
 *
 * Nothing here may read music.ts at the top level: the two modules import each other.
 */

const pc = (midi: number): number => ((midi % 12) + 12) % 12;

/** The chord's triad, its first three tones, between low and high (MIDI), ascending. */
export function triad(chord: Chord, low: number, high: number): number[] {
  const tones = chord.tones.slice(0, 3);
  const notes: number[] = [];
  for (let m = low; m <= high; m++) if (tones.includes(pc(m))) notes.push(m);
  return notes;
}

/** `count` notes of the triad climbing from `from`. */
export const rise = (chord: Chord, from: number, count: number): number[] =>
  triad(chord, from, from + 36).slice(0, count);

/** `count` notes of the triad coming down from `from`. */
export const fall = (chord: Chord, from: number, count: number): number[] =>
  triad(chord, from - 36, from)
    .reverse()
    .slice(0, count);

/** E minor's pentatonic, E G A B D: under any chord of the progression a tap never clashes. */
const PENTATONIC = [4, 7, 9, 11, 2];
const E6 = 88;

/** A tap's note: E6 scaled by the tap's pitch, on the nearest note of the pentatonic. */
export function tapNote(pitch: number): number {
  const target = E6 + 12 * Math.log2(Math.max(0.25, pitch));
  let best = E6;
  for (let m = E6 - 24; m <= E6 + 24; m++) {
    if (PENTATONIC.includes(pc(m)) && Math.abs(m - target) < Math.abs(best - target)) best = m;
  }
  return best;
}

/** A new best or a rival passed: the triad run up fast from E5, three notes, five for a best. */
export const milestoneNotes = (chord: Chord, best: boolean): number[] =>
  rise(chord, 76, best ? 5 : 3);

export interface EndNotes {
  /** The sub under it all, the chord's root where the bass has it. */
  readonly sub: number;
  /** The root an octave up, the one note that rings longest. */
  readonly root: number;
  /** The triad over it, closed, about an octave up. */
  readonly bloom: number[];
  /** A new best's: the triad again from E5, bright. */
  readonly top: number[];
}

/** The end of a run: the chord the music stopped on, as one last sound. */
export const endNotes = (chord: Chord, best: boolean): EndNotes => ({
  sub: chord.root,
  root: chord.root + 12,
  bloom: rise(chord, 59, 3),
  top: best ? rise(chord, 76, 3) : [],
});

/** A tower raised on the board: two notes to keep, three to claim, four to take. */
export const raiseNotes = (chord: Chord, kind: 'keep' | 'claim' | 'take'): number[] =>
  rise(chord, 71, kind === 'take' ? 4 : kind === 'claim' ? 3 : 2);

/** A stone earned: three high notes of the triad, a glint. */
export const unlockNotes = (chord: Chord): number[] => rise(chord, 83, 3);

/** Relay: the player's turn. The root and the fifth over it, the call to play. */
export function turnNotes(chord: Chord): [number, number] {
  let root = 72;
  while (pc(root) !== chord.tones[0]) root++;
  return [root, root + 7];
}

/** Relay: the top healing. A soft climb up the triad. */
export const healNotes = (chord: Chord): number[] => rise(chord, 67, 3);

/** Relay: a block going over the edge. The triad coming down from where the landings sound. */
export const fallNotes = (chord: Chord, count: number): number[] => fall(chord, 79, count);
