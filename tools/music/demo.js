// A run, played through the game's own music engine (src/client/components/audio/music.ts) on an
// offline audio context, from the rendered files in out/music. What it sounds like is what the
// game would do, at the moments listed in RUN; render.mjs turns it into out/stonefall-demo.mp3.
import { AdaptiveMusic, IDLE } from '../../src/client/components/audio/music.ts';
import { floatWav, toBase64 } from './wav.js';

const SAMPLE_RATE = 48000;
const LENGTH = 68;

/** What happens, when (seconds from Build), and what the music hears. */
const RUN = (() => {
  const steps = [];
  const state = { ...IDLE, scene: 'run', blocks: 1 };
  let t = 0;
  const at = (seconds, note, change = {}, action) => {
    t = seconds;
    Object.assign(state, change);
    steps.push({ t, note, signals: { ...state }, action });
  };
  const drops = (from, to, every, each) => {
    for (let b = from; b <= to; b++) at(t + every, null, { blocks: b, ...each(b) });
  };

  at(0, 'Build: the intro climbs into the riff, alone');
  steps[0].action = 'startRun';
  at(2.6, 'first drop: the drums slam in on the next bar', { blocks: 2, size: 0.95 });
  at(3.6, 'perfect', { blocks: 3, perfectStreak: 1 });
  at(4.6, 'miss: the music darkens a little', {
    blocks: 4,
    perfectStreak: 0,
    missStreak: 1,
    size: 0.88,
  });
  at(5.6, 'miss again: darker', { blocks: 5, missStreak: 2, size: 0.8 });
  at(6.6, 'perfect: it opens again; 6 blocks bring the stabs', {
    blocks: 6,
    missStreak: 0,
    perfectStreak: 1,
  });
  at(7.6, 'perfect', { blocks: 7, perfectStreak: 2 });
  at(8.6, 'perfect x3: the hook comes in', { blocks: 8, perfectStreak: 3 });
  drops(9, 15, 1.0, (b) => ({ perfectStreak: b - 5 }));
  steps.at(-1).note = '14 blocks: the arp joins on top';
  at(t + 1.0, 'the streak breaks: the hook finishes its phrase and goes', {
    blocks: 16,
    perfectStreak: 0,
    size: 0.72,
  });
  drops(17, 20, 1.0, (b) => ({ size: 0.72 - (b - 16) * 0.03 }));
  at(t + 1.2, 'a new best: the impact, and the hook for eight bars', {}, 'lift');
  drops(21, 36, 1.1, (b) => ({
    size: Math.max(0.2, 0.6 - (b - 20) * 0.026),
    missStreak: b % 3 === 0 ? 1 : 0,
  }));
  steps.at(-1).note = 'the block is small: the drive is all the way in';
  at(
    t + 1.5,
    'the block misses: game over. The tape stops, the derez, the riff muffled',
    { scene: 'over' },
    'gameOver'
  );
  at(t + 4, 'back to the board: the riff plays on for eight bars, then fades', {}, 'leave');
  return steps;
})();

async function render() {
  const ctx = new OfflineAudioContext(2, LENGTH * SAMPLE_RATE, SAMPLE_RATE);
  const music = new AdaptiveMusic(ctx, ctx.destination, async (name) => {
    const res = await fetch(`/out/music/${name}.mp3`);
    return ctx.decodeAudioData(await res.arrayBuffer());
  });
  await music.prefetch();

  const act = (step) => {
    music.update(step.signals);
    if (step.action === 'startRun') music.startRun();
    if (step.action === 'lift') music.lift();
    if (step.action === 'gameOver') music.gameOver();
    if (step.action === 'leave') music.leave();
  };
  const [first, ...rest] = RUN;
  act(first);
  await new Promise((resolve) => setTimeout(resolve, 0));
  for (const step of rest) {
    void ctx.suspend(step.t).then(() => {
      act(step);
      void ctx.resume();
    });
  }
  const rendered = await ctx.startRendering();
  const channels = [0, 1].map((ch) => rendered.getChannelData(ch));
  return {
    wav: toBase64(floatWav(channels, SAMPLE_RATE)),
    notes: RUN.filter((s) => s.note).map((s) => `${s.t.toFixed(1).padStart(5)}s  ${s.note}`),
  };
}

window.stonefallDemo = { render };
window.stonefallReady = true;
