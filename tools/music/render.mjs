// Render stonefall.strudel into the game's music files.
//
//   npm run render              every stem and one-shot
//   npm run render -- beat lift just those (the rest are reused from out/wav)
//
// Each renders offline in headless Chrome through Strudel's own engine (see main.js), then ffmpeg
// writes out/music/<name>.mp3, the files src/client/public/music/ takes. They all get one common
// gain, which puts the groove (riff, drums and stabs together) at GAME_LUFS, so the stems keep
// their balance. On the way the synth stems are pumped on every beat (PUMP), the way a sidechain
// from the kick pumps them in a dance track, and every file gets one mastering EQ (MASTER_EQ),
// the same for each so they still sum to the mix.
//
// Last, demo.js plays a scripted run through the game's own engine on those files: that is
// out/stonefall-demo.mp3, at a listening level, with what happens when in out/stonefall-demo.txt.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { createServer } from 'vite';
import { BPM, SHOTS, STEMS } from './cues.js';

const here = path.dirname(new URL(import.meta.url).pathname);
const out = path.join(here, 'out');
const wavs = path.join(out, 'wav');
const mp3s = path.join(out, 'music');
fs.mkdirSync(wavs, { recursive: true });
fs.mkdirSync(mp3s, { recursive: true });

// Integrated loudness of the groove in the files. The game plays them at MUSIC.VOLUME through
// the effects' limiter, which puts the music about 5 dB under the effects (they run at -18 LUFS
// in a run); the old soundtrack sat 18 dB under them, and was too quiet.
const GAME_LUFS = -21;
const DEMO_LUFS = -16;
const GROOVE = ['riff', 'drums', 'stabs'];
// Rumble out, the low end down, the top up: phones play little under 200 Hz, and the old
// soundtrack lived in the mids. Linear, so stems EQ'd one by one sum to the EQ'd mix.
const MASTER_EQ = 'highpass=f=55:p=2,lowshelf=f=200:g=-5,highshelf=f=4000:g=3';
// How far each stem dips on the beat (1 would be silence). The kick is on every beat of every
// stem's loop, so a gain curve does what a sidechain would, exactly: in over 4 ms, back over an
// eighth note. The drums and the one-shots are left alone.
const PUMP = { riff: 0.5, stabs: 0.55, arp: 0.4, lead: 0.2, drive: 0.45 };
const pump = (depth) => {
  const beat = (60 / BPM).toFixed(4);
  const dip = `(1-exp(-mod(t\\,${beat})/0.004))*exp(-mod(t\\,${beat})/0.09)`;
  return `aeval='val(ch)*(1-${depth}*${dip})':c=same`;
};

if (!fs.existsSync(path.join(here, 'samples', 'strudel.json'))) {
  throw new Error('no samples yet: run `npm run samples` first');
}

const names = [...STEMS, ...SHOTS.map((s) => s.name)];
const asked = process.argv.slice(2);
const todo = asked.length ? names.filter((n) => asked.includes(n)) : names;

// Its own port, so a REPL left running on the config's port does not stop a render.
const server = await createServer({
  root: here,
  configFile: path.join(here, 'vite.config.js'),
  server: { port: 7490, strictPort: false },
  logLevel: 'warn',
});
await server.listen();
const browser = await puppeteer.launch({
  executablePath:
    process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  protocolTimeout: 600_000,
  args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
});
const ffmpeg = (...args) =>
  execFileSync('ffmpeg', ['-hide_banner', '-nostats', '-y', ...args], { stdio: 'pipe' });
/** Integrated loudness (LUFS) and true peak (dBFS); ffmpeg prints them on stderr. */
const measure = (file) => {
  const { stderr } = spawnSync('ffmpeg', [
    '-hide_banner',
    '-nostats',
    '-i',
    file,
    '-af',
    'ebur128=peak=true',
    '-f',
    'null',
    '-',
  ]);
  const log = stderr.toString().split('Summary:').pop();
  return {
    lufs: Number(/I:\s+(-?[\d.]+) LUFS/.exec(log)?.[1]),
    peak: Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(log)?.[1] ?? -Infinity),
  };
};
const rawOf = (name) => path.join(wavs, `${name}.wav`);
const wavOf = (name) => path.join(wavs, `${name}.eq.wav`);

const page = async (query, label) => {
  const p = await browser.newPage();
  p.on('pageerror', (e) => console.error(`  [${label}] ${e.message}`));
  p.on('console', (m) => m.type() === 'error' && console.error(`  [${label}] ${m.text()}`));
  await p.goto(`${server.resolvedUrls.local[0]}?${query}`);
  await p.waitForFunction(() => window.stonefallReady, { timeout: 60_000 });
  return p;
};
try {
  for (const name of todo) {
    // A fresh page each time: superdough pools audio nodes, and one from the last render's
    // context cannot be connected in the next.
    const p = await page('render', name);
    const started = Date.now();
    const wav = await p.evaluate((n) => window.stonefall.render(n), name);
    fs.writeFileSync(path.join(wavs, `${name}.wav`), Buffer.from(wav, 'base64'));
    console.log(`${name.padEnd(6)} rendered in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    await p.close();
  }
  master();
  await demo();
} finally {
  await browser.close();
  await server.close();
}

/** The rendered WAVs, EQ'd and gained into out/music. */
function master() {
  const missing = names.filter((n) => !fs.existsSync(rawOf(n)));
  if (missing.length) throw new Error(`not rendered yet: ${missing.join(', ')}`);
  for (const name of names) {
    const chain = PUMP[name] ? `${pump(PUMP[name])},${MASTER_EQ}` : MASTER_EQ;
    ffmpeg('-i', rawOf(name), '-af', chain, '-c:a', 'pcm_f32le', wavOf(name));
  }

  /** The named stems summed, as they play together in the game. */
  const sum = (stems, file) => {
    ffmpeg(
      ...stems.flatMap((s) => ['-i', wavOf(s)]),
      '-filter_complex',
      `amix=inputs=${stems.length}:normalize=0`,
      '-c:a',
      'pcm_f32le',
      file
    );
    return file;
  };

  const groove = measure(sum(GROOVE, path.join(wavs, 'groove.wav')));
  const gain = GAME_LUFS - groove.lufs;
  console.log(
    `groove ${groove.lufs} LUFS mastered, peak ${groove.peak} dBFS; gain ${gain.toFixed(1)} dB`
  );
  for (const name of names) {
    const raw = measure(wavOf(name));
    ffmpeg(
      '-i',
      wavOf(name),
      '-af',
      `volume=${gain.toFixed(2)}dB`,
      '-ar',
      '48000',
      '-c:a',
      'libmp3lame',
      '-b:a',
      '128k',
      path.join(mp3s, `${name}.mp3`)
    );
    console.log(
      `${name.padEnd(6)} ${String(raw.lufs).padStart(6)} LUFS mastered, peak ${raw.peak} dBFS -> ${(raw.lufs + gain).toFixed(1)} LUFS in game`
    );
  }
  const everything = measure(sum(STEMS, path.join(wavs, 'everything.wav')));
  console.log(
    `all stems: ${(everything.lufs + gain).toFixed(1)} LUFS in game, peak ${(everything.peak + gain).toFixed(1)} dBFS`
  );
}

/** The scripted run through the game's engine, at a listening level. */
async function demo() {
  const p = await page('demo', 'demo');
  const { wav, notes } = await p.evaluate(() => window.stonefallDemo.render());
  await p.close();
  const raw = path.join(wavs, 'demo.wav');
  fs.writeFileSync(raw, Buffer.from(wav, 'base64'));
  const lift = DEMO_LUFS - measure(raw).lufs;
  ffmpeg(
    '-i',
    raw,
    '-af',
    `volume=${lift.toFixed(2)}dB,alimiter=limit=0.95`,
    '-c:a',
    'libmp3lame',
    '-b:a',
    '192k',
    path.join(out, 'stonefall-demo.mp3')
  );
  fs.writeFileSync(path.join(out, 'stonefall-demo.txt'), notes.join('\n') + '\n');
  console.log(`\nstonefall-demo.mp3, at ${DEMO_LUFS} LUFS:\n${notes.join('\n')}`);
}
