import { describe, expect, it } from 'vitest';
import {
  IDLE,
  MUSIC,
  PROGRESSION,
  bassNote,
  bassRiff,
  chordIndex,
  chordNotes,
  layers,
  streakAccent,
  streakStart,
  streakStep,
  walkNote,
  type MusicSignals,
} from './music';

const run = (over: Partial<MusicSignals> = {}): MusicSignals => ({
  ...IDLE,
  scene: 'run',
  blocks: 1,
  ...over,
});

/** E natural minor, the key of the game's effects: E F# G A B C D. */
const E_MINOR = new Set([4, 6, 7, 9, 11, 0, 2]);
const pc = (midi: number) => ((midi % 12) + 12) % 12;

describe('harmony', () => {
  it('keeps every chord inside E minor, so the effects are always in tune over it', () => {
    for (const chord of PROGRESSION) {
      for (const tone of chord.tones) expect(E_MINOR.has(tone)).toBe(true);
      expect(pc(chord.root)).toBe(chord.tones[0]);
    }
  });

  it('keeps the bass on the root, between E2 and D#3, where a phone can give some of it', () => {
    for (const chord of PROGRESSION) {
      const bass = bassNote(chord);
      expect(pc(bass)).toBe(chord.tones[0]);
      expect(bass).toBeGreaterThanOrEqual(40);
      expect(bass).toBeLessThanOrEqual(51);
    }
  });

  it('moves to the next chord every few blocks, and round again', () => {
    const per = MUSIC.BLOCKS_PER_CHORD;
    expect(chordIndex(1)).toBe(0);
    expect(chordIndex(per)).toBe(0);
    expect(chordIndex(per + 1)).toBe(1);
    expect(chordIndex(per * PROGRESSION.length + 1)).toBe(0);
  });

  it('plays a bassline on the landings: root, octave, fifth, octave, a chord at a time', () => {
    for (let blocks = 2; blocks < 70; blocks++) {
      const chord = PROGRESSION[chordIndex(blocks)]!;
      const bass = bassRiff(chord, blocks);
      expect(chord.tones).toContain(pc(bass));
      expect(bass - bassNote(chord)).toBe([0, 12, 7, 12][(blocks - 1) % 4]);
    }
    // The first landing of each chord is its root.
    expect(bassRiff(PROGRESSION[1]!, 5)).toBe(bassNote(PROGRESSION[1]!));
  });
});

describe('notes', () => {
  /** The notes a perfect streak plays, a landing at a time, the chord moving every few blocks. */
  const streak = (length: number, from = 0): number[] => {
    const chordOf = (i: number) => PROGRESSION[(from + Math.floor(i / 4)) % PROGRESSION.length]!;
    const notes = [streakStart(chordOf(0))];
    let up = true;
    for (let i = 1; i < length; i++) {
      const step = streakStep(chordOf(i), notes[i - 1]!, up);
      notes.push(step.note);
      up = step.up;
    }
    return notes;
  };

  it('climbs the chord with a perfect streak, from the bottom of the range to the top', () => {
    for (let from = 0; from < PROGRESSION.length; from++) {
      const notes = streak(12, from);
      expect(notes[0]).toBe(chordNotes(PROGRESSION[from]!, 64, 88)[0]);
      // It rises a note per perfect until it turns, and it turns at the top of the range.
      const turn = notes.findIndex((n, i) => i > 0 && n < notes[i - 1]!);
      expect(turn).toBeGreaterThan(4);
      expect(notes[turn - 1]!).toBeGreaterThanOrEqual(84);
    }
  });

  it('keeps a long streak moving on the chord: never one note twice, inside the top octave', () => {
    for (let from = 0; from < PROGRESSION.length; from++) {
      const notes = streak(60, from);
      notes.forEach((n, i) => {
        const chord = PROGRESSION[(from + Math.floor(i / 4)) % PROGRESSION.length]!;
        expect(chord.tones).toContain(pc(n));
        expect(n).toBeGreaterThanOrEqual(64);
        expect(n).toBeLessThanOrEqual(88);
        if (i > 0) expect(n).not.toBe(notes[i - 1]);
      });
      // Once it has reached the top it turns, and stays within an octave of it.
      const top = notes.indexOf(Math.max(...notes));
      for (const n of notes.slice(top)) expect(n).toBeGreaterThanOrEqual(76);
      expect(new Set(notes.slice(30)).size).toBeGreaterThan(3);
    }
  });

  it('rings a second note when the streak earns a new name, from the arpeggio on', () => {
    const rung = Array.from({ length: 50 }, (_, i) => i + 1).filter(streakAccent);
    expect(rung).toEqual([4, 6, 9, 13, 18, 24, 31, 39, 48]);
  });

  it('walks a step along the chord on any other landing, so the tower writes a melody', () => {
    for (const chord of PROGRESSION) {
      let note = 64;
      for (let blocks = 2; blocks < 40; blocks++) {
        const next = walkNote(chord, note, blocks);
        expect(chord.tones).toContain(pc(next));
        expect(next).toBeGreaterThanOrEqual(64);
        expect(next).toBeLessThanOrEqual(79);
        note = next;
      }
    }
  });
});

describe('layers', () => {
  it('has nothing over the bed at the start, however tall the tower', () => {
    expect(layers(run())).toMatchObject({ arp: 0 });
    expect(layers(run({ blocks: 80 }))).toMatchObject({ arp: 0 });
  });

  it('opens the bed up as the tower rises', () => {
    expect(layers(run({ blocks: 1 })).brightness).toBeLessThan(0.05);
    expect(layers(run({ blocks: MUSIC.BRIGHT_AT_BLOCKS })).brightness).toBe(1);
  });

  it('plays the arpeggio through a perfect streak, faster as it runs long, and after a milestone', () => {
    const tall = { blocks: 20 };
    expect(layers(run({ ...tall, perfectStreak: MUSIC.ARP_AT_STREAK - 1 })).arp).toBe(0);
    expect(layers(run({ ...tall, perfectStreak: MUSIC.ARP_AT_STREAK })).arp).toBe(2);
    expect(layers(run({ ...tall, perfectStreak: MUSIC.ARP_FAST_AT_STREAK })).arp).toBe(4);
    expect(layers(run({ ...tall, celebrating: true })).arp).toBe(4);
  });

  it('keeps the relay to the bed and its notes until the player is on turn', () => {
    const tower = { mode: 'relay' as const, blocks: 40, perfectStreak: 9 };
    expect(layers(run({ ...tower, celebrating: true }))).toMatchObject({ arp: 0 });
    expect(layers(run({ ...tower, myTurn: true }))).toMatchObject({ arp: 0 });
    expect(layers(run({ ...tower, myTurn: true, celebrating: true }))).toMatchObject({ arp: 4 });
  });

  it('is silent once the tower has fallen', () => {
    expect(layers(run({ scene: 'over', blocks: 40, perfectStreak: 20 }))).toMatchObject({
      arp: 0,
    });
  });
});
