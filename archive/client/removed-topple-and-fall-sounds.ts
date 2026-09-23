/**
 * Excerpt, not a module: two AudioPlayer methods cut out of
 * src/client/components/audio/AudioPlayer.ts on 2026-09-23.
 *
 * `playTopple` sounded the lean-and-sink topple (archive/client/components/board/
 * TopplingTowers.tsx); it was replaced by `playCrumble`, which is longer and rattles as the
 * blocks land. `playFall` sounded a relay miss as a lower miss blip; it was replaced by
 * `playElimination`, which adds the falling whistle and the far-below thud, so a fall is heard
 * as a fall. Both reference the class's private helpers and do not compile on their own.
 */

  /** A tower coming down: a crumble of noise sweeping downward, then a floor hit. */
  static playTopple() {
    if (this.sfxVolume <= 0) return;
    const ctx = this.getCtx();
    const output = this.getOutputGain();
    const now = ctx.currentTime;
    try {
      const buf = this.getNoiseBuffer(0.7);
      if (buf) {
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(2600, now);
        lp.frequency.exponentialRampToValueAtTime(240, now + 0.6);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.001, now);
        g.gain.exponentialRampToValueAtTime(0.3, now + 0.06);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
        src.connect(lp).connect(g).connect(output);
        src.start(now);
        src.stop(now + 0.7);
      }
    } catch {
      // The thud below still lands.
    }
    const hit = now + 0.42;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(90, hit);
    o.frequency.exponentialRampToValueAtTime(34, hit + 0.3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, hit);
    g.gain.exponentialRampToValueAtTime(0.001, hit + 0.34);
    o.connect(g).connect(output);
    o.start(hit);
    o.stop(hit + 0.36);
  }


  /** Relay: somebody fell. The miss blip, lower, with a longer tail. */
  static playFall() {
    if (this.sfxVolume <= 0) return;
    this.playMissImpact(4, 0);
    this.playThud(0.8, 48);
  }

