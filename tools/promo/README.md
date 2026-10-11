# Promo stage

Brand art and video drawn the way the game draws itself. `node tools/promo/build.mjs [job...]`
writes everything in `branding/` (jobs: tile, icon, lockup, banners, featuring). The featuring
video, its GIF and the still come from the launch video in `brag-output/` (/brag and Hyperframes),
whose 3D plates are this stage's `brag-*` presets and whose music is `score.mjs`.

Needs Chrome, ffmpeg, python3 with Pillow and numpy, and puppeteer-core, which is not a project
dependency: `npm i --no-save puppeteer-core`.

## How it stays true to the game

- `pipeline.ts` is the game's picture outside React: App.tsx's canvas (pixel ratio capped at 1.5,
  no antialias), EffectsRenderer's bloom, BoardFloor's grid, TerritoryTiles, the board's rim
  material and GameBlock's materials. Code the game exports is imported; code inside components is
  copied, with a pointer to where it lives.
- `stage.ts` stages it. Runs are played by the shared simulation and drawn as GameScene draws them
  (hit stop, landing squash, seam flash, chain wave, rings, offcuts and sparks, the run camera);
  cities are laid out by the board's own instancing. Every frame is a pure function of time, so a
  video is rendered frame by frame at an exact rate.
- Renders happen at the game's pixel ratio, so rims and glow keep their weight.

When the game's look changes, check the copy still matches:

```bash
npm run play
node tools/promo/snapshot.mjs run1 1000 667 1.5 run
npx vite --config tools/promo/vite.config.ts
DPR=1.5 PAGE=check.html node tools/promo/render.mjs still x 1000 667 /tmp/run1-check.png snap=run1
```

`snapshot.mjs` freezes the live game and saves both its frame and every object in its scene
(`map` and `plot` work too); `check.html` rebuilds that scene through the pipeline. The two
pictures should differ only by the HUD.

## Files

- `stage.ts`: scenes (`hero`, `promo`, `loop`, `icon`, `banner`, `lockup`, `brag-run`,
  `brag-raise`) and the presets the build and the video use. Any URL parameter overrides a preset:
  `index.html?scene=featured&dist=60`. The type is the launch video's lockup (`wordmark()`).
- `render.mjs`: headless renders: `still`, `frames` (a video's frames), `times` (a contact sheet's).
- `build.mjs`: the presets to `branding/`, and optimises the PNGs.
- `icon.mjs`: the app and community icon, drawn as a vector (`branding/icon.svg`) and rendered at
  1024 and 256.
- `featuring.mjs`: Reddit's featuring set from `brag-output/brag.mp4`: the MP4 under 3 MB, the GIF
  fallback under 2 MB, the poster as PNG and JPEG.
- `score.mjs` / `score.ts`: the game's own music, rendered offline for a list of timed drops.
- `gifprep.py`: holds 8 px tiles that barely changed, feathered so a moving glow shows no steps,
  so the GIF fits 2 MB without smearing.
- `contrast.py`, `flashcheck.py`: the accessibility checks quoted in `branding/README.md`.
