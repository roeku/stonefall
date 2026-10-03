import { describe, expect, it } from 'vitest';
import {
  endNotes,
  fall,
  fallNotes,
  healNotes,
  milestoneNotes,
  raiseNotes,
  rise,
  tapNote,
  turnNotes,
  unlockNotes,
} from './effectNotes';
import { PROGRESSION, type Chord } from './music';

const pc = (midi: number) => ((midi % 12) + 12) % 12;
const ascending = (notes: number[]) => notes.every((n, i) => i === 0 || n > notes[i - 1]!);

/** Every note any effect plays on a chord. */
const everything = (chord: Chord): number[] => {
  const end = endNotes(chord, true);
  return [
    ...milestoneNotes(chord, true),
    end.sub,
    end.root,
    ...end.bloom,
    ...end.top,
    ...raiseNotes(chord, 'take'),
    ...unlockNotes(chord),
    ...turnNotes(chord),
    ...healNotes(chord),
    ...fallNotes(chord, 5),
  ];
};

describe('effect notes', () => {
  it('plays only notes of the chord under it, so no effect is out of tune with the music', () => {
    for (const chord of PROGRESSION) {
      for (const note of everything(chord)) expect(chord.tones).toContain(pc(note));
    }
  });

  it('climbs and falls the triad, as many notes as asked', () => {
    for (const chord of PROGRESSION) {
      const up = rise(chord, 64, 4);
      const down = fall(chord, 79, 4);
      expect(up).toHaveLength(4);
      expect(down).toHaveLength(4);
      expect(ascending(up)).toBe(true);
      expect(ascending([...down].reverse())).toBe(true);
      for (const n of [...up, ...down]) expect(chord.tones.slice(0, 3)).toContain(pc(n));
    }
  });

  it('runs a best further up than a pass', () => {
    for (const chord of PROGRESSION) {
      const pass = milestoneNotes(chord, false);
      const best = milestoneNotes(chord, true);
      expect(pass).toHaveLength(3);
      expect(best.length).toBeGreaterThan(pass.length);
      expect(best.at(-1)!).toBeGreaterThan(pass.at(-1)!);
    }
  });

  it('ends a run on the chord: a root, a triad over it, and a top only for a best', () => {
    for (const chord of PROGRESSION) {
      const plain = endNotes(chord, false);
      expect(plain.top).toEqual([]);
      expect(plain.root - plain.sub).toBe(12);
      expect(Math.min(...plain.bloom)).toBeGreaterThan(plain.root);
      expect(endNotes(chord, true).top).toHaveLength(3);
    }
  });

  it('answers a raise with more notes the more it wins', () => {
    const chord = PROGRESSION[0]!;
    expect(raiseNotes(chord, 'keep')).toHaveLength(2);
    expect(raiseNotes(chord, 'claim')).toHaveLength(3);
    expect(raiseNotes(chord, 'take')).toHaveLength(4);
  });

  it('calls a turn with the root and the fifth over it', () => {
    for (const chord of PROGRESSION) {
      const [root, fifth] = turnNotes(chord);
      expect(pc(root)).toBe(chord.tones[0]);
      expect(fifth - root).toBe(7);
    }
  });

  it('keeps a tap on E minor pentatonic, higher for a higher pitch', () => {
    const pentatonic = new Set([4, 7, 9, 11, 2]);
    const pitches = [0.8, 0.9, 0.95, 1, 1.05, 1.1, 1.15, 1.2, 1.3, 1.4];
    const notes = pitches.map(tapNote);
    for (const n of notes) expect(pentatonic.has(pc(n))).toBe(true);
    notes.forEach((n, i) => i > 0 && expect(n).toBeGreaterThanOrEqual(notes[i - 1]!));
    expect(tapNote(1)).toBe(88);
    // On and off are told apart: the scope toggle and the plain buttons tick at 0.95 and 1.15.
    expect(tapNote(1.15)).toBeGreaterThan(tapNote(0.95));
  });
});
