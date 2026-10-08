// Builds Stonefall's brand and featuring assets into branding/ from the promo stage's presets.
//
//   node tools/promo/build.mjs [only...]      e.g. `node tools/promo/build.mjs icon video`
//
// Starts the stage on :7476 itself. Needs Chrome, puppeteer-core (`npm i --no-save
// puppeteer-core`), ffmpeg, and python3 with Pillow and numpy (for the GIF). See README.md.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';

const here = import.meta.dirname;
const repo = path.resolve(here, '../..');
const out = path.join(here, 'out');
const brand = path.join(repo, 'branding');
const featuring = path.join(brand, 'featuring');
const banners = path.join(brand, 'banners');
for (const dir of [out, featuring, banners]) fs.mkdirSync(dir, { recursive: true });

// Children run asynchronously: the stage is served from this process, so blocking it would leave
// the browser waiting on a server that cannot answer.
let stageUrl = '';
const run = (cmd, args, env = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: 'inherit',
      env: { ...process.env, STAGE_URL: stageUrl, ...env },
    });
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} failed`))
    );
  });
const render = (mode, preset, cssW, cssH, dpr, dest, ...rest) =>
  run(
    'node',
    [path.join(here, 'render.mjs'), mode, preset, String(cssW), String(cssH), dest, ...rest],
    {
      DPR: String(dpr),
    }
  );
const ffmpeg = (...args) => run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
/** Crops/scales a PNG to an exact size with ffmpeg (Lanczos). */
const fit = (src, dest, w, h, crop = true) =>
  ffmpeg(
    '-i',
    src,
    '-vf',
    `${crop ? `crop=min(iw\\,ceil(ih*${w}/${h})):min(ih\\,ceil(iw*${h}/${w})):0:0,` : ''}scale=${w}:${h}:flags=lanczos`,
    dest
  );

const jobs = {
  // The game draws at 1.5x on any retina screen or phone (App.tsx caps it there), so stills are
  // rendered at a CSS size that comes out at the asset's pixel size at that ratio.
  async featured() {
    await render('still', 'featured', 1000, 667, 1.5, path.join(out, 'featured.png'));
    await fit(path.join(out, 'featured.png'), path.join(featuring, 'featured.png'), 1500, 1000);
  },
  async tile() {
    await render('still', 'tile', 560, 256, 1, path.join(featuring, 'tile.png'));
  },
  async icon() {
    // At 512 the rims and edges keep the weight they have on a phone, which is what lets the icon
    // read at 64 px; the 1024 upload is that render, scaled.
    await render('still', 'app-icon', 512, 512, 1, path.join(out, 'icon-512.png'));
    await fit(path.join(out, 'icon-512.png'), path.join(brand, 'icon.png'), 1024, 1024, false);
    await fit(
      path.join(out, 'icon-512.png'),
      path.join(brand, 'community-icon.png'),
      256,
      256,
      false
    );
  },
  async lockup() {
    if (!fs.existsSync(path.join(out, 'icon-512.png'))) await jobs.icon();
    await render('still', 'lockup', 1067, 320, 1.5, path.join(out, 'logo.png'));
    await fit(path.join(out, 'logo.png'), path.join(brand, 'logo.png'), 1600, 480);
  },
  async banners() {
    await render('still', 'banner-strip', 1440, 171, 1.5, path.join(out, 'banner-strip.png'));
    await fit(
      path.join(out, 'banner-strip.png'),
      path.join(banners, 'banner-2160x256.png'),
      2160,
      256
    );
    await render('still', 'banner-wide', 1280, 256, 1.5, path.join(banners, 'banner-1920x384.png'));
    await render('still', 'banner-tall', 1067, 320, 1.5, path.join(out, 'banner-tall.png'));
    await fit(
      path.join(out, 'banner-tall.png'),
      path.join(banners, 'banner-1600x480.png'),
      1600,
      480
    );
  },
  async video() {
    const frames = path.join(out, 'video');
    fs.rmSync(frames, { recursive: true, force: true });
    await render('frames', 'video', 1000, 667, 1.5, frames, '30', '12');
    // 1200 x 800 (inside Reddit's 1000-1500 width) keeps the edges crisper than 1500 does at the
    // same bitrate, and the bitrate is what the 3 MB cap allows for twelve seconds.
    const vf = 'crop=1500:1000:0:0,scale=1200:800:flags=lanczos';
    const common = [
      '-framerate',
      '30',
      '-i',
      path.join(frames, '%05d.png'),
      '-vf',
      vf,
      '-c:v',
      'libx264',
      '-preset',
      'veryslow',
      '-tune',
      'animation',
      '-b:v',
      '1850k',
      '-profile:v',
      'high',
      '-level',
      '4.0',
      '-pix_fmt',
      'yuv420p',
      '-an',
    ];
    const log = path.join(out, 'x264');
    await ffmpeg(...common, '-pass', '1', '-passlogfile', log, '-f', 'mp4', '/dev/null');
    await ffmpeg(
      ...common,
      '-maxrate',
      '3500k',
      '-bufsize',
      '3600k',
      '-pass',
      '2',
      '-passlogfile',
      log,
      '-movflags',
      '+faststart',
      path.join(featuring, 'featured.mp4')
    );
  },
  async gif() {
    // Ten frames a second over one loop of eight drops: 45 frames, rendered so the 46th would be
    // the first again. The tile threshold and a 128-colour palette bring it under 2 MB.
    const frames = path.join(out, 'loop');
    const held = path.join(out, 'loop-held');
    for (const d of [frames, held]) fs.rmSync(d, { recursive: true, force: true });
    // 1002 x 668: exactly 3:2, and over the 1000 px minimum width.
    await render('frames', 'fallback-loop', 1002, 668, 1, frames, String(45 / 4.5467), '4.5467');
    await run('python3', ['-I', path.join(here, 'gifprep.py'), frames, held, '9', '8']);
    const pal = path.join(out, 'palette.png');
    await ffmpeg(
      '-framerate',
      '10',
      '-i',
      path.join(held, '%05d.png'),
      '-vf',
      'palettegen=max_colors=128:stats_mode=full',
      pal
    );
    await ffmpeg(
      '-framerate',
      '10',
      '-i',
      path.join(held, '%05d.png'),
      '-i',
      pal,
      '-lavfi',
      'paletteuse=dither=none:diff_mode=rectangle',
      '-loop',
      '0',
      path.join(featuring, 'featured-fallback.gif')
    );
  },
};

/** Re-saves every PNG in branding/ losslessly at maximum compression (featured.png fits 800 KB). */
const optimize = () =>
  run('python3', [
    '-I',
    '-c',
    `import glob\nfrom PIL import Image\nfor p in glob.glob(${JSON.stringify(brand)} + '/**/*.png', recursive=True):\n    im = Image.open(p); im.load(); im.save(p, optimize=True, compress_level=9)`,
  ]);

const only = process.argv.slice(2);
const server = await createServer({
  configFile: path.join(here, 'vite.config.ts'),
  logLevel: 'error',
  // Its own port, so a stage already open on 7476 for previewing is left alone.
  server: { port: 7477, strictPort: false },
});
await server.listen();
stageUrl = server.resolvedUrls.local[0];
try {
  for (const [name, job] of Object.entries(jobs)) {
    if (only.length && !only.includes(name)) continue;
    console.log(`== ${name}`);
    await job();
  }
  await optimize();
} finally {
  await server.close();
}
