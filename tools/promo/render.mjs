// Renders the promo stage (stage.ts) in headless Chrome on the GPU.
//
// With the stage served on :7476 (`npx vite --config tools/promo/vite.config.ts`):
//   node tools/promo/render.mjs still  <scene> <w> <h> <out.png> [k=v ...]
//   node tools/promo/render.mjs frames <scene> <w> <h> <dir> <fps> <seconds> [k=v ...]
//   node tools/promo/render.mjs times  <scene> <w> <h> <dir> <t1,t2,...> [k=v ...]
// Extra k=v pairs are passed to the stage as URL parameters. `frames` writes dir/00000.png...
// one frame per 1/fps of stage time, however long each takes to draw.
//
// Needs puppeteer-core (not a project dependency): `npm i --no-save puppeteer-core`.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const [, , mode, sceneName, w, h, out, ...rest] = process.argv;
const width = Number(w);
const height = Number(h);
const kv = [];
let fps = 30;
let seconds = 0;
let times = [];
if (mode === 'frames') {
  fps = Number(rest.shift());
  seconds = Number(rest.shift());
}
if (mode === 'times') times = rest.shift().split(',').map(Number);
for (const pair of rest) kv.push(pair);
const params = new URLSearchParams({ scene: sceneName, w: String(width), h: String(height) });
// DPR=1.5 renders the way the game draws on a retina screen or phone: the canvas at 1.5x its CSS
// size (App.tsx caps it there). The screenshot is then the drawing buffer, pixel for pixel.
const dpr = Number(process.env.DPR ?? 1);
for (const pair of kv) {
  const i = pair.indexOf('=');
  params.set(pair.slice(0, i), pair.slice(i + 1));
}
const url = `${process.env.STAGE_URL ?? 'http://localhost:7476/'}${process.env.PAGE ?? ''}?${params}`;

const browser = await puppeteer.launch({
  executablePath:
    process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  protocolTimeout: 600_000,
  args: [
    '--use-angle=metal',
    '--enable-gpu',
    '--ignore-gpu-blocklist',
    '--enable-webgl',
    '--no-sandbox',
    '--hide-scrollbars',
    '--force-color-profile=srgb',
  ],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: dpr });
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}]`, m.text());
  });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(url, { waitUntil: 'load', timeout: 120_000 });
  await page.waitForFunction(() => window.stage !== undefined, { timeout: 120_000 });
  await page.evaluate(() => window.stage.ready);
  console.log('info', JSON.stringify(await page.evaluate(() => window.stage.info)));
  if (mode === 'still') {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await page.screenshot({ path: out });
    console.log('still', out);
  } else if (mode === 'frames') {
    fs.mkdirSync(out, { recursive: true });
    const total = Math.round(fps * seconds);
    const t0 = Date.now();
    for (let i = 0; i < total; i++) {
      await page.evaluate((t) => window.stage.frame(t), i / fps);
      await page.screenshot({ path: path.join(out, `${String(i).padStart(5, '0')}.png`) });
      if (i % 30 === 0)
        console.log(`frame ${i}/${total} ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    }
    console.log('frames', total, out);
  } else if (mode === 'times') {
    // A few moments of a timeline, for review: dir/t-<seconds>.png
    fs.mkdirSync(out, { recursive: true });
    for (const t of times) {
      await page.evaluate((x) => window.stage.frame(x), t);
      const file = path.join(out, `t-${t.toFixed(2)}.png`);
      await page.screenshot({ path: file });
      console.log('time', file);
    }
  } else throw new Error(`unknown mode ${mode}`);
} finally {
  await browser.close();
}
