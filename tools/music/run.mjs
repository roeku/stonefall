// Plays a real run on the local play server (:7474) in headless Chrome and records what the
// game's audio context outputs: node run.mjs out/run.webm. It plays until the run falls, then waits on the board.
/* global document, window, performance, AudioNode, AudioDestinationNode, AudioContext, MediaRecorder, KeyboardEvent, requestAnimationFrame, FileReader */
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const out = process.argv[2] ?? 'out/run.webm';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  protocolTimeout: 300_000,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
await page.setViewport({ width: 375, height: 512, deviceScaleFactor: 2 });
page.on('console', (m) => {
  const t = m.type();
  if (t === 'error' || t === 'warning' || m.text().startsWith('[rec]')) console.log(`[${t}] ${m.text().slice(0, 300)}`);
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('response', (r) => {
  if (r.url().includes('/music/')) console.log('[fetch]', r.status(), r.url().split('/').pop());
});

if (process.env.NO_MUSIC) {
  await page.setRequestInterception(true);
  page.on('request', (r) => (r.url().includes('/music/') ? r.abort() : r.continue()));
}
await page.evaluateOnNewDocument(() => {
  // Mirror everything that reaches a live context's speakers into a recorder.
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
        const rec = new MediaRecorder(tap.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 192000 });
        rec.ondataavailable = (e) => e.data.size && window.__chunks.push(e.data);
        rec.start(500);
        window.__rec = rec;
        // A meter on what reaches the speakers, before any encoding: the loudest sample, and how
        // many went over full scale.
        const meter = this.context.createScriptProcessor(4096, 2, 2);
        window.__peak = 0;
        window.__over = 0;
        meter.onaudioprocess = (e) => {
          for (let ch = 0; ch < 2; ch++) {
            const d = e.inputBuffer.getChannelData(ch);
            for (let i = 0; i < d.length; i++) {
              const a = Math.abs(d[i]);
              if (a > window.__peak) window.__peak = a;
              if (a > 1) window.__over++;
            }
          }
        };
        const mute = this.context.createGain();
        mute.gain.value = 0;
        meter.connect(mute);
        connect.call(mute, this.context.destination);
        window.__meter = meter;
        window.__t0 = performance.now();
      }
      connect.call(this, tap);
      if (window.__meter) connect.call(this, window.__meter);
    }
    return r;
  };
});

await page.goto('http://localhost:7474/', { waitUntil: 'networkidle0', timeout: 60_000 });
await sleep(2500);
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((el) => /build/i.test(el.textContent));
  if (!b) throw new Error('no Build button');
  b.click();
});

// Drop blocks from inside the page, timed off the run's live state.
const log = await page.evaluate(async () => {
  const sleepP = (ms) => new Promise((r) => setTimeout(r, ms));
  const findLive = () => {
    const el = document.querySelector('[data-game-canvas="true"]');
    if (!el) return null;
    const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
    let f = el[key];
    // React keeps two copies of each fiber; the DOM node may point at the stale one.
    for (let i = 0; f && i < 12; i++, f = f.return) {
      for (const g of [f, f.alternate]) {
        const kids = [].concat(g?.memoizedProps?.children ?? []);
        const scene = kids.find((k) => k && k.props && k.props.liveState);
        if (scene) return scene.props.liveState;
      }
    }
    return null;
  };
  let live = null;
  for (let i = 0; i < 100 && !live?.current?.currentBlock; i++) {
    await sleepP(100);
    live = findLive();
  }
  if (!live?.current?.currentBlock) return ['no live state: ' + document.body.innerText.replace(/\s+/g, ' ').slice(0, 200)];
  const events = [];
  const now = () => ((performance.now() - (window.__t0 ?? performance.now())) / 1000).toFixed(1);
  events.push(`${now()}s run started`);
  const offset = () => {
    const s = live.current;
    const b = s?.currentBlock;
    const top = s?.blocks[s.blocks.length - 1];
    if (!b || !top) return null;
    return { d: b.x - top.x + ((b.z ?? 0) - (top.z ?? 0)), w: Math.min(b.width, b.depth ?? b.width) };
  };
  const press = () => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }));
  // Waits for the block to sweep to `aim` (a share of its width, 0 = flush), then drops it.
  const dropAt = async (aim) => {
    await sleepP(700);
    let prev = offset();
    for (let i = 0; i < 600; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      const o = offset();
      if (!o || !prev) { prev = o; continue; }
      const v = o.d - prev.d;
      // 'edge': at the end of the sweep, where the block is furthest off the tower.
      if (aim === 'edge') {
        if (Math.abs(o.d) > o.w * 0.6 && v * (prev.v ?? v) < 0) { press(); break; }
        prev = { ...o, v };
        continue;
      }
      const target = aim * o.w;
      // Crossing the target this frame or the next: drop now.
      if ((o.d - target) * (o.d + v - target) <= 0 && Math.abs(v) > 0) {
        press();
        break;
      }
      prev = o;
    }
    await sleepP(80);
    const s = live.current;
    const p = s?.lastPlacement;
    const b = s?.currentBlock;
    const size = b ? (Math.min(b.width, b.depth ?? b.width) / 8000).toFixed(2) : '-';
    const said = /New best|Passed/.exec(document.body.innerText)?.[0];
    events.push(`${now()}s drop ${s?.blocks.length ?? '?'} aim ${aim}: ${s?.isGameOver ? 'GAME OVER' : p?.noTrim ? 'perfect' : 'trimmed'}, size ${size}${said ? ' [' + said + ']' : ''}`);
    return s?.isGameOver;
  };
  const plan = [0.2, 0.15, 0, 0, 0, 0, 0, 0, 0, 0.12, 0.15, 0.2, 0.2, 0.25, 0.25, 0, 0, 0, 0.3, 0.3, 0.3, 0.35, 0.35, 0.35, 0.35, 0.35, 'edge', 'edge', 'edge', 'edge', 'edge'];
  for (const aim of plan) {
    if (await dropAt(aim)) break;
  }
  return events;
});
console.log(log.join('\n'));
// The derez, the aftermath, the board, and the fade.
for (let i = 0; i < 28; i++) {
  await sleep(1000);
  const where = await page.evaluate(() => (/RAISE|Again/i.test(document.body.innerText) ? 'board' : 'run'));
  if (i % 4 === 0) console.log(`+${i}s after the fall: ${where}`);
}
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
console.log(await page.evaluate(() => `true peak ${(20 * Math.log10(window.__peak)).toFixed(2)} dBFS, ${window.__over} samples over full scale`));
console.log('wrote', out);
await page.screenshot({ path: out.replace(/\.webm$/, '-end.png') });
await browser.close();
