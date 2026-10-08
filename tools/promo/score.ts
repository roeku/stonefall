/**
 * The game's own music for a video, rendered offline.
 *
 * The game plays its music from the run: every landing hands the kit a bass note and a melody
 * note, a perfect streak climbs the chord, a new streak name rings an extra note (music.ts). This
 * page runs that same code, GridMusic and AudioPlayer's effects, on an OfflineAudioContext driven
 * by a list of timed events instead of a run, so a video's soundtrack is the game playing the
 * video's own drops, to the sample. `window.renderScore(spec)` returns a 16-bit WAV as base64.
 *
 * GridMusic schedules its sixteenths from a 25 ms interval; offline there is no wall clock, so
 * the context is suspended every 25 ms of audio and the scheduler is run there instead.
 */
import { AudioPlayer } from '../../src/client/components/audio/AudioPlayer';
import {
  GridMusic,
  MusicManager,
  chordIndex,
  type MusicSignals,
} from '../../src/client/components/audio/music';

export type ScoreEvent =
  /** The background comes in, on the chord of a tower this tall. */
  | { t: number; kind: 'start'; blocks: number }
  /** A block lands: the run's signals after it. */
  | { t: number; kind: 'land'; blocks: number; perfectStreak: number; missStreak: number }
  /** The run's state changes without a landing (a cut to later in the run). */
  | { t: number; kind: 'signals'; blocks: number; perfectStreak: number; missStreak: number }
  | { t: number; kind: 'raise'; raise: 'keep' | 'claim' | 'take' }
  | { t: number; kind: 'duck' }
  | { t: number; kind: 'lift' }
  /** The music's own volume (GridMusic.setVolume, 0.9 in the game): the bus under the effects. */
  | { t: number; kind: 'volume'; volume: number }
  /** A tap on a control (AudioPlayer.playTap): a tick on E minor's pentatonic. */
  | { t: number; kind: 'tap'; pitch: number }
  /** The music stops and the run's chord rings: the end of a run. */
  | { t: number; kind: 'result'; best: boolean }
  | { t: number; kind: 'stop' };

export interface ScoreSpec {
  seconds: number;
  events: ScoreEvent[];
  sampleRate?: number;
}

const wav = (buffer: AudioBuffer): string => {
  const channels = buffer.numberOfChannels;
  const frames = buffer.length;
  const bytes = new DataView(new ArrayBuffer(44 + frames * channels * 2));
  const text = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) bytes.setUint8(offset + i, s.charCodeAt(i));
  };
  text(0, 'RIFF');
  bytes.setUint32(4, 36 + frames * channels * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  bytes.setUint32(16, 16, true);
  bytes.setUint16(20, 1, true);
  bytes.setUint16(22, channels, true);
  bytes.setUint32(24, buffer.sampleRate, true);
  bytes.setUint32(28, buffer.sampleRate * channels * 2, true);
  bytes.setUint16(32, channels * 2, true);
  bytes.setUint16(34, 16, true);
  text(36, 'data');
  bytes.setUint32(40, frames * channels * 2, true);
  const data = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
  let o = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const v = Math.max(-1, Math.min(1, data[c]![i]!));
      bytes.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      o += 2;
    }
  }
  let binary = '';
  const u8 = new Uint8Array(bytes.buffer);
  for (let i = 0; i < u8.length; i += 0x8000)
    binary += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(binary);
};

const renderScore = async ({ seconds, events, sampleRate = 48000 }: ScoreSpec): Promise<string> => {
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
  // AudioPlayer keeps its context and its unlock state in private statics; this page is its own
  // player, so it hands it the offline context and counts as heard and on screen.
  const player = AudioPlayer as unknown as Record<string, unknown>;
  player.ctx = ctx;
  player.heard = true;
  player.hidden = false;
  const music = new GridMusic(ctx, AudioPlayer.musicInput(), AudioPlayer.space());
  const inner = music as unknown as Record<string, unknown> & { schedule(): void };
  inner.startTimer = () => {};
  inner.stopTimer = () => {};
  // The effects take their notes from the chord the music is on.
  (MusicManager as unknown as Record<string, unknown>).music = music;

  const signals = (blocks: number, perfectStreak: number, missStreak: number): MusicSignals => ({
    scene: 'run',
    mode: 'solo',
    blocks,
    perfectStreak,
    missStreak,
    myTurn: false,
    celebrating: false,
  });
  const apply = (e: ScoreEvent) => {
    switch (e.kind) {
      case 'start':
        music.startRun();
        inner.signals = signals(e.blocks, 0, 0);
        inner.chord = chordIndex(e.blocks);
        break;
      case 'land':
        music.update(signals(e.blocks, e.perfectStreak, e.missStreak));
        break;
      case 'signals':
        inner.signals = signals(e.blocks, e.perfectStreak, e.missStreak);
        inner.chord = chordIndex(e.blocks);
        break;
      case 'raise':
        AudioPlayer.playRaise(e.raise);
        break;
      case 'duck':
        music.duck();
        break;
      case 'lift':
        music.lift();
        break;
      case 'volume':
        music.setVolume(e.volume);
        break;
      case 'tap':
        AudioPlayer.playTap(e.pitch);
        break;
      case 'result':
        music.gameOver();
        AudioPlayer.playResult(e.best);
        break;
      case 'stop':
        music.gameOver();
        break;
    }
  };

  // Suspend points land on render-quantum boundaries, and only one may sit on each: events and
  // scheduler ticks are grouped by the quantum they fall in, events first.
  const quantum = 128 / sampleRate;
  const slots = new Map<number, { events: ScoreEvent[]; tick: boolean }>();
  const slot = (t: number) => {
    const k = Math.round(Math.floor(t / quantum + 1e-9) * quantum * 1e6) / 1e6;
    let s = slots.get(k);
    if (!s) slots.set(k, (s = { events: [], tick: false }));
    return s;
  };
  for (let t = 0; t < seconds - quantum; t += 0.025) slot(t).tick = true;
  for (const e of [...events].sort((a, b) => a.t - b.t)) slot(e.t).events.push(e);
  for (const [t, s] of slots) {
    void ctx.suspend(t).then(() => {
      for (const e of s.events) apply(e);
      if (s.tick) inner.schedule();
      void ctx.resume();
    });
  }
  return wav(await ctx.startRendering());
};

declare global {
  interface Window {
    renderScore: (spec: ScoreSpec) => Promise<string>;
  }
}

window.renderScore = renderScore;
