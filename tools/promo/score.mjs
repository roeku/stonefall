// Renders the game's own music for a video from a list of timed events (score.ts), offline.
//
// With the stage served on :7476:
//   node tools/promo/score.mjs <spec.json> <out.wav>
// spec.json: { "seconds": 15, "events": [{ "t": 0, "kind": "start", "blocks": 57 }, ...] }
//
// Needs puppeteer-core (`npm i --no-save puppeteer-core`).
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const [, , specPath, out] = process.argv;
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
const browser = await puppeteer.launch({
  executablePath:
    process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  protocolTimeout: 600_000,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}]`, m.text());
  });
  await page.goto(`${process.env.STAGE_URL ?? 'http://localhost:7476/'}score.html`, {
    waitUntil: 'load',
  });
  await page.waitForFunction(() => typeof window.renderScore === 'function', { timeout: 60_000 });
  const b64 = await page.evaluate((s) => window.renderScore(s), spec);
  fs.writeFileSync(out, Buffer.from(b64, 'base64'));
  console.log('score', out, `${spec.seconds}s`, `${spec.events.length} events`);
} finally {
  await browser.close();
}
