/**
 * Renders a snapshot of the live game (snapshot.mjs) through the promo pipeline, to check the
 * pipeline still draws what the game draws: check.html?snap=<name>, opened at the snapshot's CSS
 * size and pixel ratio (render.mjs does this with PAGE=check.html and DPR=1.5).
 */
import { createPipeline } from './pipeline';
import { buildSnapshot, type Snapshot } from './snapshotScene';

const query = new URLSearchParams(location.search);
const name = query.get('snap') ?? 'run1';
const p = createPipeline({
  cssWidth: window.innerWidth,
  cssHeight: window.innerHeight,
  dpr: window.devicePixelRatio,
  container: document.getElementById('stage')!,
});

declare global {
  interface Window {
    stage: {
      ready: Promise<void>;
      frame: (t: number) => void;
      duration?: number;
      info: Record<string, unknown>;
    };
  }
}

const info: Record<string, unknown> = {};
window.stage = {
  info,
  frame: () => p.render(),
  ready: fetch(`./snapshots/${name}.json`)
    .then((r) => r.json())
    .then((snap: Snapshot) => {
      info.notes = buildSnapshot(p, snap);
      p.render();
    }),
};
