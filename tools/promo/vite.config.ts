import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// The promo stage: the game's own materials and simulation, staged for brand art and video.
// Not part of the app; `render.mjs` drives it in headless Chrome. See README.md.
const here = fileURLToPath(new URL('.', import.meta.url));
const repo = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  root: here,
  clearScreen: false,
  server: { port: 7476, strictPort: true, fs: { allow: [repo] } },
});
