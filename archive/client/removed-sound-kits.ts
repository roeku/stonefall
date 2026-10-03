// Excerpt from src/client/components/audio/kits.ts, cut out on 2026-10-03.
//
// Two of the three sound kits made when the player called the first sound (glassy bells over a
// soft pad) ethereal. The same run was filmed on each and the player chose the third, Dark, which
// is now the game's only kit (components/audio/kit.ts). GRID was clean electro after Daft Punk's
// Tron: a squelching saw bass per landing, a saw pluck over perfects, a muted octave bass on the
// eighths, 120 BPM. ARCADE was an old console: pulse-wave blips, a triangle bass, a noise channel
// (it used the 12.5% pulse wave and the slowed noise that voices.ts dropped with it), 140 BPM, no
// room.
//
// A record, not a module: it references the kit's types, LEVEL and the voices, and does not
// compile alone.

// ------------------------------------------------------------------------------------- grid

const GRID_BASS: Voice = {
  oscs: [
    { wave: 'sawtooth', cents: -6, level: 1.25 },
    { wave: 'sawtooth', cents: 6, level: 1.25 },
    { wave: 'sine', semis: -12, level: 0.45 },
  ],
  filter: { from: 2400, to: 200, time: 0.08, q: 8 },
  attack: 0.003,
  decay: 0.42,
  drive: 1.5,
  room: 0.04,
};

const GRID_LEAD: Voice = {
  oscs: [
    { wave: 'sawtooth', cents: -5, level: 1.25 },
    { wave: 'sawtooth', cents: 5, level: 1 },
    { wave: 'square', semis: -12, level: 0.35 },
  ],
  filter: { from: 5200, to: 1300, time: 0.12, q: 2.5 },
  attack: 0.002,
  decay: 0.38,
  drive: 0.8,
  room: 0.08,
  echo: 0.28,
};

const GRID_PULSE: Voice = {
  oscs: [
    { wave: 'sawtooth', level: 1 },
    { wave: 'square', semis: -12, level: 0.5 },
  ],
  filter: { from: 420, to: 160, time: 0.04, q: 4 },
  attack: 0.003,
  decay: 0.11,
};

const GRID_ARP: Voice = {
  oscs: [
    { wave: 'pulse25', level: 1 },
    { wave: 'sawtooth', cents: 4, level: 0.5 },
  ],
  filter: { from: 3800, to: 1200, time: 0.05, q: 3 },
  attack: 0.002,
  decay: 0.14,
  room: 0.05,
  echo: 0.2,
};

const GRID_STAB: Voice = {
  oscs: [
    { wave: 'sawtooth', cents: -10, level: 1 },
    { wave: 'sawtooth', cents: 10, level: 1 },
    { wave: 'pulse25', semis: 12, level: 0.25 },
  ],
  filter: { from: 4200, to: 600, time: 0.16, q: 3 },
  attack: 0.002,
  decay: 0.7,
  drive: 1.2,
  room: 0.12,
  echo: 0.25,
};

const GRID_TICK: Voice = {
  oscs: [{ wave: 'square', level: 1 }],
  filter: { from: 3200, to: 1800, time: 0.02, q: 1 },
  attack: 0.001,
  decay: 0.035,
};

/** The octave bass under a run, a note per eighth: root, octave, root, octave. */
const octaves = (s: Step): number | null =>
  s.step % 2 === 0 ? s.bass + (s.step % 4 === 2 ? 12 : 0) : null;

export const GRID: Kit = {
  name: 'Grid',
  bpm: 120,
  room: 0.8,
  echo: { beats: 0.5, feedback: 0.22 },
  drop(ctx, out, d) {
    if (d.kind === 'dull') {
      play(ctx, out, d.bass, d.at, LEVEL.BASS * 0.8, GRID_BASS, { tone: 0.25, stretch: 0.6 });
      return;
    }
    const perfect = d.kind === 'perfect';
    play(ctx, out, d.bass, d.at, LEVEL.BASS, GRID_BASS, { tone: perfect ? 1.4 : 1 });
    if (!perfect) return;
    play(ctx, out, d.melody, d.at, LEVEL.LEAD, GRID_LEAD);
    if (d.accent !== null)
      play(ctx, out, d.accent, d.at + 0.07, LEVEL.LEAD * 0.7, GRID_LEAD, {
        tone: 1.4,
        stretch: 0.8,
      });
  },
  step(ctx, out, s) {
    const note = octaves(s);
    if (note !== null) {
      const level = LEVEL.PULSE * (1 + s.height);
      play(ctx, out, note, s.at, level, GRID_PULSE, { tone: 1 + s.height * 2.5 });
    }
    if (s.arp !== null) play(ctx, out, s.arp, s.at, LEVEL.ARP, GRID_ARP);
  },
  lead: GRID_LEAD,
  bass: GRID_BASS,
  tick: GRID_TICK,
  chord(ctx, out, notes, at, level, long) {
    notes.forEach((n, i) =>
      play(ctx, out, n, at, level * LEVEL.CHORD, GRID_STAB, {
        stretch: long ? 2.2 : 1,
        tone: long ? 0.8 : 1,
        pan: (i - (notes.length - 1) / 2) * 0.25,
      })
    );
  },
  hit(ctx, out, root, at, level) {
    knock(ctx, out, at, level * 0.6, { cutoff: 1400, decay: 0.08, room: 0.15 });
    play(ctx, out, root, at, level * LEVEL.HIT, {
      ...GRID_BASS,
      bend: { semis: 12, time: 0.1 },
      filter: { from: 1600, to: 120, time: 0.15, q: 4 },
      drive: 3,
      decay: 0.7,
    });
  },
};

// ----------------------------------------------------------------------------------- arcade

const ARCADE_BLIP: Voice = {
  oscs: [{ wave: 'pulse25', level: 2.8 }],
  bend: { semis: 12, time: 0.025 },
  attack: 0.001,
  decay: 0.12,
};

const ARCADE_PERFECT: Voice = {
  oscs: [
    { wave: 'pulse12', level: 2.8 },
    { wave: 'pulse25', semis: -12, level: 0.8 },
  ],
  bend: { semis: 7, time: 0.02 },
  attack: 0.001,
  decay: 0.2,
};

const ARCADE_BONK: Voice = {
  oscs: [{ wave: 'triangle', level: 2.5 }],
  bend: { semis: 5, time: 0.05 },
  attack: 0.001,
  decay: 0.18,
};

const ARCADE_BASS: Voice = {
  oscs: [{ wave: 'triangle', level: 2.5 }],
  attack: 0.002,
  decay: 0.13,
};

const ARCADE_ARP: Voice = { oscs: [{ wave: 'pulse12', level: 2.8 }], attack: 0.001, decay: 0.06 };

const ARCADE_LEAD: Voice = {
  oscs: [{ wave: 'pulse25', level: 2.8 }],
  attack: 0.001,
  decay: 0.16,
};

const ARCADE_TICK: Voice = { oscs: [{ wave: 'square', level: 1.2 }], attack: 0.001, decay: 0.02 };

export const ARCADE: Kit = {
  name: 'Arcade',
  bpm: 140,
  room: 0,
  echo: { beats: 0.75, feedback: 0.15 },
  drop(ctx, out, d) {
    if (d.kind === 'dull') {
      play(ctx, out, d.bass + 12, d.at, LEVEL.LEAD * 1.3, ARCADE_BONK);
      return;
    }
    if (d.kind === 'land') {
      play(ctx, out, d.melody, d.at, LEVEL.LEAD * 1.3, ARCADE_BLIP);
      return;
    }
    play(ctx, out, d.melody, d.at, LEVEL.LEAD * 1.3, ARCADE_PERFECT);
    if (d.accent !== null)
      play(ctx, out, d.accent + 12, d.at + 0.045, LEVEL.LEAD * 0.65, ARCADE_PERFECT, {
        stretch: 1.5,
      });
  },
  step(ctx, out, s) {
    // A triangle bass a note per eighth: root, octave, fifth, octave.
    if (s.step % 2 === 0) {
      const lift = [0, 12, 7, 12][(s.step / 2) % 4] ?? 0;
      play(ctx, out, s.bass + lift, s.at, LEVEL.PULSE * 1.5, ARCADE_BASS);
    }
    if (s.arp !== null) play(ctx, out, s.arp + 12, s.at, LEVEL.ARP * 0.8, ARCADE_ARP);
  },
  lead: ARCADE_LEAD,
  bass: { ...ARCADE_BASS, decay: 0.6 },
  tick: ARCADE_TICK,
  chord(ctx, out, notes, at, level, long) {
    // An old console has no chords: it runs through the notes fast enough to be heard as one.
    const length = long ? 0.7 : 0.3;
    const cycle = [...notes].sort((a, b) => a - b);
    for (let i = 0; i * 0.035 < length; i++) {
      const note = cycle[i % cycle.length]!;
      const fade = 1 - (i * 0.035) / length;
      play(ctx, out, note, at + i * 0.035, level * LEVEL.CHORD * 0.4 * fade, ARCADE_LEAD, {
        stretch: 0.25,
      });
    }
  },
  hit(ctx, out, root, at, level) {
    knock(ctx, out, at, level * 0.35, { cutoff: 5000, decay: 0.3, room: 0, rate: 0.25 });
    play(ctx, out, root + 12, at, level * LEVEL.LEAD * 0.6, {
      ...ARCADE_BONK,
      bend: { semis: 12, time: 0.3 },
      decay: 0.4,
    });
  },
};

