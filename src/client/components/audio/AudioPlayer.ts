import {
  endNotes,
  fallNotes,
  healNotes,
  milestoneNotes,
  raiseNotes,
  rise,
  tapNote,
  turnNotes,
  unlockNotes,
} from './effectNotes';
import { KIT } from './kit';
import { MUSIC, MusicManager, bassNote, type Chord, type Space } from './music';
import { knock, makeRoom, play, type Out } from './voices';

/**
 * The effects' levels: peak gains before the effects' volume, or shares of the kit's own level
 * where the kit plays a whole gesture (a chord, a hit). They are set against the notes a landing
 * plays in a run: a tap well under them, a turn or a raise a little over, a milestone further
 * over, and a run's end the biggest sound in the game.
 */
const FX = {
  /** The effects' volume: under full, so effects and music together stay clear of the limiter. */
  VOLUME: 0.8,
  TAP: 0.07,
  /** A stone earned: the chip off the stone, and its notes. */
  CHIP: 0.08,
  UNLOCK: 0.12,
  /** A new best or a rival passed: the run of notes, and the chord under a best. */
  MILESTONE: 0.16,
  MILESTONE_CHORD: 1,
  /** The hit when a block misses the tower for good. */
  HIT: 1.3,
  /** A run's end: the root, the chord over it, and a best's run on top. */
  END_ROOT: 0.4,
  END_CHORD: 1.8,
  END_TOP: 0.14,
  /** A tower raised on the board: the stone set down, its bass note, and the chord's answer. */
  RAISE_KNOCK: 0.28,
  RAISE_BASS: 0.28,
  RAISE: 0.16,
  /** Towers felled: the floor taking the weight. */
  CRUMBLE: 0.8,
  CRUMBLE_KNOCK: 0.25,
  /** Relay: the notes of a block going over and the floor below, your turn, the top healing. */
  FALL: 0.14,
  FLOOR: 0.7,
  TURN: 0.2,
  HEAL: 0.1,
} as const;

/** E minor, the music's key: semitones above E for each degree. */
const E_MINOR = [0, 2, 3, 5, 7, 8, 10] as const;
const E6 = 1318.51;

/** The pitch `degree` steps of E minor above E6 (below it when negative). */
const inKey = (degree: number): number => {
  const octave = Math.floor(degree / 7);
  return E6 * 2 ** (octave + (E_MINOR[degree - octave * 7] ?? 0) / 12);
};

/** Where the effects' voices go: their level, and their sends into the shared space. */
interface Mix extends Out {
  readonly dry: GainNode;
  readonly room: GainNode;
  readonly echo: GainNode;
}

export class AudioPlayer {
  private static ctx: AudioContext | null = null;
  private static mix: Mix | null = null;
  private static limiter: DynamicsCompressorNode | null = null;
  private static shared: Space | null = null;
  private static sfxVolume: number = FX.VOLUME;
  // Reusable noise buffers to avoid reallocating large Float32Arrays every impact.
  private static noiseCache: { [lenKey: string]: AudioBuffer } = {};

  private static getNoiseBuffer(seconds: number): AudioBuffer | null {
    try {
      const ctx = this.getCtx();
      const lenKey = seconds.toFixed(2);
      if (this.noiseCache[lenKey]) return this.noiseCache[lenKey];
      const frames = Math.max(1, Math.floor(ctx.sampleRate * seconds));
      const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < frames; i++) {
        // Slight falloff to avoid clicks at end
        data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
      }
      this.noiseCache[lenKey] = buf;
      return buf;
    } catch {
      return null;
    }
  }

  /** The one audio context the effects and the music share. */
  static context(): AudioContext {
    return this.getCtx();
  }

  private static getCtx() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return this.ctx;
  }

  /**
   * The mix.
   *
   * The effects go through their own level into a limiter, and the music joins them there
   * (`musicInput`). Both send into one room and one echo (`space`), sized by the kit (kit.ts):
   * small and close, so a milestone and a landing note sit in the same place, and every effect is
   * an instrument of the music rather than something laid over it. The limiter is what lets the
   * biggest moments stack without clipping: a big hit presses the music down with it instead of
   * clipping over it.
   */
  private static getMix(): Mix {
    const ctx = this.getCtx();
    if (!this.mix) {
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -8;
      limiter.knee.value = 4;
      limiter.ratio.value = 14;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.12;
      limiter.connect(ctx.destination);
      this.limiter = limiter;

      const room = ctx.createGain();
      room.gain.value = 0.5;
      try {
        if (KIT.room > 0) {
          const convolver = ctx.createConvolver();
          convolver.buffer = makeRoom(ctx, KIT.room);
          room.connect(convolver).connect(limiter);
        }
      } catch {
        // No room is still a mix.
      }
      // The echo, on the kit's beat, darkens on each repeat.
      const echo = ctx.createGain();
      echo.gain.value = 0.22;
      const delay = ctx.createDelay(2);
      delay.delayTime.value = (60 / KIT.bpm) * KIT.echo.beats;
      const feedback = ctx.createGain();
      feedback.gain.value = KIT.echo.feedback;
      const tone = ctx.createBiquadFilter();
      tone.type = 'lowpass';
      tone.frequency.value = 2800;
      echo.connect(delay);
      delay.connect(tone).connect(feedback).connect(delay);
      tone.connect(limiter);
      this.shared = { room, echo };

      const level = (to: AudioNode): GainNode => {
        const g = ctx.createGain();
        g.gain.value = this.sfxVolume;
        g.connect(to);
        return g;
      };
      this.mix = { dry: level(limiter), room: level(room), echo: level(echo) };
    }
    return this.mix;
  }

  /** The effects' straight-out bus, for the effects that keep out of the room. */
  private static getOutputGain(): GainNode {
    return this.getMix().dry;
  }

  /** Where the music joins the effects: their limiter. */
  static musicInput(): AudioNode {
    this.getMix();
    return this.limiter ?? this.getCtx().destination;
  }

  /** The room and the echo, for the music to send into at its own volume. */
  static space(): Space {
    this.getMix();
    return this.shared!;
  }

  static setMasterVolume(volume: number) {
    this.sfxVolume = Math.max(0, Math.min(1, volume));
    if (this.mix) {
      for (const g of [this.mix.dry, this.mix.room, this.mix.echo]) g.gain.value = this.sfxVolume;
    }
  }

  static setEnabled(enabled: boolean) {
    this.setMasterVolume(enabled ? FX.VOLUME : 0);
  }

  private static muted = false;
  private static readonly MUTE_KEY = 'stonefall:muted';

  /** The player's mute choice, remembered per browser. */
  static isMuted(): boolean {
    return this.muted;
  }

  static setMuted(muted: boolean) {
    this.muted = muted;
    this.setEnabled(!muted);
    MusicManager.setVolume(muted ? 0 : MUSIC.VOLUME);
    try {
      window.localStorage.setItem(this.MUTE_KEY, muted ? '1' : '0');
    } catch {
      // A browser that refuses storage still gets the toggle for this session.
    }
  }

  static loadMutePreference() {
    try {
      if (window.localStorage.getItem(this.MUTE_KEY) === '1') this.setMuted(true);
    } catch {
      // ignore
    }
  }

  /**
   * Whether the player has touched the game yet on this page. Nothing sounds before they have:
   * Devvit allows no audio without a user interaction, and a browser that would allow it anyway
   * (desktop Chrome, for a site it trusts) must not have the feed play a crumble at someone who
   * only scrolled past.
   */
  private static heard = false;
  private static heardWaiters: Array<() => void> = [];

  /** Set while the post is scrolled away or the page is hidden: see `setHidden`. */
  private static hidden = false;

  /** Whether an effect may sound now: after the first interaction, on screen, and not muted. */
  private static audible(): boolean {
    return this.heard && !this.hidden && this.sfxVolume > 0;
  }

  /**
   * Whether the player has touched the game and it is on screen: the condition for anything the
   * game does to the device unasked, a sound or a buzz, when somebody else's move arrives.
   */
  static engaged(): boolean {
    return this.heard && !this.hidden;
  }

  /** Resolves at the player's first interaction with the game on this page. */
  static whenHeard(): Promise<void> {
    if (this.heard) return Promise.resolve();
    return new Promise((resolve) => this.heardWaiters.push(resolve));
  }

  /**
   * Unlock audio inside a user gesture.
   *
   * Only ever called from a tap, click or key press, so it is also what marks the first
   * interaction. Browsers, iOS Safari above all, keep an AudioContext created outside a gesture
   * suspended until one resumes it from inside a tap. The context used to be created in a React
   * effect, which is not inside anything, so on a phone the game could stay silent for the whole
   * session. Called from the first pointerdown on the play surface and from every button.
   */
  static unlock() {
    if (!this.heard) {
      this.heard = true;
      for (const resolve of this.heardWaiters.splice(0)) resolve();
    }
    if (this.hidden) return;
    try {
      const ctx = this.getCtx();
      if (ctx.state === 'suspended') void ctx.resume();
      this.getMix();
    } catch {
      // No audio device is not an error worth surfacing.
    }
  }

  /**
   * The post has left the screen, or come back (utils/postVisibility.ts). Devvit asks for sound
   * to stop when the player scrolls away, so the one context every sound and the music share is
   * suspended, which silences everything at once and holds the music where it was. It resumes on
   * the way back, if the player had already made it sound.
   */
  static setHidden(hidden: boolean) {
    if (this.hidden === hidden) return;
    this.hidden = hidden;
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      if (hidden) void ctx.suspend();
      else if (this.heard && ctx.state === 'suspended') void ctx.resume();
    } catch {
      // A context that will not change state is left as it is.
    }
  }

  // ------------------------------------------------------------------------------------ effects
  //
  // Every effect plays on the music's kit (kit.ts), in its room, and every effect with a pitch
  // takes it from the chord the music is on, or the one the last run ended on (effectNotes.ts).
  // Nothing is detuned for variety: the chord moving under an effect varies it.

  /** The chord an effect takes its notes from (MusicManager.chord). */
  private static chord(): Chord {
    return MusicManager.chord();
  }

  /**
   * A tap on a control: a short tick on a note of E minor's pentatonic, which sits in tune over
   * anything the music plays. The pitch keeps its meaning, higher for on and lower for off; the
   * tone varies a little, so two taps are never twins.
   */
  static playTap(pitch = 1) {
    if (!this.audible()) return;
    const ctx = this.getCtx();
    play(ctx, this.getMix(), tapNote(pitch), ctx.currentTime, FX.TAP, KIT.tick, {
      tone: 0.9 + Math.random() * 0.2,
    });
  }

  /**
   * A stone earned: a chip off the stone, then three high notes of the chord, a glint. Quieter
   * than a raise, because it marks something already won.
   */
  static playUnlock() {
    if (!this.audible()) return;
    const ctx = this.getCtx();
    const mix = this.getMix();
    const now = ctx.currentTime;
    knock(ctx, mix, now, FX.CHIP, { cutoff: 5200, decay: 0.018, room: 0.2 });
    unlockNotes(this.chord()).forEach((note, i, notes) => {
      const last = i === notes.length - 1;
      play(ctx, mix, note, now + 0.05 + i * 0.07, FX.UNLOCK * (last ? 1.2 : 1), KIT.lead, {
        stretch: last ? 2 : 0.8,
        tone: 1.3,
      });
    });
  }

  /**
   * A milestone in the middle of a run: a new best, or passing the score being chased.
   *
   * It comes with the landing that earned it, so it carries that landing's note on up the chord,
   * fast: three notes for a pass, five and brighter for a best, over a chord, the last held. No
   * thump under it: the run has none. The music takes it from there with its arpeggio
   * (MusicManager.lift).
   */
  static playMilestone(kind: 'best' | 'pass') {
    if (!this.audible()) return;
    const ctx = this.getCtx();
    const mix = this.getMix();
    const now = ctx.currentTime;
    const chord = this.chord();
    const best = kind === 'best';
    if (best) KIT.chord(ctx, mix, rise(chord, 60, 4), now, FX.MILESTONE_CHORD, false);
    milestoneNotes(chord, best).forEach((note, i, notes) => {
      const last = i === notes.length - 1;
      const at = now + 0.03 + i * (best ? 0.06 : 0.075);
      play(ctx, mix, note, at, FX.MILESTONE * (last ? 1.25 : 1), KIT.lead, {
        stretch: last ? (best ? 2.5 : 1.8) : 0.7,
        tone: best ? 1.3 : 1.1,
      });
    });
  }

  /**
   * A run's end, at the miss: the kit's hit, on the bass of the chord the music stops on
   * (MusicManager.gameOver), the chord the result then rings out (playResult).
   */
  static playGameOver() {
    if (!this.audible()) return;
    const ctx = this.getCtx();
    KIT.hit(ctx, this.getMix(), bassNote(this.chord()), ctx.currentTime, FX.HIT);
  }

  /**
   * The result of a run arriving on screen, after the fall. The music has stopped, and this is
   * its chord as one last sound: the root low and held, the chord over it, and for a new best a
   * run up the chord on top.
   */
  static playResult(best: boolean) {
    if (!this.audible()) return;
    const ctx = this.getCtx();
    const mix = this.getMix();
    const now = ctx.currentTime;
    const end = endNotes(this.chord(), best);
    play(ctx, mix, end.sub, now, FX.END_ROOT, KIT.bass, { stretch: 3, tone: 0.8 });
    KIT.chord(ctx, mix, end.bloom, now + 0.02, FX.END_CHORD, true);
    end.top.forEach((note, i, notes) => {
      const last = i === notes.length - 1;
      play(ctx, mix, note, now + 0.35 + i * 0.08, FX.END_TOP * (last ? 1.25 : 1), KIT.lead, {
        stretch: last ? 3 : 1,
        tone: 1.3,
      });
    });
  }

  /**
   * A tower raised on the board.
   *
   * The stone set down, a knock and a bass note, then the chord answers: two notes to keep, three
   * to claim, four and brighter to take, so the three outcomes are told apart by ear before the
   * text has been read. On the board the chord is the one the last run ended on, which is often
   * still ringing as the tower goes up.
   */
  static playRaise(kind: 'keep' | 'claim' | 'take') {
    if (!this.audible()) return;
    const ctx = this.getCtx();
    const mix = this.getMix();
    const now = ctx.currentTime;
    const chord = this.chord();
    knock(ctx, mix, now, FX.RAISE_KNOCK, { cutoff: 1300, decay: 0.07, room: 0.15 });
    play(ctx, mix, bassNote(chord), now, FX.RAISE_BASS, KIT.bass);
    const tone = kind === 'take' ? 1.5 : kind === 'claim' ? 1.15 : 0.9;
    raiseNotes(chord, kind).forEach((note, i, notes) => {
      const last = i === notes.length - 1;
      play(ctx, mix, note, now + 0.12 + i * 0.09, FX.RAISE * (last ? 1.2 : 1), KIT.lead, {
        stretch: last ? 1.8 : 0.8,
        tone,
      });
    });
  }

  /**
   * A tower being demolished: the groan as it goes, a rattle of blocks landing in the heap, and
   * the floor taking the weight when the column arrives, the kit's hit on the chord's root. `size`
   * is 0 to 1, a stub to a spire; a bigger tower rumbles longer, rattles more and hits harder.
   * Kept dark, so it rumbles rather than hisses.
   */
  static playCrumble(size = 0.5) {
    if (!this.audible()) return;
    const ctx = this.getCtx();
    const mix = this.getMix();
    const now = ctx.currentTime;
    const k = Math.max(0, Math.min(1, size));
    const length = 1 + k * 0.6;
    try {
      const buf = this.getNoiseBuffer(1.6);
      if (buf) {
        // The groan and the rumble: noise under a closing low-pass.
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.playbackRate.value = 0.7 + Math.random() * 0.15;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(1000, now);
        lp.frequency.exponentialRampToValueAtTime(120, now + length);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.001, now);
        g.gain.exponentialRampToValueAtTime(0.3 + k * 0.1, now + 0.12);
        g.gain.exponentialRampToValueAtTime(0.001, now + length);
        const wet = ctx.createGain();
        wet.gain.value = 0.2;
        src.connect(lp).connect(g).connect(mix.dry);
        g.connect(wet).connect(mix.room);
        src.start(now);
        src.stop(now + length + 0.05);
        src.onended = () => g.disconnect();
      }
    } catch {
      // The rattle and the floor still land.
    }
    // The rattle: knocks of stone, bunching up as the heap fills.
    const knocks = 6 + Math.round(k * 6);
    for (let i = 0; i < knocks; i++) {
      const at = now + 0.22 + Math.pow(i / knocks, 0.7) * (0.75 + k * 0.4) + Math.random() * 0.05;
      const peak = (0.12 + Math.random() * 0.14) * (1 - (i / knocks) * 0.4);
      knock(ctx, mix, at, peak, {
        cutoff: 900 + Math.random() * 1400,
        decay: 0.04 + Math.random() * 0.04,
        room: 0.25,
      });
    }
    // The column arriving.
    const hit = now + 0.95;
    knock(ctx, mix, hit, FX.CRUMBLE_KNOCK, { cutoff: 700, decay: 0.12, room: 0.3 });
    KIT.hit(ctx, mix, bassNote(this.chord()), hit, FX.CRUMBLE * (0.8 + k * 0.2));
  }

  /**
   * Relay: somebody is out. The hit as the block goes over, the chord coming down after it, and
   * the floor far below. When it is the player's own last life the music has stopped for them
   * (MusicManager.gameOver), and the floor is the chord's root, held, the way a run ends.
   */
  static playElimination(mine: boolean) {
    if (!this.audible()) return;
    const ctx = this.getCtx();
    const mix = this.getMix();
    const now = ctx.currentTime;
    const chord = this.chord();
    const k = mine ? 1 : 0.6;
    KIT.hit(ctx, mix, bassNote(chord), now, FX.HIT * k);
    fallNotes(chord, mine ? 5 : 4).forEach((note, i) =>
      play(ctx, mix, note, now + 0.1 + i * 0.12, FX.FALL * k * (1 - i * 0.12), KIT.lead, {
        tone: Math.max(0.3, 1 - i * 0.18),
      })
    );
    const floor = now + 0.9;
    KIT.hit(ctx, mix, bassNote(chord), floor, FX.FLOOR * k);
    if (mine) play(ctx, mix, chord.root, floor, FX.END_ROOT, KIT.bass, { stretch: 3, tone: 0.8 });
  }

  /**
   * Relay: a fall that leaves a life. The same hit as a player going out, smaller, and two notes
   * of the chord coming down, dull. Somebody else's is quieter.
   */
  static playMiss(mine: boolean) {
    if (!this.audible()) return;
    const ctx = this.getCtx();
    const mix = this.getMix();
    const now = ctx.currentTime;
    const chord = this.chord();
    const k = mine ? 1 : 0.6;
    KIT.hit(ctx, mix, bassNote(chord), now, FX.HIT * 0.6 * k);
    fallNotes(chord, 2).forEach((note, i) =>
      play(ctx, mix, note, now + 0.08 + i * 0.13, FX.FALL * k, KIT.lead, { tone: 0.4 })
    );
  }

  /** Relay: it is your turn. The root of the chord and the fifth over it: unmistakable, short. */
  static playYourTurn() {
    if (!this.audible()) return;
    const ctx = this.getCtx();
    const mix = this.getMix();
    const now = ctx.currentTime;
    turnNotes(this.chord()).forEach((note, i) =>
      play(ctx, mix, note, now + i * 0.14, FX.TURN * (i === 1 ? 1.15 : 1), KIT.lead, {
        stretch: i === 1 ? 2 : 1,
        tone: 1.3,
      })
    );
  }

  /** Relay: the top heals. A soft climb up the chord, the sound of a block regrowing. */
  static playHeal() {
    if (!this.audible()) return;
    const ctx = this.getCtx();
    const mix = this.getMix();
    const now = ctx.currentTime;
    healNotes(this.chord()).forEach((note, i) =>
      play(ctx, mix, note, now + i * 0.07, FX.HEAL, KIT.lead, { tone: 0.8 })
    );
  }

  // ------------------------------------------------------------------------- landing effects
  //
  // The landing's own effects, from before the music played the landings: a thud for any landing,
  // a stinger for a perfect, a rasp for a miss. A landing's note is its sound now, so these play
  // only when music.ts LANDING_EFFECTS is on.

  static playThud(volume = 0.6, baseFrequency = 80) {
    if (!this.audible()) return;
    const ctx = this.getCtx();
    const output = this.getOutputGain();
    const now = ctx.currentTime;
    // Never the same pitch twice in a row: a landing that repeats exactly reads as a sample.
    const frequency = baseFrequency * (1 + (Math.random() - 0.5) * 0.14);
    // Body: a pitch-dropping sine, so the hit has a downward weight rather than a flat tone.
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(frequency * 1.6, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, frequency * 0.55), now + 0.16);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    osc.connect(gain);
    gain.connect(output);
    osc.start(now);
    osc.stop(now + 0.22);
    // Crack: a few milliseconds of filtered noise on the front of the hit.
    try {
      const buf = this.getNoiseBuffer(0.06);
      if (buf) {
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(1400, now);
        const g = ctx.createGain();
        g.gain.setValueAtTime(volume * 0.5, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
        src.connect(lp).connect(g).connect(output);
        src.start(now);
        src.stop(now + 0.06);
      }
    } catch {
      // Noise is a garnish; the thud still plays without it.
    }
  }

  // Layered perfect impact + short rising stinger (≈500ms total) with tier & streak escalation
  private static perfectVariantCounter = 0;
  static playPerfectImpact(tier: number = 0, streak: number = 0) {
    if (!this.audible()) return;
    const ctx = this.getCtx();
    const output = this.getOutputGain();
    const now = ctx.currentTime;
    const variant = (this.perfectVariantCounter++ + Math.floor(streak / 5)) % 4; // allow extra variant at higher tiers
    const tierClamp = Math.min(15, Math.max(0, tier));
    // Pitch progression: each consecutive perfect lifts the stinger a step of E minor, up to an
    // octave, so a chain is heard climbing the way it is seen climbing, in the music's key.
    // Resets with the streak.
    const climb = Math.min(7, Math.max(0, streak - 1));

    // Low snap (short sine / square hybrid)
    const snapOsc = ctx.createOscillator();
    snapOsc.type = 'square';
    snapOsc.frequency.setValueAtTime(180, now);
    const snapGain = ctx.createGain();
    snapGain.gain.setValueAtTime(0.28, now);
    snapGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    snapOsc.connect(snapGain).connect(output);
    snapOsc.start(now);
    snapOsc.stop(now + 0.14);

    // Bright click (very short high freq ping)
    const clickOsc = ctx.createOscillator();
    clickOsc.type = 'triangle';
    clickOsc.frequency.setValueAtTime(inKey(5 + climb), now);
    const clickGain = ctx.createGain();
    clickGain.gain.setValueAtTime(0.18, now);
    clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    clickOsc.connect(clickGain).connect(output);
    clickOsc.start(now + 0.002); // tiny offset to layer
    clickOsc.stop(now + 0.09);

    // Shimmer bed (detuned set; grows with variant)
    const shimmerFreqs = variant === 1 ? [870, 880, 892] : [880, 884];
    shimmerFreqs.forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f, now);
      const g = ctx.createGain();
      const baseAmp = 0.055 * (1 + tierClamp * 0.06);
      g.gain.setValueAtTime(baseAmp, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.35 + i * 0.03);
      o.connect(g).connect(output);
      o.start(now + 0.005 * i);
      o.stop(now + 0.36 + i * 0.04);
    });

    // Rising 3-note stinger (power-up feel) – perfectly scheduled; extend notes at higher tiers
    // As degrees of E minor above E6: E G A, or D F# G; then B, or A B; then C D.
    const notesBase = variant === 2 ? [-1, 1, 2] : [0, 2, 3];
    const extraNotes = tierClamp >= 3 ? (variant === 2 ? [3, 4] : [4]) : [];
    const ultraNotes = tierClamp >= 9 ? [5, 6] : tierClamp >= 12 ? [5] : [];
    const notes = [...notesBase, ...extraNotes, ...ultraNotes];
    notes.forEach((degree, idx) => {
      const start = now + 0.12 + idx * 0.12;
      const o = ctx.createOscillator();
      o.type = variant === 0 ? 'triangle' : variant === 1 ? 'sine' : 'square';
      o.frequency.setValueAtTime(inKey(degree + climb), start);
      const g = ctx.createGain();
      const baseAmp = 0.22 - idx * 0.04;
      g.gain.setValueAtTime(baseAmp * (1 + tierClamp * 0.07), start);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.28);
      o.connect(g).connect(output);
      o.start(start);
      o.stop(start + 0.3);
    });

    // Soft widening whoosh (noise burst filtered) to feel like energy release
    const addNoiseBurst = (freq: number, gainAmp: number, len: number, timeOffset: number) => {
      try {
        const noiseBuf =
          this.getNoiseBuffer(len) || ctx.createBuffer(1, ctx.sampleRate * len, ctx.sampleRate);
        const noise = ctx.createBufferSource();
        noise.buffer = noiseBuf;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(freq, now + timeOffset);
        const g = ctx.createGain();
        g.gain.setValueAtTime(gainAmp, now + timeOffset + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, now + timeOffset + len * 0.9);
        noise.connect(bp).connect(g).connect(output);
        noise.start(now + timeOffset);
        noise.stop(now + timeOffset + len);
      } catch (e) {
        // ignore if fails
      }
    };
    addNoiseBurst(1500, 0.18 * (1 + tierClamp * 0.04), 0.25, 0.01);
    if (tierClamp >= 2) addNoiseBurst(1800, 0.12, 0.32, 0.04); // airy shimmer
    if (tierClamp >= 4) addNoiseBurst(3200, 0.08, 0.42, 0.06); // high airy sparkle
    if (tierClamp >= 8) addNoiseBurst(4000, 0.06, 0.48, 0.08); // ultra sparkle
    if (tierClamp >= 12) addNoiseBurst(5200, 0.05, 0.55, 0.1); // hyperspark

    // Sub thump at tier 3+
    if (tierClamp >= 3) {
      const sub = ctx.createOscillator();
      sub.type = 'sine';
      const subGain = ctx.createGain();
      sub.frequency.setValueAtTime(110, now + 0.02);
      sub.frequency.exponentialRampToValueAtTime(50, now + 0.32);
      subGain.gain.setValueAtTime(0.26 * (1 + Math.min(0.4, tier * 0.12)), now + 0.02);
      subGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);
      sub.connect(subGain).connect(output);
      sub.start(now + 0.02);
      sub.stop(now + 0.36);
    }

    // Reverse swell precursor at tier 5 (simulate by early airy noise before main hit)
    if (tierClamp >= 5) {
      addNoiseBurst(900, 0.12, 0.28, -0.18 + 0.01); // schedule slightly before (will start almost immediately if negative clamps)
    }

    // Streak-based micro tail every 4th perfect at tier>=2
    if (tierClamp >= 2 && streak > 0 && streak % 4 === 0) {
      const tail = [520, 660, 780];
      tail.forEach((f, i) => {
        const start = now + 0.38 + i * 0.05;
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.setValueAtTime(f * (1 + tierClamp * 0.012), start);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.08 + tierClamp * 0.012, start);
        g.gain.exponentialRampToValueAtTime(0.0001, start + 0.28);
        o.connect(g).connect(output);
        o.start(start);
        o.stop(start + 0.3);
      });
    }
  }

  // Miss / imperfect feedback: subtle descending blip + soft rasp escalating with miss tier
  static playMissImpact(tier: number = 0, streak: number = 0) {
    if (!this.audible()) return;
    const ctx = this.getCtx();
    const output = this.getOutputGain();
    const now = ctx.currentTime;
    const clampTier = Math.min(7, Math.max(0, tier));
    const jitter = 1 + (Math.random() - 0.5) * 0.12;
    // Descending blip
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const gain = ctx.createGain();
    const startF = (520 - clampTier * 30) * jitter;
    const endF = (220 - clampTier * 10) * jitter;
    osc.frequency.setValueAtTime(startF, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(60, endF), now + 0.28);
    gain.gain.setValueAtTime(0.18 + clampTier * 0.015, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
    osc.connect(gain).connect(output);
    osc.start(now);
    osc.stop(now + 0.34);
    // Soft rasp (bandpass noise) scaling with tier
    try {
      const dur = 0.35;
      const noiseBuf = this.getNoiseBuffer(dur);
      if (noiseBuf) {
        const src = ctx.createBufferSource();
        src.buffer = noiseBuf;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(600 - clampTier * 20, now);
        const g2 = ctx.createGain();
        g2.gain.setValueAtTime(0.08 + clampTier * 0.02, now + 0.02);
        g2.gain.exponentialRampToValueAtTime(0.0001, now + dur * 0.95);
        src.connect(bp).connect(g2).connect(output);
        src.start(now + 0.01);
        src.stop(now + dur);
      }
    } catch {}
    // Tiny per-streak tick every 5 misses to reinforce pattern
    if (streak > 0 && streak % 5 === 0) {
      const tOsc = ctx.createOscillator();
      const tGain = ctx.createGain();
      tOsc.type = 'triangle';
      tOsc.frequency.setValueAtTime(300 - clampTier * 12, now + 0.05);
      tGain.gain.setValueAtTime(0.12 + clampTier * 0.01, now + 0.05);
      tGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
      tOsc.connect(tGain).connect(output);
      tOsc.start(now + 0.05);
      tOsc.stop(now + 0.2);
    }
  }
}
