import { knock, play, type Out, type Voice } from './voices';

/**
 * The game's sound: what a landing, the background and the effects are played on.
 *
 * music.ts decides what happens and on which notes (a landing's bass and melody, a streak's
 * climb, the chord under it all); the kit decides what that sounds like. Dark synth, on the
 * Cyberpunk side: every landing is a driven, squelching saw bass note with a metal clank on its
 * front, a perfect adds a gritty pluck over it, and a muted octave bass ticks under the run.
 *
 * The first sound was glassy bells over a soft pad in a big room, and the player called it
 * ethereal: a no go. Three kits were filmed on the same run, clean electro, this one and an old
 * console, and the player chose this one. The other two are in
 * archive/client/removed-sound-kits.ts.
 */

export interface Drop {
  readonly at: number;
  /** The bass note this landing plays (music.ts bassRiff). */
  readonly bass: number;
  /** The melody's note: a perfect streak's, or a step of the walk. */
  readonly melody: number;
  /** A landing, a perfect, or a second miss in a row. */
  readonly kind: 'land' | 'perfect' | 'dull';
  /** A new streak name: the note it rings over the melody. */
  readonly accent: number | null;
}

export interface Step {
  readonly at: number;
  /** The sixteenth of the bar, 0 to 15. */
  readonly step: number;
  /** The chord's bass note. */
  readonly bass: number;
  /** The arpeggio's note on this sixteenth, if it plays. */
  readonly arp: number | null;
  /** 0 to 1: how tall the tower is. */
  readonly height: number;
}

export interface Kit {
  readonly bpm: number;
  /** The room's length in seconds (0: none), and the echo's delay in beats and its feedback. */
  readonly room: number;
  readonly echo: { readonly beats: number; readonly feedback: number };
  /** A block landing. */
  drop(ctx: BaseAudioContext, out: Out, d: Drop): void;
  /** Each sixteenth of a run: the background, and the arpeggio when it plays. */
  step(ctx: BaseAudioContext, out: Out, s: Step): void;
  /** A short note, for the effects: a turn, a heal, a raise's answer, a fall, a milestone's run. */
  readonly lead: Voice;
  /** A low note: the root a run ends on. */
  readonly bass: Voice;
  /** A tap on a control. */
  readonly tick: Voice;
  /** A chord at once: a milestone's, a run's end. Long rings it out. */
  chord(
    ctx: BaseAudioContext,
    out: Out,
    notes: number[],
    at: number,
    level: number,
    long: boolean
  ): void;
  /** A heavy hit on a root: a run's end, a block going over the edge. */
  hit(ctx: BaseAudioContext, out: Out, root: number, at: number, level: number): void;
}

/** The levels the kit plays at: peak gains, before the music's or the effects' volume. */
const LEVEL = {
  BASS: 0.34,
  LEAD: 0.2,
  PULSE: 0.035,
  ARP: 0.05,
  CHORD: 0.12,
  HIT: 0.42,
} as const;

const BASS: Voice = {
  oscs: [
    { wave: 'sawtooth', cents: -9, level: 0.8 },
    { wave: 'sawtooth', cents: 9, level: 0.8 },
    { wave: 'square', semis: -12, level: 0.35 },
  ],
  filter: { from: 1700, to: 140, time: 0.07, q: 6 },
  attack: 0.003,
  decay: 0.45,
  drive: 5,
  room: 0.04,
};

/** The clank on the front of a landing: an inharmonic sine, gone in a few milliseconds. */
const CLANK: Voice = {
  oscs: [
    { wave: 'sine', semis: 21.7, level: 1 },
    { wave: 'square', semis: 31, level: 0.3 },
  ],
  bend: { semis: 5, time: 0.03 },
  attack: 0.001,
  decay: 0.05,
  room: 0.1,
};

const LEAD: Voice = {
  oscs: [
    { wave: 'square', cents: -6, level: 1 },
    { wave: 'sawtooth', cents: 6, level: 0.7 },
  ],
  filter: { from: 3500, to: 900, time: 0.1, q: 4 },
  attack: 0.002,
  decay: 0.35,
  drive: 3,
  room: 0.08,
  echo: 0.22,
};

/** The muted bass under a run. */
const PULSE: Voice = {
  oscs: [
    { wave: 'sawtooth', level: 1 },
    { wave: 'square', semis: -12, level: 0.5 },
  ],
  filter: { from: 320, to: 120, time: 0.04, q: 5 },
  attack: 0.003,
  decay: 0.11,
  drive: 2,
};

const ARP: Voice = {
  oscs: [
    { wave: 'pulse25', level: 1 },
    { wave: 'sawtooth', cents: 4, level: 0.5 },
  ],
  filter: { from: 2600, to: 800, time: 0.05, q: 4 },
  attack: 0.002,
  decay: 0.14,
  drive: 2,
  room: 0.05,
  echo: 0.2,
};

/** One note of a chord stab. */
const STAB: Voice = {
  oscs: [
    { wave: 'sawtooth', cents: -10, level: 1 },
    { wave: 'sawtooth', cents: 10, level: 1 },
    { wave: 'pulse25', semis: 12, level: 0.25 },
  ],
  filter: { from: 3000, to: 450, time: 0.14, q: 4 },
  attack: 0.002,
  decay: 0.7,
  drive: 3,
  room: 0.12,
  echo: 0.25,
};

const TICK: Voice = {
  oscs: [{ wave: 'square', level: 1 }],
  filter: { from: 3200, to: 1800, time: 0.02, q: 1 },
  attack: 0.001,
  decay: 0.035,
};

/** The octave bass under a run, a note per eighth: root, octave, root, octave. */
const octaves = (s: Step): number | null =>
  s.step % 2 === 0 ? s.bass + (s.step % 4 === 2 ? 12 : 0) : null;

export const KIT: Kit = {
  bpm: 110,
  room: 0.8,
  echo: { beats: 0.5, feedback: 0.2 },
  drop(ctx, out, d) {
    if (d.kind === 'dull') {
      play(ctx, out, d.bass, d.at, LEVEL.BASS * 0.8, BASS, { tone: 0.3, stretch: 0.6 });
      return;
    }
    const perfect = d.kind === 'perfect';
    play(ctx, out, d.bass, d.at, LEVEL.BASS, BASS, { tone: perfect ? 1.4 : 1 });
    play(ctx, out, d.bass + 12, d.at, LEVEL.BASS * 0.35, CLANK);
    if (!perfect) return;
    play(ctx, out, d.melody, d.at, LEVEL.LEAD, LEAD);
    if (d.accent !== null)
      play(ctx, out, d.accent, d.at + 0.07, LEVEL.LEAD * 0.7, LEAD, { tone: 1.4, stretch: 0.8 });
  },
  step(ctx, out, s) {
    const note = octaves(s);
    if (note !== null) {
      const level = LEVEL.PULSE * (1 + s.height);
      play(ctx, out, note, s.at, level, PULSE, { tone: 1 + s.height * 2.5 });
    }
    if (s.arp !== null) play(ctx, out, s.arp, s.at, LEVEL.ARP, ARP);
  },
  lead: LEAD,
  bass: BASS,
  tick: TICK,
  chord(ctx, out, notes, at, level, long) {
    notes.forEach((n, i) =>
      play(ctx, out, n, at, level * LEVEL.CHORD, STAB, {
        stretch: long ? 2.2 : 1,
        tone: long ? 0.8 : 1,
        pan: (i - (notes.length - 1) / 2) * 0.25,
      })
    );
  },
  hit(ctx, out, root, at, level) {
    knock(ctx, out, at, level * 0.7, { cutoff: 2200, decay: 0.09, room: 0.15 });
    play(ctx, out, root + 12, at, level * LEVEL.BASS, CLANK);
    play(ctx, out, root, at, level * LEVEL.HIT, {
      ...BASS,
      bend: { semis: 12, time: 0.1 },
      filter: { from: 1200, to: 100, time: 0.15, q: 4 },
      drive: 6,
      decay: 0.8,
    });
  },
};
