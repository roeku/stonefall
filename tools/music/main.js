// The Strudel REPL, opened on Stonefall's music.
//
// The page is the editor from strudel.cc (with its samples and soundfonts, for trying things) and
// a button per mix the game moves between. With ?render it is instead the headless renderer
// render.mjs drives: no editor, no samples, and `window.stonefall.render(name)` returns a stem or
// a one-shot as a WAV.
import { evalScope, silence } from '@strudel/core';
import { StrudelMirror, codemirrorSettings } from '@strudel/codemirror';
import { getDrawContext } from '@strudel/draw';
import { transpiler } from '@strudel/transpiler';
import {
  getAudioContext,
  getSuperdoughAudioController,
  initAudio,
  registerSynthSounds,
  registerZZFXSounds,
  samples,
  resetGlobalEffects,
  setAudioContext,
  setSuperdoughAudioController,
  superdough,
  webaudioOutput,
  webaudioRepl,
} from '@strudel/webaudio';
import { prebake } from '@strudel/repl/prebake.mjs';
import track from './stonefall.strudel?raw';
import { BARS, PRESETS, SHOTS, TAIL, withPlay } from './cues.js';
import { floatWav, toBase64 } from './wav.js';

const SAMPLE_RATE = 48000;

/** The track's samples (npm run samples), loaded before anything plays so no note goes missing. */
const loadSamples = () => samples('/samples/strudel.json', '/samples/');

const mode = new URLSearchParams(location.search);
if (mode.has('render')) void startRenderer();
else if (mode.has('demo')) void import('./demo.js');
else startEditor();

function startEditor() {
  // Audio starts on the first evaluation, which is always a click or a key press. Strudel's own
  // initAudioOnFirstClick waits for a mousedown and races the click it comes with: a cue button
  // would start playing before the worklets the supersaws need had loaded.
  let audio;
  const audioReady = () => (audio ??= initAudio());
  const status = document.getElementById('status');
  const editor = new StrudelMirror({
    defaultOutput: webaudioOutput,
    getTime: () => getAudioContext().currentTime,
    transpiler,
    root: document.getElementById('editor'),
    initialCode: track,
    pattern: silence,
    drawTime: [-2, 2],
    drawContext: getDrawContext(),
    prebake: async () => {
      await prebake();
      await loadSamples();
    },
    beforeEval: audioReady,
    onUpdateState: (state) => {
      if (state.evalError) status.textContent = String(state.evalError.message ?? state.evalError);
      else status.textContent = state.started ? 'playing' : '';
    },
  });
  editor.updateSettings(codemirrorSettings.get());

  const nav = document.getElementById('cues');
  const buttons = PRESETS.map(({ label, play, note }) => {
    const button = document.createElement('button');
    button.innerHTML = `${label}<small>${note}</small>`;
    button.title = play;
    button.onclick = () => {
      editor.setCode(withPlay(editor.code, play));
      void editor.evaluate();
      for (const b of buttons) b.setAttribute('aria-pressed', String(b === button));
    };
    nav.insertBefore(button, status);
    return button;
  });

  document.addEventListener(
    'keydown',
    (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        fetch('/__save', { method: 'POST', body: editor.code }).then(
          () => (status.textContent = 'saved'),
          () => (status.textContent = 'not saved: is the dev server running?')
        );
      }
    },
    true
  );

  // stonefall.strudel changed on disk (not by Ctrl+S here): take the new code, and keep playing.
  import.meta.hot?.accept('./stonefall.strudel?raw', (mod) => {
    if (!mod || mod.default === editor.code) return;
    editor.setCode(mod.default);
    if (editor.repl.scheduler.started) void editor.evaluate();
  });
  window.stonefall = { editor };
}

async function startRenderer() {
  const repl = webaudioRepl({ transpiler });
  await evalScope(
    import('@strudel/core'),
    import('@strudel/mini'),
    import('@strudel/tonal'),
    import('@strudel/webaudio')
  );
  await Promise.all([registerSynthSounds(), registerZZFXSounds(), loadSamples()]);

  const evaluate = async (play) => {
    const pattern = await repl.evaluate(withPlay(track, play), false);
    if (!pattern) throw new Error(`${play} did not evaluate`);
    return { pattern, cps: repl.scheduler.cps };
  };

  window.stonefall = {
    /** What `play` plays from `from` to `to` (in bars), for checking notes without listening. */
    async haps(play, from, to) {
      const { pattern } = await evaluate(play);
      return pattern
        .queryArc(from, to)
        .filter((h) => h.hasOnset())
        .map((h) => ({ t: h.whole.begin.valueOf(), d: h.duration.valueOf(), ...h.value }));
    },

    /**
     * A stem or one-shot as a 32-bit float WAV, base64. `only` keeps the notes whose sound, orbit,
     * or sound@orbit is listed (['sbd'], [2], ['white@1']), to measure one part on its own.
     */
    async render(name, only) {
      const shot = SHOTS.find((c) => c.name === name);
      let { pattern, cps } = await evaluate(name);
      if (only) {
        const part = (v) => [v.s, v.orbit ?? 1, `${v.s}@${v.orbit ?? 1}`];
        pattern = pattern.filterValues((v) => part(v).some((k) => only.includes(k)));
      }
      if (shot) {
        // Its bars and room for the tail, which fades out over the last tenth of a second.
        const rendered = await renderOffline(pattern, cps, shot.bars + TAIL * cps, shot.bars);
        const channels = [0, 1].map((ch) => rendered.getChannelData(ch));
        const fade = SAMPLE_RATE / 10;
        for (const data of channels) {
          for (let i = 0; i < fade; i++) data[data.length - 1 - i] *= i / fade;
        }
        return toBase64(floatWav(channels, SAMPLE_RATE));
      }
      // A stem is taken from its second pass, which starts with the tails of the first.
      const rendered = await renderOffline(pattern, cps, 2 * BARS);
      const length = Math.round((BARS / cps) * SAMPLE_RATE);
      const channels = [0, 1].map((ch) => rendered.getChannelData(ch).subarray(length, 2 * length));
      return toBase64(floatWav(channels, SAMPLE_RATE));
    },
  };
  window.stonefallReady = true;
}

/**
 * Strudel's own renderPatternAudio (@strudel/webaudio), except that it returns the buffer, waits
 * for the reverbs (superdough builds each room's impulse in a second offline context, and a room
 * that is not ready yet renders dry), and never steals a voice (all of a render's notes are
 * scheduled before it starts, so polyphony would count every one of them as playing). Notes are
 * taken from the first `until` cycles; the rest of the render is their tails.
 */
async function renderOffline(pattern, cps, cycles, until = cycles) {
  const Controller = getSuperdoughAudioController().constructor;
  await getAudioContext().close();
  const ctx = new OfflineAudioContext(2, Math.round((cycles / cps) * SAMPLE_RATE), SAMPLE_RATE);
  setAudioContext(ctx);
  setSuperdoughAudioController(new Controller(ctx));
  await initAudio({ maxPolyphony: 1e6 });
  const haps = pattern
    .queryArc(0, until, { _cps: cps })
    .filter((h) => h.hasOnset())
    .sort((a, b) => a.whole.begin.valueOf() - b.whole.begin.valueOf());
  for (const hap of haps) {
    hap.ensureObjectValue();
    const begin = hap.whole.begin.valueOf();
    await superdough(hap.value, begin / cps, hap.duration / cps, cps, begin);
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
  try {
    return await ctx.startRendering();
  } finally {
    setAudioContext(null);
    setSuperdoughAudioController(null);
    resetGlobalEffects();
  }
}
