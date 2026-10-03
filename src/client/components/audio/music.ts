import { STREAK_TIERS } from '../../constants/streakTiers';
import { AudioPlayer } from './AudioPlayer';
import { KIT, type Kit } from './kit';
import type { Out } from './voices';

/**
 * The music of a run, played by the run.
 *
 * Arcade stackers that hold up over thousands of runs (Stack, Tetris Effect, Mini Metro) do not
 * play a song over the action: the action is the music, and what plays under it stays out of the
 * way. So there is no track here. Every block that lands plays notes of the chord the tower is
 * on, and a light background keeps time under the run. What all of it sounds like is the kit's
 * (kit.ts); the effects play on the same kit and the same chord (effectNotes.ts), so the game
 * sounds like one thing.
 *
 * - A run starts: the background comes in on the first chord.
 * - A block lands: its notes, at once. They are the landing's sound: the old landing effects are
 *   off (LANDING_EFFECTS). The kit gets two: a note of the chord's bassline (bassRiff, four to a
 *   chord) and a melody note. A perfect streak's melody climbs the chord, the way Stack's chime
 *   climbs, then walks the top of it up and down for as long as the streak lasts, and each new
 *   streak name the HUD says rings a second note; any other landing steps from the last note, so
 *   the tower writes a melody; a second miss in a row is dull.
 * - Every BLOCKS_PER_CHORD blocks the chord moves on, and the background opens up as the tower
 *   rises.
 * - A perfect streak, or a new best: an arpeggio, in eighths, then sixteenths once the streak runs
 *   long.
 * - Game over: the music stops. The effects end it, on its chord: the result of a run
 *   (AudioPlayer.playResult), or a relay player's last fall (playElimination). The board is quiet.
 * - Relay: every landing on the tower plays its notes; the arpeggio waits for the player's turn.
 *
 * Nothing in it thumps on the beat: a sub pulse and a heartbeat for a small block were taken out,
 * because the player did not like the kick they made. The background and the arpeggio are
 * scheduled a little ahead on the audio clock by a short timer. Nothing here is needed to play:
 * the game reads the same with the sound off.
 */

/**
 * Whether a landing also plays the old effects (AudioPlayer's thud, perfect stinger and miss
 * sounds). Off: the notes each landing plays here are its sound, and the two together doubled it.
 */
export const LANDING_EFFECTS = false;

export const MUSIC = {
  /** Blocks per chord: the tower climbs through the progression. */
  BLOCKS_PER_CHORD: 4,
  /** Perfect drops in a row that bring the arpeggio, in eighths, and that double it. */
  ARP_AT_STREAK: 4,
  ARP_FAST_AT_STREAK: 13,
  /** Bars the arpeggio plays after a new best or a rival passed. */
  CELEBRATE_BARS: 4,
  /** Blocks at which the background is as open as it gets. */
  BRIGHT_AT_BLOCKS: 60,
  /** A fall in the relay ducks the music to this, for this long. */
  DUCK: 0.5,
  DUCK_SECONDS: 0.8,
  /** The whole music's volume, under the effects. */
  VOLUME: 0.9,
} as const;

export interface MusicSignals {
  /** run: a tower is going up; over: it fell; idle: no music. */
  readonly scene: 'run' | 'over' | 'idle';
  /** relay: the block belongs to whoever's turn it is. */
  readonly mode: 'solo' | 'relay';
  /** Blocks standing, the base included. */
  readonly blocks: number;
  readonly perfectStreak: number;
  readonly missStreak: number;
  /** Relay: the block is the player's to drop. */
  readonly myTurn: boolean;
  /** A new best or a rival passed, within the last CELEBRATE_BARS. */
  readonly celebrating: boolean;
}

export const IDLE: MusicSignals = {
  scene: 'idle',
  mode: 'solo',
  blocks: 0,
  perfectStreak: 0,
  missStreak: 0,
  myTurn: false,
  celebrating: false,
};

// ------------------------------------------------------------------------------------ harmony

export interface Chord {
  readonly name: string;
  /** The bass note (MIDI). */
  readonly root: number;
  /** Its pitch classes (0 = C), the root first. */
  readonly tones: ReadonlyArray<number>;
}

/**
 * Eight chords, all inside E minor so every effect stays in tune over them: Em, C, G, D, Am, C,
 * Bm, D, and round again; thirty-two blocks before it repeats. Plain triads: the first sound's
 * ninths and added sixths were half of what made it ethereal.
 */
export const PROGRESSION: ReadonlyArray<Chord> = [
  { name: 'Em', root: 40, tones: [4, 7, 11] },
  { name: 'C', root: 36, tones: [0, 4, 7] },
  { name: 'G', root: 43, tones: [7, 11, 2] },
  { name: 'D', root: 38, tones: [2, 6, 9] },
  { name: 'Am', root: 45, tones: [9, 0, 4] },
  { name: 'C', root: 36, tones: [0, 4, 7] },
  { name: 'Bm', root: 35, tones: [11, 2, 6] },
  { name: 'D', root: 38, tones: [2, 6, 9] },
];

/** The chord the tower is on at this height. */
export function chordIndex(blocks: number): number {
  const step = Math.floor(Math.max(0, blocks - 1) / MUSIC.BLOCKS_PER_CHORD);
  return step % PROGRESSION.length;
}

const chordAt = (index: number): Chord =>
  PROGRESSION[index % PROGRESSION.length] ?? PROGRESSION[0]!;

/** Every MIDI note of the chord between low and high, ascending. */
export function chordNotes(chord: Chord, low: number, high: number): number[] {
  const notes: number[] = [];
  for (let m = low; m <= high; m++) if (chord.tones.includes(((m % 12) + 12) % 12)) notes.push(m);
  return notes;
}

/** The range the melody moves in. */
const NOTE_RANGE = [64, 88] as const;

/** The bass's range: E2 to D#3, high enough for a phone to give some of it. */
const BASS_RANGE = [40, 51] as const;

/** The bass note for a chord: its root in the bass's range. */
export function bassNote(chord: Chord): number {
  let root = chord.root;
  while (root < BASS_RANGE[0]) root += 12;
  while (root > BASS_RANGE[1]) root -= 12;
  return root;
}

/** The bassline the landings play, four notes to a chord: root, octave, fifth, octave. */
const RIFF = [0, 12, 7, 12] as const;

/** A landing's bass note: its place among the four blocks its chord lasts. */
export function bassRiff(chord: Chord, blocks: number): number {
  const at = Math.max(0, blocks - 1) % MUSIC.BLOCKS_PER_CHORD;
  return bassNote(chord) + (RIFF[at] ?? 0);
}

/** How far down from the top a long streak walks before it climbs again: an octave. */
const SUMMIT_FLOOR = NOTE_RANGE[1] - 12;

/** A perfect streak's first note: the lowest of the chord in range. */
export const streakStart = (chord: Chord): number =>
  chordNotes(chord, NOTE_RANGE[0], NOTE_RANGE[1])[0] ?? NOTE_RANGE[0];

/**
 * A perfect streak's next note, from the last one: a note of the chord up, the way Stack's chime
 * climbs. At the top it turns and walks down the top octave, then climbs again, so a long streak
 * keeps singing instead of ringing its top note forty times. From the last note rather than from
 * the count, so a chord change under the streak moves the line to the nearest note, not a jump.
 */
export function streakStep(
  chord: Chord,
  previous: number,
  up: boolean
): { note: number; up: boolean } {
  const notes = chordNotes(chord, NOTE_RANGE[0], NOTE_RANGE[1]);
  const above = notes.find((n) => n > previous);
  const below = [...notes].reverse().find((n) => n < previous);
  if (up && above !== undefined) return { note: above, up: true };
  if (!up && below !== undefined && below >= SUMMIT_FLOOR) return { note: below, up: false };
  if (up) return { note: below ?? previous, up: false };
  return { note: above ?? previous, up: true };
}

/**
 * Whether a perfect streak this long has just earned a new name in the HUD (constants/
 * streakTiers.ts), from the one that brings the arpeggio: its landing rings a second note.
 */
export const streakAccent = (streak: number): boolean =>
  streak >= MUSIC.ARP_AT_STREAK && STREAK_TIERS.some((tier) => tier.streak === streak);

/**
 * Any other landing's note: a step along the chord from the last note, up or down by the block's
 * own number, kept in the lower part of the range so a streak has somewhere to climb.
 */
export function walkNote(chord: Chord, previous: number, blocks: number): number {
  const notes = chordNotes(chord, NOTE_RANGE[0], NOTE_RANGE[0] + 15);
  if (notes.length === 0) return NOTE_RANGE[0];
  const steps = [1, -1, 2, 1, -2, 1, -1, 2] as const;
  const step = steps[(blocks * 7) % steps.length] ?? 1;
  let at = 0;
  for (let i = 0; i < notes.length; i++) {
    if (Math.abs((notes[i] ?? 0) - previous) < Math.abs((notes[at] ?? 0) - previous)) at = i;
  }
  const next = Math.min(notes.length - 1, Math.max(0, at + step));
  return notes[next] ?? notes[0]!;
}

// ------------------------------------------------------------------------------------- layers

export interface Layers {
  /** 0 to 1: how far the background has opened up. */
  readonly brightness: number;
  /** The arpeggio's notes per beat: 0 when it is not playing, 2 in eighths, 4 in sixteenths. */
  readonly arp: 0 | 2 | 4;
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** What plays over the background, for what the run is doing. */
export function layers(s: MusicSignals): Layers {
  if (s.scene !== 'run') return { brightness: 0, arp: 0 };
  const waiting = s.mode === 'relay' && !s.myTurn;
  const streak = s.mode === 'solo' ? s.perfectStreak : 0;
  const arp =
    waiting || (streak < MUSIC.ARP_AT_STREAK && !s.celebrating)
      ? 0
      : streak >= MUSIC.ARP_FAST_AT_STREAK || s.celebrating
        ? 4
        : 2;
  return { brightness: clamp01(s.blocks / MUSIC.BRIGHT_AT_BLOCKS), arp };
}

/** The arpeggio's shape over the chord's notes, a note per step. */
const ARP_PATTERN = [0, 1, 2, 3, 2, 1, 2, 4] as const;

// ------------------------------------------------------------------------------------ the engine

/** The room and the echo the music and the effects share (AudioPlayer.space): their inputs. */
export interface Space {
  readonly room: AudioNode;
  readonly echo: AudioNode;
}

/**
 * The music on one audio context. MusicManager runs one on the game's context.
 */
export class GridMusic {
  private readonly out: GainNode;
  private readonly duckGain: GainNode;
  private readonly delayIn: GainNode;
  private readonly roomIn: GainNode;
  /** Where the notes go: ducked, and into the shared room and echo. */
  private readonly voices: Out;
  private signals: MusicSignals = IDLE;
  private chord = 0;
  private lastNote: number = NOTE_RANGE[0];
  /** Which way a perfect streak's line is going (streakStep). */
  private streakUp = true;
  /** Context time of the grid's first beat, or null while nothing plays. */
  private origin: number | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** The next sixteenth the scheduler has not yet looked at. */
  private nextStep = 0;
  private celebrateUntil = -Infinity;
  private over = false;

  constructor(
    private readonly ctx: BaseAudioContext,
    destination: AudioNode,
    space: Space,
    private readonly kit: Kit = KIT
  ) {
    this.out = ctx.createGain();
    this.out.gain.value = MUSIC.VOLUME;
    this.out.connect(destination);
    this.duckGain = ctx.createGain();
    this.duckGain.connect(this.out);
    // The room and the echo are the effects' too: the music sends into them at its own volume.
    this.roomIn = ctx.createGain();
    this.roomIn.gain.value = MUSIC.VOLUME;
    this.roomIn.connect(space.room);
    this.delayIn = ctx.createGain();
    this.delayIn.gain.value = MUSIC.VOLUME;
    this.delayIn.connect(space.echo);
    this.voices = { dry: this.duckGain, room: this.roomIn, echo: this.delayIn };
  }

  private get sixteenth(): number {
    return 60 / this.kit.bpm / 4;
  }

  private now(): number {
    return this.ctx.currentTime;
  }

  get playing(): boolean {
    return this.origin !== null && !this.over;
  }

  /** The chord the music is on, or the one it stopped on. */
  get harmony(): Chord {
    return chordAt(this.chord);
  }

  setVolume(volume: number): void {
    for (const g of [this.out, this.roomIn, this.delayIn])
      g.gain.setTargetAtTime(volume, this.now(), 0.05);
  }

  /** A run starts: the background comes in on the first chord. */
  startRun(): void {
    this.over = false;
    this.signals = { ...this.signals, scene: 'run', blocks: 1, perfectStreak: 0, missStreak: 0 };
    this.chord = 0;
    this.lastNote = NOTE_RANGE[0];
    this.origin = this.now() + 0.05;
    this.nextStep = 0;
    this.startTimer();
  }

  /** What the run is doing now: a landing plays its notes, the tower's height picks the chord. */
  update(signals: MusicSignals): void {
    const before = this.signals;
    this.signals = signals;
    if (signals.scene !== 'run' || !this.playing) return;
    this.chord = chordIndex(signals.blocks);
    if (signals.blocks > before.blocks && signals.blocks > 1)
      this.landed(before, signals, this.now());
  }

  /** A new best or a rival passed: the arpeggio for a few bars. */
  lift(): void {
    if (!this.playing) return;
    this.celebrateUntil = this.now() + MUSIC.CELEBRATE_BARS * 16 * this.sixteenth;
  }

  /** Steps the music back for a moment, under something that should stand alone. */
  duck(): void {
    const now = this.now();
    const g = this.duckGain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(MUSIC.DUCK, now + 0.03);
    g.linearRampToValueAtTime(1, now + MUSIC.DUCK_SECONDS);
  }

  /**
   * The tower fell: the music stops, and keeps its chord for the effect that ends it (the run's
   * result, a relay player's last fall) to play.
   */
  gameOver(): void {
    if (!this.playing) return;
    this.over = true;
    this.stopTimer();
    this.origin = null;
  }

  /** Back to the board: the background stops. */
  leave(): void {
    this.signals = IDLE;
    this.stopTimer();
    this.origin = null;
    this.over = false;
  }

  // ------------------------------------------------------------------------------------ notes

  /** A block landed: its notes, at once, since they are the landing's sound. */
  private landed(before: MusicSignals, now: MusicSignals, t: number): void {
    const chord = chordAt(this.chord);
    const at = t + 0.005;
    const bass = bassRiff(chord, now.blocks);
    const perfect = now.mode === 'solo' && now.perfectStreak > before.perfectStreak;
    if (perfect) {
      // A streak's first perfect starts the climb at the bottom; the rest step on from the last.
      let note = streakStart(chord);
      if (now.perfectStreak === 1) {
        this.streakUp = true;
      } else {
        const step = streakStep(chord, this.lastNote, this.streakUp);
        note = step.note;
        this.streakUp = step.up;
      }
      this.lastNote = note;
      // A new streak name: the next note of the chord over the melody.
      const accent = streakAccent(now.perfectStreak)
        ? (chordNotes(chord, note + 1, note + 12)[0] ?? null)
        : null;
      this.kit.drop(this.ctx, this.voices, { at, bass, melody: note, kind: 'perfect', accent });
    } else if (now.mode === 'solo' && now.missStreak >= 2) {
      // Losing it: the chord's root, dull.
      const root = bassNote(chord);
      this.kit.drop(this.ctx, this.voices, {
        at,
        bass: root,
        melody: root + 12,
        kind: 'dull',
        accent: null,
      });
    } else {
      const note = walkNote(chord, this.lastNote, now.blocks);
      this.lastNote = note;
      this.kit.drop(this.ctx, this.voices, { at, bass, melody: note, kind: 'land', accent: null });
    }
  }

  // ------------------------------------------------------------------------------- scheduling

  private startTimer(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => this.schedule(), 25);
    this.schedule();
  }

  private stopTimer(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  /** Hands the kit each sixteenth a little ahead of the clock: the background, and the arpeggio. */
  private schedule(): void {
    if (this.origin === null || this.over) return;
    const horizon = this.now() + 0.12;
    const l = layers({ ...this.signals, celebrating: this.now() < this.celebrateUntil });
    const chord = chordAt(this.chord);
    const notes = chordNotes(chord, 76, 91);
    for (;;) {
      const t = this.origin + this.nextStep * this.sixteenth;
      if (t > horizon) break;
      const step = this.nextStep++;
      if (t < this.now()) continue;
      const inBar = step % 16;
      // The arpeggio: its pattern a note per eighth or per sixteenth, whichever it is playing in.
      const every = l.arp > 0 ? 4 / l.arp : 0;
      let arp: number | null = null;
      if (every > 0 && inBar % every === 0) {
        const index = ARP_PATTERN[(inBar / every) % ARP_PATTERN.length] ?? 0;
        arp = notes[index % Math.max(1, notes.length)] ?? null;
      }
      this.kit.step(this.ctx, this.voices, {
        at: t,
        step: inBar,
        bass: bassNote(chord),
        arp,
        height: l.brightness,
      });
    }
  }
}

/**
 * The game's music: one GridMusic on the effects' audio context, through their limiter, never
 * before the player has touched the game.
 */
export class MusicManager {
  private static music: GridMusic | null = null;
  private static volume: number = MUSIC.VOLUME;
  private static relay = { myTurn: false, out: false };
  private static last: MusicSignals = IDLE;
  private static ready: Promise<void> | null = null;

  private static get(): GridMusic {
    if (!this.music) {
      const ctx = AudioPlayer.context();
      this.music = new GridMusic(ctx, AudioPlayer.musicInput(), AudioPlayer.space());
      this.music.setVolume(this.volume);
    }
    return this.music;
  }

  /**
   * The chord an effect takes its notes from: the one the music is on, or stopped on, which on
   * the board is the chord the last run ended on. Em before any music has played.
   */
  static chord(): Chord {
    return this.music?.harmony ?? PROGRESSION[0]!;
  }

  /**
   * Resolves once the player has touched the game and the context is running. Never before the
   * first interaction, even where the browser would allow autoplay: the relay post mounts the game
   * scene as soon as it loads, inline in the feed.
   */
  private static whenRunning(): Promise<void> {
    if (!this.ready) {
      this.ready = AudioPlayer.whenHeard().then(
        () =>
          new Promise<void>((resolve) => {
            const ctx = AudioPlayer.context();
            const check = () => {
              if (ctx.state !== 'running') return;
              ctx.removeEventListener('statechange', check);
              resolve();
            };
            ctx.addEventListener('statechange', check);
            check();
          })
      );
    }
    return this.ready;
  }

  /** What the run is doing; the relay's own state is folded in. */
  static update(signals: MusicSignals): void {
    const next: MusicSignals =
      signals.mode === 'relay'
        ? {
            ...signals,
            myTurn: this.relay.myTurn,
            scene: this.relay.out && signals.scene === 'run' ? 'over' : signals.scene,
          }
        : signals;
    this.last = next;
    this.music?.update(next);
  }

  static startRun(): void {
    if (this.relay.out) return;
    void this.whenRunning().then(() => {
      const music = this.get();
      music.startRun();
      music.update(this.last);
    });
  }

  /** Starts the music if it is not playing: the relay, which has no start of its own. */
  static ensure(): void {
    if (this.music?.playing) return;
    this.startRun();
  }

  /** Relay: whose turn it is, and whether the player is out for the day. */
  static setRelay(myTurn: boolean, out: boolean): void {
    if (this.relay.myTurn === myTurn && this.relay.out === out) return;
    this.relay = { myTurn, out };
    if (this.last.mode === 'relay') this.update(this.last);
  }

  static lift(): void {
    this.music?.lift();
  }

  static duck(): void {
    this.music?.duck();
  }

  static gameOver(): void {
    this.music?.gameOver();
  }

  static leave(): void {
    this.music?.leave();
  }

  static setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    this.music?.setVolume(this.volume);
  }
}
