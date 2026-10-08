// Snapshots the live game's three.js scene, for checking the promo stage against the real thing.
//
// With the play harness on :7474 (`npm run play`):
//   node tools/promo/snapshot.mjs <name> <cssW> <cssH> <dpr> <map|plot|run>
// writes tools/promo/snapshots/<name>.png (what the game drew) and <name>.json (every visible
// mesh, line and point cloud with its matrix, geometry, material and shader uniforms, plus the
// camera and fog). The stage's `snapshot` scene rebuilds that JSON with its own copy of the
// pipeline; the two pictures should agree.
//
// Three.js announces every Scene and WebGLRenderer to window.__THREE_DEVTOOLS__ when that exists,
// which is how the page's renderer is found without touching the game's code. The game is frozen
// (requestAnimationFrame stops) before the shot, so the picture and the JSON are the same frame.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const [, , name, w, h, dprArg, mode = 'map'] = process.argv;
const width = Number(w);
const height = Number(h);
const dpr = Number(dprArg);
const out = path.join(import.meta.dirname, 'snapshots');
fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath:
    process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  protocolTimeout: 180_000,
  args: [
    '--use-angle=metal',
    '--enable-gpu',
    '--ignore-gpu-blocklist',
    '--enable-webgl',
    '--no-sandbox',
    '--hide-scrollbars',
    '--force-color-profile=srgb',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const page = await browser.newPage();
const mobile = width < 700;
await page.setViewport({
  width,
  height,
  deviceScaleFactor: dpr,
  isMobile: mobile,
  hasTouch: mobile,
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.evaluateOnNewDocument(() => {
  const promo = { renderers: [], last: null, frozen: false, queue: [] };
  window.__promo = promo;
  const hook = new EventTarget();
  hook.addEventListener('observe', (e) => {
    const o = e.detail;
    if (o && o.isWebGLRenderer) {
      promo.renderers.push(o);
      const render = o.render.bind(o);
      o.render = (scene, camera) => {
        if (scene && scene.isScene && camera && camera.isPerspectiveCamera)
          promo.last = { scene, camera, renderer: o };
        return render(scene, camera);
      };
    }
  });
  window.__THREE_DEVTOOLS__ = hook;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) =>
    raf((t) => {
      if (promo.frozen) promo.queue.push(cb);
      else cb(t);
    });
});
await page.goto(process.env.PLAY_URL ?? 'http://localhost:7474/', {
  waitUntil: 'networkidle0',
  timeout: 60_000,
});
await sleep(3500);

const clickButton = (label) =>
  page.evaluate((l) => {
    const b = [...document.querySelectorAll('button')].find((el) =>
      (el.textContent.trim() + ' ' + (el.getAttribute('aria-label') || ''))
        .toLowerCase()
        .includes(l)
    );
    if (!b) throw new Error('no button ' + l);
    b.click();
  }, label);

if (mode === 'map') {
  await clickButton('map');
  await sleep(4500);
} else if (mode === 'run') {
  await clickButton('build');
  await sleep(1500);
  // A streak of perfects, the way a good run looks: read the live state and drop on centre.
  const res = await page.evaluate(
    async (drops) => {
      const canvas = document.querySelector('canvas');
      const key = Object.keys(canvas).find((k) => k.startsWith('__reactFiber$'));
      const flat = (c) => (Array.isArray(c) ? c.flat(Infinity) : [c]);
      const read = () => {
        let f = canvas[key];
        let best = null;
        for (let i = 0; i < 60 && f; i++) {
          for (const node of [f, f.alternate]) {
            if (!node || !node.memoizedProps) continue;
            for (const ch of flat(node.memoizedProps.children)) {
              const live = ch && ch.props && ch.props.liveState && ch.props.liveState.current;
              const gs = live || (ch && ch.props && ch.props.gameState);
              if (gs && (!best || gs.tick > best.tick)) best = gs;
            }
          }
          f = f.return;
        }
        return best;
      };
      const space = () =>
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ' }));
      let done = 0;
      let last = null;
      let axis = null;
      const t0 = performance.now();
      return await new Promise((resolve) => {
        const loop = () => {
          if (performance.now() - t0 > 90000) return resolve({ done, why: 'budget' });
          const gs = read();
          if (!gs) return requestAnimationFrame(loop);
          if (gs.isGameOver) return resolve({ done, why: 'over' });
          const cur = gs.currentBlock;
          const top = gs.blocks[gs.blocks.length - 1];
          if (!cur || !top) {
            last = null;
            return requestAnimationFrame(loop);
          }
          if (last) {
            if (cur.x !== last.x) axis = 'x';
            else if ((cur.z ?? 0) !== (last.z ?? 0)) axis = 'z';
          }
          last = cur;
          if (axis) {
            const pos = axis === 'x' ? cur.x : (cur.z ?? 0);
            const centre = axis === 'x' ? top.x : (top.z ?? 0);
            const extent = axis === 'x' ? top.width : (top.depth ?? top.width);
            const band = Math.max(90, extent / 10);
            const off = Math.abs(pos - centre);
            const sloppy = done % 5 === 4;
            const want = sloppy ? off > extent * 0.12 && off < extent * 0.2 : off < band * 0.6;
            if (want) {
              space();
              done++;
              last = null;
              axis = null;
              if (done >= drops) return resolve({ done, why: 'drops' });
              return setTimeout(() => requestAnimationFrame(loop), 250);
            }
          }
          requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
      });
    },
    Number(process.env.DROPS ?? 14)
  );
  console.log('run', res);
  await sleep(Number(process.env.AFTER ?? 150));
}

// Freeze, let the frame in flight land, then take both pictures of it.
await page.evaluate(() => {
  window.__promo.frozen = true;
});
await sleep(300);
await page.screenshot({ path: path.join(out, `${name}.png`) });

const snap = await page.evaluate(() => {
  const { scene, camera, renderer } = window.__promo.last;
  const props = renderer.properties;
  const arr = (a) => (a ? Array.from(a) : null);
  const val = (v) => {
    if (v === null || v === undefined) return v;
    if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return v;
    if (v.isColor) return { color: [v.r, v.g, v.b] };
    if (v.isVector2) return { v2: [v.x, v.y] };
    if (v.isVector3) return { v3: [v.x, v.y, v.z] };
    if (v.isVector4) return { v4: [v.x, v.y, v.z, v.w] };
    if (v.isMatrix4) return { m4: arr(v.elements) };
    if (v.isTexture) return { texture: v.name || v.uuid };
    return { unknown: Object.prototype.toString.call(v) };
  };
  const uniformsOf = (m) => {
    const u = props.get(m)?.uniforms ?? m.uniforms ?? {};
    const o = {};
    for (const [k, v] of Object.entries(u)) {
      if (!v || !('value' in v)) continue;
      // Built-in material uniforms are rebuilt from the material itself; keep the custom ones.
      if (!/^(u[A-Z]|cell|section|fade|infinite|follow|world)/.test(k)) continue;
      o[k] = val(v.value);
    }
    return o;
  };
  const geom = (g) => {
    const p = g.parameters ? { ...g.parameters } : null;
    if (p && p.geometry) p.geometry = { type: p.geometry.type, parameters: p.geometry.parameters };
    const attrs = {};
    for (const k of Object.keys(g.attributes)) {
      if (k === 'position' && g.type !== 'BufferGeometry') continue;
      if (['normal', 'uv'].includes(k)) continue;
      const a = g.attributes[k];
      attrs[k] = {
        itemSize: a.itemSize,
        array: arr(a.array),
        instanced: !!a.isInstancedBufferAttribute,
      };
    }
    return { type: g.type, parameters: p, attributes: attrs, drawRange: g.drawRange };
  };
  const mat = (m) => ({
    type: m.type,
    key: m.customProgramCacheKey ? m.customProgramCacheKey() : null,
    color: m.color ? [m.color.r, m.color.g, m.color.b] : null,
    emissive: m.emissive ? [m.emissive.r, m.emissive.g, m.emissive.b] : null,
    emissiveIntensity: m.emissiveIntensity,
    roughness: m.roughness,
    metalness: m.metalness,
    opacity: m.opacity,
    transparent: m.transparent,
    blending: m.blending,
    side: m.side,
    depthWrite: m.depthWrite,
    depthTest: m.depthTest,
    toneMapped: m.toneMapped,
    vertexColors: m.vertexColors,
    size: m.size,
    sizeAttenuation: m.sizeAttenuation,
    fog: m.fog,
    wireframe: m.wireframe,
    uniforms: uniformsOf(m),
    vertexShader: m.type === 'ShaderMaterial' ? m.vertexShader : undefined,
    fragmentShader: m.type === 'ShaderMaterial' ? m.fragmentShader : undefined,
  });
  const objects = [];
  const skipped = {};
  scene.updateMatrixWorld(true);
  scene.traverseVisible((o) => {
    if (!(o.isMesh || o.isLine || o.isPoints || o.isSprite)) return;
    if (Array.isArray(o.material)) {
      skipped.multi = (skipped.multi ?? 0) + 1;
      return;
    }
    const entry = {
      kind: o.isInstancedMesh ? 'InstancedMesh' : o.type,
      name: o.name,
      matrixWorld: arr(o.matrixWorld.elements),
      renderOrder: o.renderOrder,
      frustumCulled: o.frustumCulled,
      geometry: geom(o.geometry),
      material: mat(o.material),
    };
    if (o.isInstancedMesh) {
      entry.count = o.count;
      entry.instanceMatrix = arr(o.instanceMatrix.array.subarray(0, o.count * 16));
      entry.instanceColor = o.instanceColor
        ? arr(o.instanceColor.array.subarray(0, o.count * 3))
        : null;
    }
    objects.push(entry);
  });
  return {
    camera: {
      matrixWorld: arr(camera.matrixWorld.elements),
      fov: camera.fov,
      near: camera.near,
      far: camera.far,
      zoom: camera.zoom,
      aspect: camera.aspect,
    },
    fog: scene.fog
      ? {
          color: [scene.fog.color.r, scene.fog.color.g, scene.fog.color.b],
          near: scene.fog.near,
          far: scene.fog.far,
        }
      : null,
    background: scene.background?.isColor
      ? [scene.background.r, scene.background.g, scene.background.b]
      : null,
    pixelRatio: renderer.getPixelRatio(),
    drawingBuffer: [renderer.domElement.width, renderer.domElement.height],
    objects,
    skipped,
  };
});
fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify(snap));
const kinds = {};
for (const o of snap.objects) {
  const k = `${o.kind}:${o.material.type}:${o.material.key ?? ''}`;
  kinds[k] = (kinds[k] ?? 0) + 1;
}
console.log(
  'pixelRatio',
  snap.pixelRatio,
  'buffer',
  snap.drawingBuffer,
  'fog',
  JSON.stringify(snap.fog)
);
console.log(JSON.stringify(kinds, null, 1));
await browser.close();
