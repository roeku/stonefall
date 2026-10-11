// Reddit's featuring set, from the launch video (brag-output/, made with /brag and Hyperframes):
//
//   branding/featuring/featured.mp4           the video under the 3 MB cap: 1200 x 800, two-pass,
//                                             silent
//   branding/featuring/featured-fallback.gif  the fallback: the poster, the hook's word tower as
//                                             the drops land, then ORBIT, under 2 MB
//   branding/featuring/featured.png           the poster (the video's end card), lossless
//   branding/featuring/featured.jpg           the same, q95, under Reddit's 800 KB guideline
//
//   node tools/promo/featuring.mjs
//
// Needs brag-output/brag.mp4 (its frame 0 is the poster), brag-output/composition (a lossless
// poster comes from a Hyperframes snapshot of it), ffmpeg, and python3 with Pillow and numpy.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const here = import.meta.dirname;
const repo = path.resolve(here, '../..');
const brag = path.join(repo, 'brag-output');
const video = path.join(brag, 'brag.mp4');
const composition = path.join(brag, 'composition');
const featuring = path.join(repo, 'branding', 'featuring');
const out = path.join(here, 'out', 'featuring');
for (const f of [video, composition])
  if (!fs.existsSync(f)) throw new Error(`${f} is missing: render the /brag video first`);
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

// The poster is the end card at its closest (brag-output/brag.jpg is the same frame).
const POSTER_AT = 14.9;
// ORBIT and "108 perfect in a row", settled, before the ladder fades.
const ORBIT_AT = 6.4;
// The hook: from the frame after the poster to just after TRUE lands (3.39 s is its last pulse).
const HOOK = { from: 1 / 30, to: 3.33 };

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });
const ffmpeg = (...args) => run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
const size = (f) => fs.statSync(f).size;

// The still: a lossless snapshot of the composition, not a frame of the encoded video.
run('npx', ['--yes', 'hyperframes@0.8.140', 'snapshot', '--at', String(POSTER_AT)], {
  cwd: composition,
});
const snap = path.join(composition, 'snapshots', `frame-00-at-${POSTER_AT}s.png`);
fs.copyFileSync(snap, path.join(featuring, 'featured.png'));
// The city's detail keeps the lossless PNG over Reddit's 800 KB guideline (it is under the 3 MB
// cap); a q95 JPEG of it is under, and matches it even at 2x. A 256-colour PNG would fit but
// posterises the glow.
run('python3', [
  '-I',
  '-c',
  'import sys\nfrom PIL import Image\nImage.open(sys.argv[1]).convert("RGB").save(sys.argv[2], quality=95, subsampling=0, optimize=True, progressive=True)',
  snap,
  path.join(featuring, 'featured.jpg'),
]);

// The video: 1200 x 800 keeps edges crisper than 1500 x 1000 at the bitrate 3 MB allows for 15 s,
// and matches what a phone at 3x draws for a full-width card. Cut 50 ms short of 15 s, so that
// no rounding puts it over Reddit's limit. -tune animation scored best for flat, hard-edged CG.
const encode = [
  '-i',
  video,
  '-t',
  '14.95',
  '-vf',
  'scale=1200:800:flags=lanczos',
  '-c:v',
  'libx264',
  '-preset',
  'veryslow',
  '-tune',
  'animation',
  '-x264-params',
  'aq-mode=3',
  '-b:v',
  '1400k',
  '-profile:v',
  'high',
  '-level',
  '4.0',
  '-pix_fmt',
  'yuv420p',
];
const log = path.join(out, 'x264');
ffmpeg(...encode, '-pass', '1', '-passlogfile', log, '-an', '-f', 'mp4', '/dev/null');
ffmpeg(
  ...encode,
  '-pass',
  '2',
  '-passlogfile',
  log,
  '-an',
  '-movflags',
  '+faststart',
  path.join(featuring, 'featured.mp4')
);

// The GIF: 1002 x 668 is exactly 3:2 and just over the 1000 px minimum. The run camera never
// settles, so every frame differs; 8 fps, a feathered tile hold (gifprep.py), one 128-colour
// palette and ordered dithering (stable from frame to frame, unlike error diffusion, so held
// tiles stay identical) fit it under 2 MB. The poster is frame 0, so the GIF's still is the
// video's, and it is the loop's last beat too.
const scale = 'scale=1002:668:flags=area';
const raw = path.join(out, 'hook');
const held = path.join(out, 'held');
fs.mkdirSync(raw);
ffmpeg('-ss', String(HOOK.from), '-i', video, '-t', String(HOOK.to - HOOK.from), '-vf', `fps=8,${scale}`, path.join(raw, '%05d.png'));
ffmpeg('-ss', String(POSTER_AT), '-i', video, '-frames:v', '1', '-vf', scale, path.join(out, 'poster.png'));
ffmpeg('-ss', String(ORBIT_AT), '-i', video, '-frames:v', '1', '-vf', scale, path.join(out, 'orbit.png'));
run('python3', ['-I', path.join(here, 'gifprep.py'), raw, held, '24', '8', '3', '3']);
const frames = [
  ['poster.png', 2.2],
  ...fs.readdirSync(held).sort().map((f) => [path.join('held', f), 0.125]),
  ['orbit.png', 1.3],
];
const list = path.join(out, 'list.txt');
fs.writeFileSync(
  list,
  ['ffconcat version 1.0', ...frames.flatMap(([f, d]) => [`file '${path.join(out, f)}'`, `duration ${d}`]), `file '${path.join(out, 'orbit.png')}'`].join('\n')
);
const palette = path.join(out, 'palette.png');
ffmpeg('-f', 'concat', '-safe', '0', '-i', list, '-vf', 'palettegen=max_colors=128:stats_mode=full', palette);
ffmpeg(
  '-f',
  'concat',
  '-safe',
  '0',
  '-i',
  list,
  '-i',
  palette,
  '-lavfi',
  'paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle',
  '-loop',
  '0',
  path.join(featuring, 'featured-fallback.gif')
);

for (const f of ['featured.mp4', 'featured-fallback.gif', 'featured.png', 'featured.jpg'])
  console.log(f.padEnd(24), `${(size(path.join(featuring, f)) / 1e6).toFixed(2)} MB`);
