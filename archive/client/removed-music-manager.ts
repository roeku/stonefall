/**
 * Excerpt, not a module: the old MusicManager, cut out of
 * src/client/components/audio/AudioPlayer.ts on 2026-10-03.
 *
 * It played the previous soundtrack (archive/client/public/loop-0*.mp3, transition-0*.mp3) as
 * four fixed sections: an intro and loop at the start of a run, a transition into two
 * alternating main loops at ten blocks, a crescendo when the block got small, and a transition
 * back to a main loop at game over, which then played on under the board forever. Sections
 * chained on setTimeout, so each loop change landed 20 to 40 ms late. Replaced by
 * src/client/components/audio/music.ts: six synthwave stems that play together, each faded by
 * what the run is doing, scheduled on the audio clock. It references AudioPlayer's private
 * context and does not compile on its own.
 */

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
