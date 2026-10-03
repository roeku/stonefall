// Excerpt from src/client/components/audio/AudioPlayer.ts, cut out on 2026-10-03.
//
// The effects as they were before the music played the run: their own bus and room, and every
// effect but the landing ones (which stay, behind music.ts LANDING_EFFECTS). They were replaced
// by effects on the music's instruments (voices.ts), in its room, taking their notes from the
// chord the music is on (effectNotes.ts). These drifted a few percent in pitch at random, which
// put their notes between the music's (measured 20 to 45 cents off), used triangle, square and
// saw beeps and noise sweeps the music has none of, and doubled it at a run's end: the result's
// chord, then the music's last note, half a second apart. playWhoosh and playChime were unused.
//
// A record, not a module: it references the class's own statics and does not compile alone.

/**
 * The effects' level. Two decibels under full since the music came up to sit under them: they
 * still lead, and the two together stay clear of the limiter most of the time.
 */
const SFX_VOLUME = 0.8;

  /**
   * The effects bus.
   *
   * Every sound goes through one gain, into a shared room and a limiter. The room is a short
   * synthetic impulse (a second of decaying noise), so a thud on the board and a stinger in the
   * run sit in the same space instead of each arriving bone dry; the limiter is what lets the
   * biggest moments stack six layers without clipping. The music joins at the limiter (see
   * `musicInput`), so a big hit presses the music down with it instead of clipping over it.
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
      this.limiter = limiter;

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

  /** Where the music joins the effects: their limiter, past their gain and their room. */
  static musicInput(): AudioNode {
    this.getOutputGain();
    return this.limiter ?? this.getCtx().destination;
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
   * A stone earned: a bright scrape, as a burst of band-passed noise sweeping up, and two rising
   * notes under it. Quieter than a raise, because it marks something already won.
   */
  static playUnlock() {
    if (!this.audible()) return;
    const ctx = this.getCtx();
    const output = this.getOutputGain();
    const now = ctx.currentTime;
    const snap = now + 0.06;
    try {
      const buf = this.getNoiseBuffer(0.3);
      if (buf) {
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.Q.setValueAtTime(1.2, snap);
        bp.frequency.setValueAtTime(500, snap);
        bp.frequency.exponentialRampToValueAtTime(2600, snap + 0.16);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.001, snap);
        g.gain.exponentialRampToValueAtTime(0.2, snap + 0.03);
        g.gain.exponentialRampToValueAtTime(0.001, snap + 0.24);
        src.connect(bp).connect(g).connect(output);
        src.start(snap);
        src.stop(snap + 0.28);
      }
    } catch {
      // The notes still say it without the scrape.
    }
    [660, 990].forEach((frequency, i) => {
      const at = snap + 0.08 + i * 0.09;
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(frequency * (1 + (Math.random() - 0.5) * 0.03), at);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.001, at);
      g.gain.exponentialRampToValueAtTime(0.12, at + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, at + 0.42);
      o.connect(g).connect(output);
      o.start(at);
      o.stop(at + 0.45);
    });
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
