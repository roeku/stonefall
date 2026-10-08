# Promo stage

Brand art and video drawn the way the game draws itself. `node tools/promo/build.mjs [job...]`
writes everything in `branding/` (jobs: featured, tile, icon, lockup, banners, video, gif).

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

- `stage.ts`: scenes (`hero`, `promo`, `loop`, `icon`, `banner`, `lockup`) and the presets the
  build uses. Any URL parameter overrides a preset: `index.html?scene=featured&dist=60`.
- `render.mjs`: headless renders: `still`, `frames` (a video's frames), `times` (a contact sheet's).
- `build.mjs`: the presets to `branding/`, encodes the MP4 and GIF, and optimises the PNGs.
- `gifprep.py`: holds 8 px tiles that barely changed, so the GIF fits 2 MB without smearing.
- `contrast.py`, `flashcheck.py`: the accessibility checks quoted in `branding/README.md`.
