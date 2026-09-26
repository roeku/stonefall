export class AudioPlayer {
  private static ctx: AudioContext | null = null;
  private static outputGain: GainNode | null = null;
  private static sfxVolume = 1;
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

  private static getCtx() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return this.ctx;
  }

  /**
   * The effects bus.
   *
   * Every sound goes through one gain, into a shared room and a limiter. The room is a short
   * synthetic impulse (a second of decaying noise), so a thud on the board and a stinger in the
   * run sit in the same space instead of each arriving bone dry; the limiter is what lets the
   * biggest moments stack six layers without clipping.
   */
  private static getOutputGain(): GainNode {
    const ctx = this.getCtx();
    if (!this.outputGain) {
      const bus = ctx.createGain();
      bus.gain.value = this.sfxVolume;

      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -8;
      limiter.knee.value = 4;
      limiter.ratio.value = 14;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.12;
      limiter.connect(ctx.destination);

      bus.connect(limiter);
      try {
        const convolver = ctx.createConvolver();
        convolver.buffer = this.makeRoom(1.1, 2.6);
        const wet = ctx.createGain();
        wet.gain.value = 0.22;
        bus.connect(convolver).connect(wet).connect(limiter);
      } catch {
        // No room is still a mix.
      }
      this.outputGain = bus;
    }
    return this.outputGain;
  }

  /** Decaying stereo noise as an impulse response: a small hard room. */
  private static makeRoom(seconds: number, decay: number): AudioBuffer {
    const ctx = this.getCtx();
    const frames = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buf = ctx.createBuffer(2, frames, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < frames; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / frames, decay);
      }
    }
    return buf;
  }

  static setMasterVolume(volume: number) {
    this.sfxVolume = Math.max(0, Math.min(1, volume));
    if (this.outputGain) {
      this.outputGain.gain.value = this.sfxVolume;
    }
  }

  static setEnabled(enabled: boolean) {
    this.setMasterVolume(enabled ? 1 : 0);
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
    MusicManager.setVolume(muted ? 0 : 0.6);
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
      this.getOutputGain();
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

  static playWhoosh(volume = 0.18, frequency = 400) {
    if (!this.audible()) return;
    const ctx = this.getCtx();
    const output = this.getOutputGain();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    osc.connect(gain);
    gain.connect(output);
    osc.start(now);
    osc.stop(now + 0.25);
  }

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

  static playChime(volume = 0.25, frequency = 1200) {
    if (!this.audible()) return;
    const ctx = this.getCtx();
    const output = this.getOutputGain();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc.connect(gain);
    gain.connect(output);
    osc.start(now);
    osc.stop(now + 0.35);
  }

  /**
   * A milestone in the middle of a run: a new best, or passing the score being chased.
   *
   * These used to be one triangle beep, the barest sound in the game on its biggest moments.
   * Now a sub thump for weight, a quick rising arpeggio with a detuned shimmer on top of it, and
   * a lift of filtered noise, all through the shared room. A best is brighter and climbs an
   * octave further than a pass. Pitch drifts a few percent so two in one run are not twins.
   */
  static playMilestone(kind: 'best' | 'pass') {
    if (!this.audible()) return;
    const ctx = this.getCtx();
    const output = this.getOutputGain();
    const now = ctx.currentTime;
    const jitter = 1 + (Math.random() - 0.5) * 0.06;
    const best = kind === 'best';

    // Weight: a short sub that drops away.
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(96 * jitter, now);
    sub.frequency.exponentialRampToValueAtTime(44, now + 0.3);
    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0.0001, now);
    subGain.gain.exponentialRampToValueAtTime(0.34, now + 0.01);
    subGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);
    sub.connect(subGain).connect(output);
    sub.start(now);
    sub.stop(now + 0.36);

    // The rise: G, B, D, G for a best, D, G, B for a pass, each note a triangle with a pair of
    // detuned saws under it, fast enough to read as one gesture.
    const notes = best ? [784, 988, 1175, 1568] : [587, 784, 988];
    notes.forEach((f, i) => {
      const start = now + 0.04 + i * 0.075;
      const length = i === notes.length - 1 ? 0.6 : 0.24;
      const peak = (best ? 0.16 : 0.13) * (i === notes.length - 1 ? 1.15 : 1);
      const voice = (type: OscillatorType, detune: number, level: number) => {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.setValueAtTime(f * jitter, start);
        o.detune.setValueAtTime(detune, start);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, start);
        g.gain.exponentialRampToValueAtTime(level, start + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0001, start + length);
        o.connect(g).connect(output);
        o.start(start);
        o.stop(start + length + 0.02);
      };
      voice('triangle', 0, peak);
      voice('sawtooth', -9, peak * 0.14);
      voice('sawtooth', 9, peak * 0.14);
    });

    // Air: noise swept up through a band-pass under the notes.
    try {
      const buf = this.getNoiseBuffer(0.7);
      if (buf) {
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.Q.value = 1.4;
        bp.frequency.setValueAtTime(900, now);
        bp.frequency.exponentialRampToValueAtTime(best ? 6200 : 4200, now + 0.5);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, now);
        g.gain.exponentialRampToValueAtTime(best ? 0.12 : 0.08, now + 0.12);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 0.62);
        src.connect(bp).connect(g).connect(output);
        src.start(now);
        src.stop(now + 0.66);
      }
    } catch {
      // The notes carry it without the air.
    }
  }

  /**
   * The result of a run arriving on screen, after the fall: a soft low chord that says the run
   * is banked, warmer and with a high octave on top when it is a new best. Slow in and long out,
   * so it sits behind the fall's thud rather than competing with it.
   */
  static playResult(best: boolean) {
    if (!this.audible()) return;
    const ctx = this.getCtx();
    const output = this.getOutputGain();
    const now = ctx.currentTime;
    const jitter = 1 + (Math.random() - 0.5) * 0.03;
    const chord = best ? [196, 294, 392, 494, 784] : [196, 294, 392];
    chord.forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = i === 0 ? 'sine' : 'triangle';
      o.frequency.setValueAtTime(f * jitter, now);
      const g = ctx.createGain();
      const level = (i === 0 ? 0.16 : 0.07) * (best && i >= 3 ? 0.8 : 1);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(level, now + 0.05 + i * 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + (best ? 1.6 : 1.1));
      o.connect(g).connect(output);
      o.start(now);
      o.stop(now + (best ? 1.65 : 1.15));
    });
  }

  /** A short tick for a UI tap: a few milliseconds of filtered noise and a soft blip. */
  static playTap(pitch = 1) {
    if (!this.audible()) return;
    const ctx = this.getCtx();
    const output = this.getOutputGain();
    const now = ctx.currentTime;
    const jitter = 1 + (Math.random() - 0.5) * 0.12;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(1500 * pitch * jitter, now);
    o.frequency.exponentialRampToValueAtTime(900 * pitch * jitter, now + 0.05);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.09, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    o.connect(g).connect(output);
    o.start(now);
    o.stop(now + 0.07);
  }

  /**
   * A tower raised on the board.
   *
   * A thud with a sub under it, a cut of noise for the contact, and a rising two-note answer
   * that is warmer on a claim and brighter on a take, so the three outcomes are told apart by
   * ear before the text has been read.
   */
  static playRaise(kind: 'keep' | 'claim' | 'take') {
    if (!this.audible()) return;
    const ctx = this.getCtx();
    const output = this.getOutputGain();
    const now = ctx.currentTime;
    const jitter = 1 + (Math.random() - 0.5) * 0.1;
    this.playThud(0.7, 62 * jitter);

    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(70, now);
    sub.frequency.exponentialRampToValueAtTime(38, now + 0.4);
    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0.3, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    sub.connect(subGain).connect(output);
    sub.start(now);
    sub.stop(now + 0.5);

    const notes = kind === 'take' ? [660, 880, 1320] : kind === 'claim' ? [523, 784] : [440, 587];
    notes.forEach((f, i) => {
      const start = now + 0.16 + i * 0.11;
      const o = ctx.createOscillator();
      o.type = kind === 'take' ? 'square' : 'triangle';
      o.frequency.setValueAtTime(f * jitter, start);
      const g = ctx.createGain();
      g.gain.setValueAtTime((kind === 'take' ? 0.16 : 0.12) - i * 0.02, start);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.34);
      o.connect(g).connect(output);
      o.start(start);
      o.stop(start + 0.36);
    });
  }

  /**
   * A tower being demolished: the groan as it goes, a rattle of blocks landing in the heap, and
   * the floor taking the weight when the column arrives. `size` is 0 to 1, a stub to a spire;
   * a bigger tower rumbles longer, rattles more and hits lower.
   */
  static playCrumble(size = 0.5) {
    if (!this.audible()) return;
    const ctx = this.getCtx();
    const output = this.getOutputGain();
    const now = ctx.currentTime;
    const k = Math.max(0, Math.min(1, size));
    const length = 1 + k * 0.6;
    try {
      const buf = this.getNoiseBuffer(1.6);
      if (buf) {
        // The groan and the rumble: noise swept down through a closing low-pass.
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.playbackRate.value = 0.7 + Math.random() * 0.15;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(1800, now);
        lp.frequency.exponentialRampToValueAtTime(140, now + length);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.001, now);
        g.gain.exponentialRampToValueAtTime(0.34 + k * 0.12, now + 0.12);
        g.gain.exponentialRampToValueAtTime(0.001, now + length);
        src.connect(lp).connect(g).connect(output);
        src.start(now);
        src.stop(now + length + 0.05);

        // The rattle: short bright knocks, bunching up as the heap fills.
        const knocks = 6 + Math.round(k * 6);
        for (let i = 0; i < knocks; i++) {
          const at =
            now + 0.22 + Math.pow(i / knocks, 0.7) * (0.75 + k * 0.4) + Math.random() * 0.05;
          const knock = ctx.createBufferSource();
          knock.buffer = buf;
          knock.playbackRate.value = 1.4 + Math.random() * 1.2;
          const bp = ctx.createBiquadFilter();
          bp.type = 'bandpass';
          bp.frequency.value = 700 + Math.random() * 1900;
          bp.Q.value = 6;
          const kg = ctx.createGain();
          const peak = (0.16 + Math.random() * 0.2) * (1 - (i / knocks) * 0.4);
          kg.gain.setValueAtTime(peak, at);
          kg.gain.exponentialRampToValueAtTime(0.001, at + 0.05 + Math.random() * 0.04);
          knock.connect(bp).connect(kg).connect(output);
          knock.start(at, Math.random() * 0.8);
          knock.stop(at + 0.1);
        }
      }
    } catch {
      // The floor hit below still lands.
    }
    // The column arriving: a low sine dropping away.
    const hit = now + 0.95;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(96 - k * 30, hit);
    o.frequency.exponentialRampToValueAtTime(30, hit + 0.42);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, hit);
    g.gain.exponentialRampToValueAtTime(0.6, hit + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, hit + 0.46);
    o.connect(g).connect(output);
    o.start(hit);
    o.stop(hit + 0.5);
  }

  /**
   * Relay: somebody is out. A falling whistle under the miss, then the thud of the block landing
   * far below, so the fall is heard as a fall and not only as a mistake.
   */
  static playElimination(mine: boolean) {
    if (!this.audible()) return;
    const ctx = this.getCtx();
    const output = this.getOutputGain();
    const now = ctx.currentTime;
    this.playMissImpact(mine ? 6 : 4, 0);
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(mine ? 660 : 520, now + 0.05);
    o.frequency.exponentialRampToValueAtTime(90, now + 0.85);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, now + 0.05);
    g.gain.exponentialRampToValueAtTime(mine ? 0.2 : 0.13, now + 0.1);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
    o.connect(g).connect(output);
    o.start(now + 0.05);
    o.stop(now + 0.95);
    const hit = now + 0.9;
    const t = ctx.createOscillator();
    t.type = 'sine';
    t.frequency.setValueAtTime(70, hit);
    t.frequency.exponentialRampToValueAtTime(32, hit + 0.3);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.001, hit);
    tg.gain.exponentialRampToValueAtTime(mine ? 0.7 : 0.5, hit + 0.01);
    tg.gain.exponentialRampToValueAtTime(0.001, hit + 0.34);
    t.connect(tg).connect(output);
    t.start(hit);
    t.stop(hit + 0.36);
  }

  /** Relay: it is your turn. Two rising notes, unmistakable and short. */
  static playYourTurn() {
    if (!this.audible()) return;
    const ctx = this.getCtx();
    const output = this.getOutputGain();
    const now = ctx.currentTime;
    [784, 1175].forEach((f, i) => {
      const start = now + i * 0.13;
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(f, start);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.18, start);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.32);
      o.connect(g).connect(output);
      o.start(start);
      o.stop(start + 0.34);
    });
  }

  /** Relay: the top heals. A soft upward sweep, the sound of a block regrowing. */
  static playHeal() {
    if (!this.audible()) return;
    const ctx = this.getCtx();
    const output = this.getOutputGain();
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(320, now);
    o.frequency.exponentialRampToValueAtTime(960, now + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, now);
    g.gain.exponentialRampToValueAtTime(0.16, now + 0.1);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
    o.connect(g).connect(output);
    o.start(now);
    o.stop(now + 0.62);
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
    // Pitch progression: each consecutive perfect lifts the stinger a semitone, up to an octave,
    // so a chain is heard climbing the way it is seen climbing. Resets with the streak.
    const climb = Math.pow(2, Math.min(12, Math.max(0, streak - 1)) / 12);

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
    clickOsc.frequency.setValueAtTime(2100 * climb, now);
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
    const notesBase = variant === 2 ? [1240, 1480, 1680] : [1320, 1560, 1760];
    const extraNotes = tierClamp >= 3 ? (variant === 2 ? [1820, 1960] : [1880]) : [];
    const ultraNotes = tierClamp >= 9 ? [2100, 2280] : tierClamp >= 12 ? [2100] : [];
    const notes = [...notesBase, ...extraNotes, ...ultraNotes];
    notes.forEach((freq, idx) => {
      const start = now + 0.12 + idx * 0.12;
      const o = ctx.createOscillator();
      o.type = variant === 0 ? 'triangle' : variant === 1 ? 'sine' : 'square';
      o.frequency.setValueAtTime(freq * climb, start);
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

// MusicManager: handles background music sequencing with transitions and loops.
export class MusicManager {
  // Map of logical keys to file paths relative to origin
  private static files: Record<string, string> = {
    'transition-00': 'transition-00.mp3',
    'transition-01': 'transition-01.mp3',
    'transition-02': 'transition-02.mp3',
    'transition-03': 'transition-03.mp3',
    'loop-01': 'loop-01.mp3',
    'loop-02': 'loop-02.mp3',
    'loop-03': 'loop-03.mp3',
    'loop-04': 'loop-04.mp3',
  };

  private static buffers: Record<string, AudioBuffer | null> = {
    'transition-00': null,
    'transition-01': null,
    'transition-02': null,
    'transition-03': null,
    'loop-01': null,
    'loop-02': null,
    'loop-03': null,
    'loop-04': null,
  };

  private static ctx: AudioContext | null = null;
  private static masterGain: GainNode | null = null;
  private static currentSource: AudioBufferSourceNode | null = null;
  private static pendingSources: Array<AudioBufferSourceNode> = [];
  private static loadPromise: Promise<void> | null = null;
  private static loads: Record<string, Promise<AudioBuffer | null>> = {};
  private static running: Promise<void> | null = null;
  private static volume = 0.6;

  // Which loop files to sequence during main gameplay (will be played in a repeating sequence)
  private static mainLoopKeys: string[] = ['loop-02', 'loop-03'];
  private static mainLoopIndex = 0;
  private static scheduledTimeouts = new Set<number>();
  private static actionCounter = 0;
  private static activeActionId = 0;

  private static getCtx(): AudioContext {
    if (this.ctx) return this.ctx;
    // reuse AudioPlayer's context if available
    try {
      const c = (AudioPlayer as any).getCtx ? (AudioPlayer as any).getCtx() : null;
      if (c) {
        this.ctx = c;
      } else {
        this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
    } catch (e) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    // ctx is guaranteed to be set above
    this.masterGain = this.ctx!.createGain();
    if (this.masterGain) {
      this.masterGain.gain.value = this.volume;
      this.masterGain.connect(this.ctx!.destination);
    }
    return this.ctx as AudioContext;
  }

  /**
   * Start loading the music, in the order a run reaches it.
   *
   * Each cue waits only for its own tracks, so the opening comes first and alone: music starts
   * after its 0.6 MB instead of after all 2.5 MB. Every run ends, and the main section comes at
   * ten blocks, so those follow. The crescendo is asked for by `transitionToSection`, so a run
   * that never reaches the main section never downloads it.
   */
  static init(): Promise<void> {
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = (async () => {
      await this.loadAll(['transition-00', 'loop-01']);
      await this.loadAll(['transition-03', 'loop-02', 'transition-01', 'loop-03']);
    })();
    return this.loadPromise;
  }

  private static async loadAll(keys: string[]): Promise<void> {
    await Promise.all(keys.map((key) => this.load(key)));
  }

  /**
   * One track, fetched and decoded once per page, and not before it could be heard.
   *
   * The browser cache is left to work. Reddit serves web view assets for a year from a host named
   * for the app version, so a new version comes with new URLs, and the dev server revalidates.
   * This used to fetch with `cache: 'reload'`, which downloaded all 2.5 MB again on every page
   * that started a run.
   */
  private static load(key: string): Promise<AudioBuffer | null> {
    const pending = this.loads[key];
    if (pending) return pending;
    const loading = (async () => {
      const filename = this.files[key];
      if (!filename) return null;
      try {
        await this.whenRunning();
        const res = await fetch(`${window.location.origin}/${filename}`);
        const buf = await this.getCtx().decodeAudioData(await res.arrayBuffer());
        this.buffers[key] = buf;
        return buf;
      } catch (e) {
        console.warn('MusicManager: failed to load', filename, e);
        return null;
      }
    })();
    this.loads[key] = loading;
    return loading;
  }

  /**
   * Resolves once the player has touched the game and the context is running. Never before the
   * first interaction, even where the browser would allow autoplay: the relay post mounts the
   * game scene as soon as it loads, inline in the feed, and without this a viewer who only
   * scrolled past would hear the intro and download all the music.
   */
  private static whenRunning(): Promise<void> {
    if (!this.running) {
      this.running = AudioPlayer.whenHeard().then(
        () =>
          new Promise<void>((resolve) => {
            const ctx = this.getCtx();
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
    return this.running;
  }

  private static stopSources() {
    // stop and clear current and pending sources
    const stopNode = (n: AudioBufferSourceNode | null) => {
      if (!n) return;
      try {
        n.onended = null;
        n.stop(0);
      } catch (e) {}
      try {
        n.disconnect();
      } catch (e) {}
    };
    stopNode(this.currentSource);
    this.currentSource = null;
    for (const n of this.pendingSources) stopNode(n);
    this.pendingSources = [];
  }

  private static clearScheduledTimeouts() {
    for (const id of this.scheduledTimeouts) {
      window.clearTimeout(id);
    }
    this.scheduledTimeouts.clear();
  }

  private static beginAction(stopExisting = true): number {
    this.clearScheduledTimeouts();
    if (stopExisting) this.stopSources();
    this.actionCounter += 1;
    this.activeActionId = this.actionCounter;
    return this.activeActionId;
  }

  private static isActionActive(actionId: number): boolean {
    return this.activeActionId === actionId;
  }

  private static scheduleTimeout(actionId: number, callback: () => void, delayMs: number) {
    const id = window.setTimeout(
      () => {
        this.scheduledTimeouts.delete(id);
        if (!this.isActionActive(actionId)) return;
        callback();
      },
      Math.max(0, delayMs)
    );
    this.scheduledTimeouts.add(id);
  }

  private static createSource(buffer: AudioBuffer, loop = false): AudioBufferSourceNode {
    const ctx = this.getCtx();
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = !!loop;
    if (loop) {
      src.loopStart = 0;
      src.loopEnd = buffer.duration;
    }
    const g = ctx.createGain();
    g.gain.value = 1;
    src.connect(g);
    g.connect(this.masterGain!);
    return src;
  }

  // Play a transition buffer then schedule the next loop to start exactly when the transition ends
  private static async playTransitionThenLoop(
    transitionKey: string,
    loopKey: string | null,
    actionId: number
  ): Promise<boolean> {
    await this.loadAll(loopKey ? [transitionKey, loopKey] : [transitionKey]);
    if (!this.isActionActive(actionId)) return false;

    const tBuf = this.buffers[transitionKey];
    if (!tBuf) return false;

    const ctx = this.getCtx();
    this.stopSources();

    const now = ctx.currentTime + 0.05; // small safety offset
    const transSrc = this.createSource(tBuf, false);
    if (!this.isActionActive(actionId)) {
      try {
        transSrc.disconnect();
      } catch (e) {}
      return false;
    }
    transSrc.start(now);
    this.currentSource = transSrc;

    if (loopKey) {
      const loopBuf = this.buffers[loopKey];
      if (loopBuf) {
        const loopSrc = this.createSource(loopBuf, true);
        if (!this.isActionActive(actionId)) {
          try {
            loopSrc.disconnect();
          } catch (e) {}
        } else {
          const loopStart = now + tBuf.duration;
          let startSucceeded = false;
          try {
            loopSrc.start(loopStart);
            startSucceeded = true;
          } catch (e) {
            // If start throws (suspended context), abandon this loop trigger.
            try {
              loopSrc.disconnect();
            } catch (inner) {}
          }
          if (startSucceeded) {
            this.pendingSources.push(loopSrc);
            const promote = () => {
              if (!this.isActionActive(actionId)) return;
              this.pendingSources = this.pendingSources.filter((s) => s !== loopSrc);
              this.currentSource = loopSrc;
              loopSrc.onended = null;
            };
            const delayMs = Math.max(0, (loopStart - ctx.currentTime) * 1000);
            this.scheduleTimeout(actionId, promote, delayMs + 20);
          }
        }
      }
    }

    transSrc.onended = () => {
      if (!this.isActionActive(actionId)) return;
      try {
        transSrc.disconnect();
      } catch (e) {}
      if (this.currentSource === transSrc) this.currentSource = null;
    };

    return true;
  }

  // Play a single looping buffer (used for simple loops like loop-01 or loop-04)
  private static async playLoopKey(loopKey: string, actionId: number): Promise<boolean> {
    await this.load(loopKey);
    if (!this.isActionActive(actionId)) return false;

    const buf = this.buffers[loopKey];
    if (!buf) return false;

    const ctx = this.getCtx();
    this.stopSources();

    const now = ctx.currentTime + 0.05;
    const src = this.createSource(buf, true);
    if (!this.isActionActive(actionId)) {
      try {
        src.disconnect();
      } catch (e) {}
      return false;
    }
    try {
      src.start(now);
    } catch (e) {
      try {
        src.disconnect();
      } catch (inner) {}
      return false;
    }
    this.currentSource = src;
    return true;
  }

  // Play main gameplay loops in sequence (loop-02 and loop-03) without gaps by chaining non-looping sources.
  // We'll actually play them as non-looping sources and schedule the next immediately onended to avoid drift.
  private static async playMainLoopSequence(actionId: number): Promise<void> {
    await this.loadAll(this.mainLoopKeys);
    if (!this.isActionActive(actionId)) return;
    // With none of the loops loaded, playNext would skip to the next one forever on a zero timer.
    if (!this.mainLoopKeys.some((key) => this.buffers[key])) return;

    this.stopSources();

    const playNext = () => {
      if (!this.isActionActive(actionId)) return;
      const key = this.mainLoopKeys[this.mainLoopIndex % this.mainLoopKeys.length]!;
      const buf = this.buffers[key];
      if (!buf) {
        this.mainLoopIndex++;
        this.scheduleTimeout(actionId, playNext, 0);
        return;
      }

      const ctx = this.getCtx();
      const src = this.createSource(buf, false);
      if (!this.isActionActive(actionId)) {
        try {
          src.disconnect();
        } catch (e) {}
        return;
      }

      src.onended = () => {
        if (!this.isActionActive(actionId)) {
          try {
            src.disconnect();
          } catch (e) {}
          return;
        }
        try {
          src.disconnect();
        } catch (e) {}
        this.mainLoopIndex++;
        this.scheduleTimeout(actionId, playNext, 0);
      };

      const startTime = ctx.currentTime + 0.02;
      try {
        src.start(startTime);
      } catch (e) {
        // If start fails (suspended context), abandon this source but try again shortly.
        this.scheduleTimeout(actionId, playNext, 50);
        return;
      }
      this.currentSource = src;
    };

    playNext();
  }

  // Public methods
  static async startGame() {
    const actionId = this.beginAction(true);
    const playedTransition = await this.playTransitionThenLoop(
      'transition-00',
      'loop-01',
      actionId
    );
    if (!this.isActionActive(actionId)) return;
    if (!playedTransition) {
      await this.playLoopKey('loop-01', actionId);
    }
  }

  static async transitionToSection() {
    // The crescendo comes later in a run than this, so its tracks start loading now rather than
    // when it is due.
    void this.loadAll(['transition-02', 'loop-04']);
    const actionId = this.beginAction(true);
    const playedTransition = await this.playTransitionThenLoop('transition-01', null, actionId);
    if (!this.isActionActive(actionId)) return;

    if (playedTransition) {
      const tBuf = this.buffers['transition-01'];
      if (!tBuf) {
        await this.playMainLoopSequence(actionId);
        return;
      }
      const startAfterMs = Math.max(0, tBuf.duration * 1000 + 30);
      this.scheduleTimeout(
        actionId,
        () => {
          void this.playMainLoopSequence(actionId);
        },
        startAfterMs
      );
    } else {
      await this.playMainLoopSequence(actionId);
    }
  }

  static async crescendo() {
    const actionId = this.beginAction(true);
    const playedTransition = await this.playTransitionThenLoop(
      'transition-02',
      'loop-04',
      actionId
    );
    if (!this.isActionActive(actionId)) return;
    if (!playedTransition) {
      await this.playLoopKey('loop-04', actionId);
    }
  }

  static async gameOverReturn() {
    const actionId = this.beginAction(true);
    const playedTransition = await this.playTransitionThenLoop(
      'transition-03',
      'loop-02',
      actionId
    );
    if (!this.isActionActive(actionId)) return;
    if (!playedTransition) {
      await this.playLoopKey('loop-02', actionId);
    }
  }

  static stop() {
    this.beginAction(true);
  }

  static setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.masterGain) this.masterGain.gain.value = this.volume;
  }

  static setMainLoops(order: string[]) {
    const allowed = order.filter((k) => ['loop-01', 'loop-02', 'loop-03', 'loop-04'].includes(k));
    if (allowed.length > 0) this.mainLoopKeys = allowed;
  }
}
