export class AudioPlayer {
  private static ctx: AudioContext | null = null;

  private static getCtx() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return this.ctx;
  }

  static playWhoosh(volume = 0.18, frequency = 400) {
    const ctx = this.getCtx();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.25);
  }

  static playThud(volume = 0.6, frequency = 80) {
    const ctx = this.getCtx();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.18);
  }

  static playChime(volume = 0.25, frequency = 1200) {
    const ctx = this.getCtx();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.35);
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

  private static stopCurrent() {
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
  private static async playTransitionThenLoop(transitionKey: string, loopKey: string | null) {
    await this.init();
    const tBuf = this.buffers[transitionKey];
    if (!tBuf) return;
    const ctx = this.getCtx();
    this.stopCurrent();

    const now = ctx.currentTime + 0.05; // small safety offset
    const transSrc = this.createSource(tBuf, false);
    transSrc.start(now);
    this.currentSource = transSrc;

    if (loopKey) {
      const loopBuf = this.buffers[loopKey];
      if (loopBuf) {
        const loopSrc = this.createSource(loopBuf, true);
        // schedule loop to start exactly when transition ends
        loopSrc.start(now + tBuf.duration);
        // keep reference so we can stop it later
        this.pendingSources.push(loopSrc);
        // when loop actually starts, promote it to currentSource and clear pending
        const promote = () => {
          // remove from pending
          this.pendingSources = this.pendingSources.filter((s) => s !== loopSrc);
          this.currentSource = loopSrc;
          // ensure onended cleared (looping nodes won't onend)
          loopSrc.onended = null;
        };
        // set a timeout to promote (based on audioContext time)
        const delayMs = Math.max(0, (now + tBuf.duration - ctx.currentTime) * 1000);
        setTimeout(promote, delayMs + 20);
      }
    }
    // When transition ends, clear its onended and release
    transSrc.onended = () => {
      try {
        transSrc.disconnect();
      } catch (e) {}
      if (this.currentSource === transSrc) this.currentSource = null;
    };
  }

  // Play a single looping buffer (used for simple loops like loop-01 or loop-04)
  private static async playLoopKey(loopKey: string) {
    await this.init();
    const buf = this.buffers[loopKey];
    if (!buf) return;
    const ctx = this.getCtx();
    this.stopCurrent();
    const now = ctx.currentTime + 0.05;
    const src = this.createSource(buf, true);
    src.start(now);
    this.currentSource = src;
  }

  // Play main gameplay loops in sequence (loop-02 and loop-03) without gaps by chaining non-looping sources.
  // We'll actually play them as non-looping sources and schedule the next immediately onended to avoid drift.
  private static async playMainLoopSequence() {
    await this.init();
    this.stopCurrent();
    const playNext = () => {
      const key = this.mainLoopKeys[this.mainLoopIndex % this.mainLoopKeys.length]!;
      const buf = this.buffers[key];
      if (!buf) {
        this.mainLoopIndex++;
        // try next
        setTimeout(playNext, 0);
        return;
      }
      const ctx = this.getCtx();
      const src = this.createSource(buf, false);
      // when this piece ends, start the next piece immediately
      src.onended = () => {
        try {
          src.disconnect();
        } catch (e) {}
        this.mainLoopIndex++;
        // small immediate schedule to avoid a JS tick gap
        setTimeout(playNext, 0);
      };
      const now = ctx.currentTime + 0.02;
      src.start(now);
      this.currentSource = src;
    };
    // start sequence
    playNext();
  }

  // Public methods
  static async startGame() {
    await this.init();
    // transition-00 -> loop-01 (loop)
    if (this.buffers['transition-00'] && this.buffers['loop-01']) {
      await this.playTransitionThenLoop('transition-00', 'loop-01');
    } else if (this.buffers['loop-01']) {
      await this.playLoopKey('loop-01');
    }
  }

  static async transitionToSection() {
    await this.init();
    // transition-01 -> begin main loop sequence (loop-02/loop-03 repeating)
    if (this.buffers['transition-01']) {
      // schedule transition then start sequence
      await this.playTransitionThenLoop('transition-01', null);
      // after scheduling, start sequence shortly after transition ends
      const tBuf = this.buffers['transition-01']!;
      const startAfterMs = Math.max(0, tBuf.duration * 1000 + 30);
      setTimeout(() => this.playMainLoopSequence(), startAfterMs);
    } else {
      this.playMainLoopSequence();
    }
  }

  static async crescendo() {
    await this.init();
    // transition-02 -> loop-04 (final intense loop)
    if (this.buffers['transition-02'] && this.buffers['loop-04']) {
      await this.playTransitionThenLoop('transition-02', 'loop-04');
    } else if (this.buffers['loop-04']) {
      await this.playLoopKey('loop-04');
    }
  }

  static async gameOverReturn() {
    await this.init();
    // transition-03 -> loop-02
    if (this.buffers['transition-03'] && this.buffers['loop-02']) {
      await this.playTransitionThenLoop('transition-03', 'loop-02');
    } else if (this.buffers['loop-02']) {
      await this.playLoopKey('loop-02');
    }
  }

  static stop() {
    this.stopCurrent();
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
