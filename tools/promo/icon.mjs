// The app and community icon: a vector drawing, not a render. A render of the game turns into a
// glowing blob at the 32 px Reddit shows icons at; an exact axonometric drawing keeps its edges.
//
//   node tools/promo/icon.mjs
//
// Writes branding/icon.svg (the source), branding/icon.png (1024, devvit.json's icon) and
// branding/community-icon.png (256, drawn at that size rather than scaled down). Needs Chrome
// and puppeteer-core.
//
// The picture is the game's camera, which follows the top of the tower: a tall column rising out
// of the frame, its last course just landed flush. As in the game, the seam flashes white and a
// square ring spreads from the landing; the ring is in the gold the streak callouts turn, so
// white stays the one event and the ring reads as what it earned.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const repo = path.resolve(import.meta.dirname, '../..');
const puppeteer = createRequire(path.join(repo, 'package.json'))('puppeteer-core');
const brand = path.join(repo, 'branding');

const N = 1024;
const C30 = Math.cos(Math.PI / 6);
const f2 = (v) => v.toFixed(2);
const pts = (arr) => arr.map(([a, b]) => `${f2(a)},${f2(b)}`).join(' ');

// Isometric: x runs right-down, z left-down, y up; u pixels to a block's width.
const U = 262;
const H = 0.3; // a course's height, in block widths
const COURSES = 9; // enough to run out of the frame
const TOP = COURSES * H;
const SEAM = TOP - H;
const P = (x, y, z) => [N / 2 + (x - z) * C30 * U, 268 + TOP * U - y * U + (x + z) * 0.5 * U];

// Faces: lit top, the turned (+z) face, the (+x) face in shadow; then the edge light.
const LANDED = {
  top: ['#dafeff', '#98f8fe'],
  left: ['#48eaf7', '#1ed2e3'],
  right: ['#159fb8', '#0b7891'],
  rim: '#ffffff',
  edge: '#bdf9ff',
};
const TOWER = {
  top: ['#7ff6fd', '#3fe3f0'],
  left: ['#13a8bf', '#0b8398'],
  right: ['#07607a', '#04435a'],
  rim: '#8ff2fb',
  edge: '#4fd8ea',
};
const GOLD = '#ffd166';

const defs = [];
let gid = 0;
const grad = ([a, b]) => {
  const id = `g${gid++}`;
  defs.push(
    `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`
  );
  return `url(#${id})`;
};

/** One course: its three visible faces, the top's outline and the front corner in edge light. */
const course = (y0, y1, pal, rimA) => {
  const V = (i, j, k) => P(i, j ? y1 : y0, k);
  const top = [V(0, 1, 0), V(1, 1, 0), V(1, 1, 1), V(0, 1, 1)];
  const right = [V(1, 0, 0), V(1, 1, 0), V(1, 1, 1), V(1, 0, 1)];
  const left = [V(0, 0, 1), V(1, 0, 1), V(1, 1, 1), V(0, 1, 1)];
  return (
    `<polygon points="${pts(left)}" fill="${grad(pal.left)}"/>` +
    `<polygon points="${pts(right)}" fill="${grad(pal.right)}"/>` +
    `<polygon points="${pts(top)}" fill="${grad(pal.top)}"/>` +
    `<polygon points="${pts(top)}" fill="none" stroke="${pal.rim}" stroke-width="7" stroke-linejoin="round" opacity="${rimA}"/>` +
    `<polyline points="${pts([V(1, 0, 1), V(1, 1, 1)])}" stroke="${pal.edge}" stroke-width="5.6" stroke-linecap="round" opacity="0.9"/>`
  );
};

const svg = () => {
  // The tower falls away into the night below the landing, as the game's fog takes it.
  const fadeFrom = P(0, TOP, 0)[1] + 0.9 * U;
  let tower = '';
  for (let i = 0; i < COURSES - 1; i++) tower += course(i * H, (i + 1) * H, TOWER, 0.7);
  const landed = course(SEAM, TOP, LANDED, 0.95);

  // The landing ring, at the seam, 1.78 times the block: the whole square behind the column and
  // its near half again in front, so it passes behind the tower and before it.
  const h = 1.78 / 2;
  const r = [P(0.5 - h, SEAM, 0.5 - h), P(0.5 + h, SEAM, 0.5 - h), P(0.5 + h, SEAM, 0.5 + h), P(0.5 - h, SEAM, 0.5 + h)];
  const ringBack = `<polygon points="${pts(r)}" fill="none" stroke="${GOLD}" stroke-width="12"/>`;
  const ringFront = `<polyline points="${pts([r[1], r[2], r[3]])}" fill="none" stroke="${GOLD}" stroke-width="12"/>`;

  const seam = [P(0, SEAM, 1), P(1, SEAM, 1), P(1, SEAM, 0)];
  const flash =
    `<polyline points="${pts(seam)}" fill="none" stroke="#ffffff" stroke-width="22" stroke-linejoin="round" stroke-linecap="round" filter="url(#soft)"/>` +
    `<polyline points="${pts(seam)}" fill="none" stroke="#ffffff" stroke-width="11" stroke-linejoin="round" stroke-linecap="round"/>`;

  const [gx, gy] = P(0.5, SEAM, 0.5);
  const glow = `<ellipse cx="${f2(gx)}" cy="${f2(gy)}" rx="${f2(1.25 * U)}" ry="${f2(0.95 * U)}" fill="#00f2fe" opacity="0.34" filter="url(#bloom)"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${N}" height="${N}" viewBox="0 0 ${N} ${N}">
  <defs>
    <radialGradient id="night" cx="0.5" cy="0.46" r="0.62"><stop offset="0" stop-color="#0b2534"/><stop offset="0.55" stop-color="#03111f"/><stop offset="1" stop-color="#000814"/></radialGradient>
    <linearGradient id="fadeG" gradientUnits="userSpaceOnUse" x1="0" y1="${f2(fadeFrom)}" x2="0" y2="${N}"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0.7"/></linearGradient>
    <mask id="fade" maskUnits="userSpaceOnUse" x="0" y="0" width="${N}" height="${N}"><rect width="${N}" height="${N}" fill="url(#fadeG)"/></mask>
    <filter id="bloom" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="26"/></filter>
    <filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="9"/></filter>
    ${defs.join('\n    ')}
  </defs>
  <rect width="${N}" height="${N}" fill="url(#night)"/>
  ${glow}
  ${ringBack}
  <g mask="url(#fade)">${tower}</g>
  ${landed}
  ${flash}
  ${ringFront}
</svg>
`;
};

const source = svg();
fs.writeFileSync(path.join(brand, 'icon.svg'), source);
const browser = await puppeteer.launch({
  executablePath:
    process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
try {
  const page = await browser.newPage();
  for (const [file, size] of [
    ['icon.png', 1024],
    ['community-icon.png', 256],
  ]) {
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    const sized = source.replace(`width="${N}" height="${N}"`, `width="${size}" height="${size}"`);
    await page.setContent(`<html><body style="margin:0">${sized}</body></html>`, { waitUntil: 'load' });
    await page.screenshot({ path: path.join(brand, file), clip: { x: 0, y: 0, width: size, height: size } });
    console.log('icon', file, size);
  }
} finally {
  await browser.close();
}
