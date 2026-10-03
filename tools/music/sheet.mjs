// Plays every effect the game has, in the game's own audio code on the play server (:7474), and
// records what reaches the speakers: node sheet.mjs out/sheet.webm (PLAN=other-plan.js to change it)
// Writes out.json beside it: each cue's label and its time in the recording.
/* global document, window, performance, AudioNode, AudioDestinationNode, AudioContext, MediaRecorder, FileReader */
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const out = process.argv[2] ?? 'out/sheet.webm';
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  protocolTimeout: 300_000,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
await page.setViewport({ width: 375, height: 512, deviceScaleFactor: 1 });
page.on('console', (m) => {
  const t = m.type();
  if (t === 'error' || m.text().startsWith('[sheet]')) console.log(`[${t}] ${m.text().slice(0, 300)}`);
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.evaluateOnNewDocument(() => {
  const taps = new WeakMap();
  const connect = AudioNode.prototype.connect;
  window.__chunks = [];
  window.__t0 = null;
  AudioNode.prototype.connect = function (dest, ...rest) {
    const r = connect.call(this, dest, ...rest);
    if (dest instanceof AudioDestinationNode && this.context instanceof AudioContext) {
      let tap = taps.get(this.context);
      if (!tap) {
        tap = this.context.createMediaStreamDestination();
        taps.set(this.context, tap);
        const rec = new MediaRecorder(tap.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 256000 });
        rec.ondataavailable = (e) => e.data.size && window.__chunks.push(e.data);
        rec.start(500);
        window.__rec = rec;
        window.__ctx = this.context;
        window.__t0 = this.context.currentTime;
      }
      connect.call(this, tap);
    }
    return r;
  };
});

await page.goto('http://localhost:7474/', { waitUntil: 'networkidle0', timeout: 60_000 });
await new Promise((r) => setTimeout(r, 2000));

const cues = await page.evaluate(async (planSrc) => {
  const url = (name) =>
    performance
      .getEntriesByType('resource')
      .map((e) => e.name)
      .find((n) => n.includes(`/components/audio/${name}`));
  const { AudioPlayer } = await import(url('AudioPlayer.ts'));
  const music = await import(url('music.ts'));
  const { MusicManager } = music;
  AudioPlayer.unlock();
  const ctx = AudioPlayer.context();
  await ctx.resume();
  // Make sure the recorder exists before the first cue: a silent blip.
  AudioPlayer.playTap(1);
  await new Promise((r) => setTimeout(r, 1500));
  const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
  const cues = [];
  const mark = (label) => cues.push({ label, t: ctx.currentTime - window.__t0 });
  const S = { blocks: 1, perfectStreak: 0, missStreak: 0 };
  const signals = (over = {}) => ({
    scene: 'run',
    mode: 'solo',
    size: 1,
    myTurn: false,
    celebrating: false,
    ...S,
    ...over,
  });
  const land = (perfect = false, mode = 'solo') => {
    S.blocks++;
    S.perfectStreak = perfect ? S.perfectStreak + 1 : 0;
    MusicManager.update(signals({ mode }));
  };
  // eslint-disable-next-line no-new-func
  const plan = new Function('AudioPlayer', 'MusicManager', 'music', 'mark', 'sleep', 'land', 'signals', 'S', `return (async () => { ${planSrc} })()`);
  await plan(AudioPlayer, MusicManager, music, mark, sleep, land, signals, S);
  mark('end');
  return cues;
}, fs.readFileSync(process.env.PLAN ?? new URL('./sheet-plan.js', import.meta.url), 'utf8'));

const b64 = await page.evaluate(
  () =>
    new Promise((resolve) => {
      window.__rec.onstop = () => {
        const blob = new Blob(window.__chunks, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.readAsDataURL(blob);
      };
      window.__rec.stop();
    })
);
fs.writeFileSync(out, Buffer.from(b64, 'base64'));
fs.writeFileSync(out.replace(/\.webm$/, '.json'), JSON.stringify(cues, null, 1));
for (const c of cues) console.log(`${c.t.toFixed(2).padStart(6)}s ${c.label}`);
console.log('wrote', out);
await browser.close();
