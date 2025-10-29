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

  private static getOutputGain(): GainNode {
    const ctx = this.getCtx();
    if (!this.outputGain) {
      this.outputGain = ctx.createGain();
      this.outputGain.gain.value = this.sfxVolume;
      this.outputGain.connect(ctx.destination);
    }
    return this.outputGain;
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

  static playWhoosh(volume = 0.18, frequency = 400) {
    if (this.sfxVolume <= 0) return;
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

  static playThud(volume = 0.6, frequency = 80) {
    if (this.sfxVolume <= 0) return;
    const ctx = this.getCtx();
    const output = this.getOutputGain();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc.connect(gain);
    gain.connect(output);
    osc.start(now);
    osc.stop(now + 0.18);
  }

  static playChime(volume = 0.25, frequency = 1200) {
    if (this.sfxVolume <= 0) return;
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

  // Layered perfect impact + short rising stinger (≈500ms total) with tier & streak escalation
  private static perfectVariantCounter = 0;
  static playPerfectImpact(tier: number = 0, streak: number = 0) {
    if (this.sfxVolume <= 0) return;
    const ctx = this.getCtx();
    const output = this.getOutputGain();
    const now = ctx.currentTime;
    const variant = (this.perfectVariantCounter++ + Math.floor(streak / 5)) % 4; // allow extra variant at higher tiers
    const tierClamp = Math.min(15, Math.max(0, tier));

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
    clickOsc.frequency.setValueAtTime(2100, now);
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
      o.frequency.setValueAtTime(freq, start);
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
    if (this.sfxVolume <= 0) return;
    const ctx = this.getCtx();
    const output = this.getOutputGain();
    const now = ctx.currentTime;
    const clampTier = Math.min(7, Math.max(0, tier));
    // Descending blip
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const gain = ctx.createGain();
    const startF = 520 - clampTier * 30;
    const endF = 220 - clampTier * 10;
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

  // Load and decode all audio files once. Returns a promise that resolves when ready.
  static init(): Promise<void> {
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = (async () => {
      const ctx = this.getCtx();
      const origin = window.location.origin + '/';
      const entries = Object.entries(this.files) as Array<[string, string]>;
      await Promise.all(
        entries.map(async ([key, filename]) => {
          try {
            const url = `${origin}${filename}`;
            const res = await fetch(url, { cache: 'reload' });
            const ab = await res.arrayBuffer();
            const buf = await ctx.decodeAudioData(ab.slice(0));
            this.buffers[key] = buf;
          } catch (e) {
            console.warn('MusicManager: failed to load', filename, e);
            this.buffers[key as string] = null;
          }
        })
      );
    })();
    return this.loadPromise;
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
    await this.init();
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
    await this.init();
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
    await this.init();
    if (!this.isActionActive(actionId)) return;

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
