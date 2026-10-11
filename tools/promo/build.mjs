// Builds Stonefall's brand and featuring assets into branding/ from the promo stage's presets.
//
//   node tools/promo/build.mjs [only...]      e.g. `node tools/promo/build.mjs icon banners`
//
// Jobs: tile, icon, lockup, banners, featuring (the last from the launch video; featuring.mjs).
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
  async tile() {
    await render('still', 'tile', 560, 256, 1, path.join(featuring, 'tile.png'));
  },
  // The icon is drawn, not rendered (icon.mjs): a render of the game blurs at the 32 px Reddit
  // shows icons at.
  async icon() {
    await run('node', [path.join(here, 'icon.mjs')]);
  },
  async lockup() {
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
  // The featuring video, its GIF fallback and the still all come from the launch video, made
  // with /brag and Hyperframes in brag-output/ (see featuring.mjs).
  async featuring() {
    await run('node', [path.join(here, 'featuring.mjs')]);
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
