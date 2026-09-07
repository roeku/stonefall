// Headless screenshot harness for the local Vite play server.
//
// Drives the game in a headless Chrome at an exact viewport -- a Reddit inline post on a phone
// is roughly 375 x 512 -- and saves PNGs, so a change can be *seen* at the size it ships at
// without a device, an upload, or the Browser pane. Taps go through the touchscreen when the
// viewport is phone-sized, so the same input path Reddit uses is what gets tested.
//
// One-time setup (not a project dependency; install it where you run this from):
//   npm i --no-save puppeteer-core
// Then, with `npm run play` serving on :7474:
//   node tools/shoot.mjs 375 512 "wait:3500;;shot:plot;;radio:community;;wait:3500;;shot:city"
//
// Steps are separated by ";;" so a js: step may contain semicolons.
//   wait:ms            pause
//   shot:name          save shots/name.png next to this script
//   tap:x,y            touch tap (phone viewport) or mouse click
//   radio:label        click a role=radio by its text (the scope switch)
//   button:label       click a button by text or aria-label ("Build a tower", "Zoom in")
//   js:expression      evaluate in the page; a returned promise is awaited, the value printed
//   until:selector,ms  wait until a selector exists (e.g. .hud--over, .board-chrome)
//   gone:selector,ms   wait until a selector is gone
//   key:Key            press a key
/* global document */ // used only inside page.evaluate callbacks, which run in the page
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const [, , w, h, ...rest] = process.argv;
const width = Number(w);
const height = Number(h);
const steps = rest
  .join(' ')
  .split(';;')
  .map((s) => s.trim())
  .filter(Boolean);
const mobile = width < 700;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  // Override with CHROME=/path/to/chrome on another machine.
  executablePath:
    process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: [
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--enable-webgl',
    '--no-sandbox',
    '--hide-scrollbars',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const page = await browser.newPage();
await page.setViewport({ width, height, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile });
page.on('console', (m) => {
  const t = m.type();
  if (t === 'error' || t === 'warning') console.log(`[console.${t}] ${m.text().slice(0, 300)}`);
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('response', (r) => {
  if (r.status() >= 400) console.log('[http', r.status() + ']', r.url());
});
const shotsDir = path.join(import.meta.dirname, 'shots');
fs.mkdirSync(shotsDir, { recursive: true });
await page.goto(process.env.PLAY_URL ?? 'http://localhost:7474/', {
  waitUntil: 'networkidle0',
  timeout: 60_000,
});

for (const step of steps) {
  const i = step.indexOf(':');
  const op = step.slice(0, i);
  const arg = step.slice(i + 1);
  if (op === 'wait') await sleep(Number(arg));
  else if (op === 'shot') {
    const file = path.join(shotsDir, `${arg}.png`);
    await page.screenshot({ path: file });
    console.log('shot', file);
  } else if (op === 'tap') {
    const [x, y] = arg.split(',').map(Number);
    if (mobile) await page.touchscreen.tap(x, y);
    else await page.mouse.click(x, y);
  } else if (op === 'radio') {
    await page.evaluate((label) => {
      const b = [...document.querySelectorAll('[role=radio]')].find(
        (el) => el.textContent.trim().toLowerCase() === label.toLowerCase()
      );
      if (b) b.click();
      else throw new Error('no radio ' + label);
    }, arg);
  } else if (op === 'button') {
    await page.evaluate((label) => {
      const b = [...document.querySelectorAll('button')].find((el) =>
        (el.textContent.trim() + ' ' + (el.getAttribute('aria-label') || ''))
          .toLowerCase()
          .includes(label.toLowerCase())
      );
      if (b) b.click();
      else throw new Error('no button ' + label);
    }, arg);
  } else if (op === 'js') {
    const out = await page.evaluate(arg);
    console.log('js ->', JSON.stringify(out));
  } else if (op === 'until') {
    // until:selector,timeoutMs -- wait for a selector to exist.
    const [sel, ms] = arg.split(',');
    try {
      await page.waitForSelector(sel, { timeout: Number(ms || 15000) });
      console.log('until ok', sel);
    } catch {
      console.log('until TIMEOUT', sel);
    }
  } else if (op === 'gone') {
    const [sel, ms] = arg.split(',');
    try {
      await page.waitForSelector(sel, { hidden: true, timeout: Number(ms || 15000) });
      console.log('gone ok', sel);
    } catch {
      console.log('gone TIMEOUT', sel);
    }
  } else if (op === 'key') await page.keyboard.press(arg);
  else console.log('unknown step', step);
}
await browser.close();
