// Plays a run in the game on the play server (:7474), one block at a time, and films it with its
// sound: node combo.mjs [count] [out.mp4]. Headless Chrome on the GPU; the picture is a CDP
// screencast of the page (the HUD included), the sound what the game's audio context plays, and
// the two are lined up by their clocks. After the drops it drops one off the edge, so the run's
// end is in it too. Needs ffmpeg.
//
// The drops are `count` perfects, or PLAN: how far off the middle to drop each block, as a share
// of its width (0 is a perfect), e.g. PLAN=0,0,0,0.15,0.3.
/* global document, window, performance, AudioNode, AudioDestinationNode, AudioContext, MediaRecorder, KeyboardEvent, requestAnimationFrame, FileReader */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const count = Number(process.argv[2] ?? 50);
const out = process.argv[3] ?? `out/stonefall-${count}-combo.mp4`;
const plan = process.env.PLAN ? process.env.PLAN.split(',').map(Number) : Array(count).fill(0);
const work = path.join(path.dirname(out), 'combo-frames');
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  protocolTimeout: 600_000,
  args: [
    '--use-angle=metal',
    '--enable-gpu',
    '--ignore-gpu-blocklist',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: 375, height: 512, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

// Everything the game's audio context sends to the speakers, recorded, with the context's time
// at the recording's start. The context may still be starting then, so that, and not the wall
// clock, is what the recording's first sample is.
await page.evaluateOnNewDocument(() => {
  const connect = AudioNode.prototype.connect;
  const taps = new WeakMap();
  window.__chunks = [];
  AudioNode.prototype.connect = function (dest, ...rest) {
    const r = connect.call(this, dest, ...rest);
    if (dest instanceof AudioDestinationNode && this.context instanceof AudioContext) {
      let tap = taps.get(this.context);
      if (!tap) {
        tap = this.context.createMediaStreamDestination();
        taps.set(this.context, tap);
        const rec = new MediaRecorder(tap.stream, {
          mimeType: 'audio/webm;codecs=opus',
          audioBitsPerSecond: 256000,
        });
        rec.ondataavailable = (e) => e.data.size && window.__chunks.push(e.data);
        rec.start(500);
        window.__rec = rec;
        window.__ctx = this.context;
        window.__recCtx0 = this.context.currentTime;
      }
      connect.call(this, tap);
    }
    return r;
  };
});

await page.goto('http://localhost:7474/', { waitUntil: 'networkidle0', timeout: 60_000 });
await new Promise((r) => setTimeout(r, 2500));
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((el) => /build/i.test(el.textContent));
  if (!b) throw new Error('no Build button');
  b.click();
});

// The picture: every frame the page shows, with the time it was shown.
const cdp = await page.createCDPSession();
const frames = [];
cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
  const file = path.join(work, `f${String(frames.length).padStart(5, '0')}.jpg`);
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  frames.push({ file, t: metadata.timestamp });
  void cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
});
await cdp.send('Page.startScreencast', {
  format: 'jpeg',
  quality: 82,
  everyNthFrame: 1,
  maxWidth: 750,
  maxHeight: 1024,
});

const result = await page.evaluate(
  async ({ plan, minGap }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const frame = () => new Promise((r) => requestAnimationFrame(r));
    const epoch = () => performance.timeOrigin + performance.now();
    // The run's live state, through the canvas's React fiber (both trees: one goes stale).
    const findLive = () => {
      const el = document.querySelector('[data-game-canvas="true"]');
      if (!el) return null;
      const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
      let f = el[key];
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
      await sleep(100);
      live = findLive();
    }
    if (!live?.current?.currentBlock) return { error: 'no live state', log: [] };
    const press = () =>
      window.dispatchEvent(
        new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true })
      );
    // The block's offset from the top along the axis it slides on (the simulation's: x when the
    // count is even), and the perfect band there (a tenth of the top's extent, at least 90).
    const sample = () => {
      const s = live.current;
      const b = s?.currentBlock;
      const top = s?.blocks[s.blocks.length - 1];
      if (!b || !top || s.isGameOver) return null;
      const x = s.blocks.length % 2 === 0;
      const extent = x ? top.width : (top.depth ?? top.width);
      return {
        off: x ? b.x - top.x : (b.z ?? 0) - (top.z ?? 0),
        band: Math.max(90, Math.floor((extent * 100) / 1000)),
        tick: s.tick,
      };
    };
    // A press drops the block where it is on this tick, so for a perfect: inside the band, or
    // about to cross the middle while inside it. Off the middle by `aim` of its width: when it
    // comes in to that point. `edge` drops it at the far end of its sweep.
    const drop = async (edge, aim = 0) => {
      let prev = null;
      for (let i = 0; i < 3000; i++) {
        await frame();
        const o = sample();
        if (!o) return false;
        if (prev && o.tick !== prev.tick) {
          const v = o.off - prev.off;
          const turning = prev.v !== undefined && Math.sign(v) !== Math.sign(prev.v);
          const crossing = Math.sign(o.off) !== Math.sign(o.off + v);
          const inside =
            aim > 0
              ? Math.abs(o.off) < Math.abs(prev.off) &&
                Math.abs(Math.abs(o.off) - aim * o.band * 10) <= o.band * 0.4
              : Math.abs(o.off) <= o.band * 0.45 || (crossing && Math.abs(o.off) <= o.band * 0.8);
          if (v !== 0 && (edge ? turning : inside)) {
            press();
            return { off: o.off, band: o.band };
          }
          prev = { ...o, v };
          continue;
        }
        if (!prev) prev = o;
      }
      return false;
    };
    const log = [];
    for (let k = 1; k <= plan.length; k++) {
      const aim = plan[k - 1];
      const before = live.current.blocks.length;
      if (k > 1) await sleep(minGap * 1000);
      const shot = await drop(false, aim);
      if (!shot) return { error: `drop ${k}: no block`, log };
      const pressed = epoch();
      for (
        let i = 0;
        i < 300 && live.current.blocks.length === before && !live.current.isGameOver;
        i++
      )
        await frame();
      const s = live.current;
      const perfect = !!s.lastPlacement?.noTrim;
      log.push({ k, aim, pressed, landed: epoch(), perfect, blocks: s.blocks.length, ...shot });
      if (s.isGameOver) return { error: `drop ${k} ended the run`, log, fell: epoch() };
      if (aim === 0 && !perfect) return { error: `drop ${k} was not perfect`, log };
    }
    // The end: off the edge until it falls.
    await sleep(2500);
    for (let tries = 0; tries < 6 && !live.current.isGameOver; tries++) {
      await drop(true);
      log.push({ k: 'edge', pressed: epoch(), over: live.current.isGameOver });
      await sleep(900);
    }
    const fell = epoch();
    await sleep(6500);
    return { log, fell, end: epoch() };
  },
  { plan, minGap: 0.9 }
);

await cdp.send('Page.stopScreencast');
const audio = await page.evaluate(
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
// When the recording's first sample is heard, on the clock the frames are stamped with: the
// context says which of its times is output at which moment.
const recEpoch = await page.evaluate(() => {
  const ts = window.__ctx.getOutputTimestamp();
  return performance.timeOrigin + ts.performanceTime + (window.__recCtx0 - ts.contextTime) * 1000;
});
await browser.close();

const webm = out.replace(/\.mp4$/, '.webm');
fs.writeFileSync(webm, Buffer.from(audio, 'base64'));
fs.writeFileSync(out.replace(/\.mp4$/, '.json'), JSON.stringify({ ...result, recEpoch }, null, 1));
if (result.error) console.log('stopped:', result.error);
frames.sort((a, b) => a.t - b.t);
const t0 = frames[0].t;
for (const d of result.log) {
  const at = ((d.landed ?? d.pressed) / 1000 - t0).toFixed(2);
  console.log(
    `${at.padStart(6)}s  ${d.k === 'edge' ? `edge drop${d.over ? ': fell' : ''}` : `drop ${d.k}: ${d.perfect ? 'perfect' : 'trimmed'}`}`
  );
}

// The film: each frame held until the next, at 30 fps, with the sound from the first frame on.
const list = frames
  .map((f, i) => {
    const next = frames[i + 1]?.t ?? f.t + 1 / 30;
    return `file '${path.resolve(f.file)}'\nduration ${Math.max(0.001, next - f.t).toFixed(4)}`;
  })
  .join('\n');
fs.writeFileSync(
  path.join(work, 'list.txt'),
  `${list}\nfile '${path.resolve(frames.at(-1).file)}'\n`
);
const offset = t0 - recEpoch / 1000;
execFileSync('ffmpeg', [
  '-v',
  'error',
  '-y',
  '-f',
  'concat',
  '-safe',
  '0',
  '-i',
  path.join(work, 'list.txt'),
  // The sound starts before the first frame (skip into it) or after it (hold it back).
  ...(offset >= 0 ? ['-ss', offset.toFixed(3)] : ['-itsoffset', (-offset).toFixed(3)]),
  '-i',
  webm,
  '-map',
  '0:v',
  '-map',
  '1:a',
  '-vf',
  'fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p',
  '-c:v',
  'libx264',
  '-crf',
  '20',
  '-preset',
  'medium',
  '-c:a',
  'aac',
  '-b:a',
  '192k',
  '-shortest',
  '-movflags',
  '+faststart',
  out,
]);
if (!process.env.KEEP) fs.rmSync(work, { recursive: true, force: true });
console.log(`${frames.length} frames, sound offset ${offset.toFixed(3)}s; wrote ${out}`);
