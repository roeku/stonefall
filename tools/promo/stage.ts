/**
 * The promo stage: brand art and video staged in the game's own picture.
 *
 * Everything that decides how a frame looks is the game's: pipeline.ts copies the canvas, bloom,
 * floor, tiles and block materials (and is checked against frames of the live game by
 * snapshot.mjs), towers are laid out by the board's own instancing, and runs are played by the
 * game's simulation. What is new here is only staging: where the camera stands, what is in frame,
 * and when.
 *
 * Every frame is a pure function of a time `t`: `window.stage.frame(t)` sets the world for that
 * moment and renders it, so a video is drawn frame by frame at an exact rate however long each
 * frame takes, and a still is the same picture every time.
 *
 * The page's CSS size is the game canvas's size, and the device pixel ratio the one the game would
 * use (render.mjs sets both), so rims, edges, text and glow come out at the game's proportions.
 */
import * as THREE from 'three';
import { buildBoardInstances, hexToRgb } from '../../src/client/components/board/boardInstancing';
import { factionTheme, mixHex } from '../../src/client/constants/factions';
import { streakName, streakTierIndex } from '../../src/client/constants/streakTiers';
import { FACTIONS, factionHex, type FactionId } from '../../src/shared/types/factions';
import { createRunSimulation } from '../../src/shared/simulation/runSimulation';
import { RUN_TUNING } from '../../src/shared/simulation/gameSimulation';
import { offWord } from '../../src/shared/simulation/missReadout';
import { DEFAULT_CONFIG, type Block, type GameState } from '../../src/shared/simulation/types';
import type { TowerMapEntry } from '../../src/shared/types/api';
import { createRimMaterial } from '../../src/client/components/board/rimMaterial';
import {
  GameBlockLook,
  TILE_INSET,
  TILE_LAYERS,
  createFloor,
  createPipeline,
  keepOutline,
  plotBeacon,
  ringGeometry,
  sparkMaterial,
  tileMaterial,
  towerMaterial,
} from './pipeline';
import { PITCH, baseDistance } from '../../src/client/components/board/boardFraming';
import { compressHeight } from '../../src/client/components/board/rimMaterial';

// ---------------------------------------------------------------------------------------------
// Parameters and presets
// ---------------------------------------------------------------------------------------------

const query = new URLSearchParams(location.search);

/**
 * Finished compositions: a scene and the settings it was signed off with. URL parameters still
 * override any of them, which is how a variant is tried without losing the original.
 */
/** The hero run: a long tower of mostly perfects with the odd near miss, ending on a cut. */
const HERO_RUN = {
  pattern: 'p,p,p,0.14,p,p,p',
  repeat: 20,
  tail: 'p,p,p,0.3,p',
  speedCap: 900,
  after: 6,
};
/** The city behind it: a skyline a little shorter than the tower, nothing between it and us. */
const HERO_CITY = {
  compress: 0,
  vMin: 1,
  cityH: 1,
  corW: 40,
  corL: 200,
  density: 0.3,
  hMin: 15,
  hMax: 95,
  clear: 50,
};
/** For the banners: a taller, denser skyline that reaches the tower's top. */
const BANNER_CITY = { ...HERO_CITY, density: 0.4, hMin: 40, hMax: 150, clear: 40, scrim: 'left' };

const PRESETS: Record<string, { scene: string; params: Record<string, string | number> }> = {
  /** Featuring image, 1500 x 1000: the run's tower over the city, the wordmark in the sky. */
  featured: {
    scene: 'hero',
    params: { ...HERO_RUN, ...HERO_CITY, camY: 6, dist: 52, lift: -5, pan: 12, fov: 40, fogD: 150 },
  },
  /** Tile, 560 x 256: the same moment, lower and closer, no type. */
  tile: {
    scene: 'hero',
    params: {
      ...HERO_RUN,
      ...HERO_CITY,
      clear: 40,
      hMax: 135,
      logo: 0,
      camY: 0,
      dist: 44,
      lift: -6,
      pan: 8,
      fov: 32,
      fogD: 150,
    },
  },
  /** Banners: wide slices of the hero shot, the wordmark clear of where Reddit puts the icon. */
  'banner-strip': {
    scene: 'hero',
    params: {
      ...HERO_RUN,
      ...BANNER_CITY,
      camY: 2,
      dist: 70,
      lift: -1.5,
      pan: 16,
      fov: 8,
      fogD: 170,
      lx: '13%',
      ly: '24%',
      ls: 0.52,
    },
  },
  'banner-wide': {
    scene: 'hero',
    params: {
      ...HERO_RUN,
      ...BANNER_CITY,
      camY: 2,
      dist: 66,
      lift: -5,
      pan: 13,
      fov: 12.4,
      fogD: 170,
      lx: '12%',
      ly: '27%',
      ls: 0.42,
    },
  },
  'banner-tall': {
    scene: 'hero',
    params: {
      ...HERO_RUN,
      ...BANNER_CITY,
      camY: 2,
      dist: 60,
      lift: -7,
      pan: 10,
      fov: 18.4,
      fogD: 170,
      lx: '11%',
      ly: '24%',
      ls: 0.3,
    },
  },
  /** App icon, rendered at 512 and scaled: the slab in hand, the cut piece and its sparks. */
  'app-icon': {
    scene: 'icon',
    params: { after: 9, dist: 50, elev: 28, lift: -5.5, tx: -3.5, tz: 2.5 },
  },
  /** The promo video: a city a little shorter than the run, kept clear along the run camera. */
  video: {
    scene: 'promo',
    params: {
      azim: 45,
      clear: 50,
      density: 0.14,
      hMin: 15,
      hMax: 95,
      vMin: 1,
      compress: 0,
      corW: 56,
      corL: 260,
    },
  },
  /** The fallback GIF: eight perfect drops that loop seamlessly. */
  'fallback-loop': { scene: 'loop', params: {} },
  /**
   * /brag's plates (brag-output/brag-plan.md): the run alone on its grid, as the game draws a run
   * (no city), pushed right of frame for the type; then the raise in a wide shot of the skyline.
   */
  'brag-hook': { scene: 'brag-run', params: { part: 'hook', city: 0, azim: 45, lead: 0.6, shift: 0.2, dur: 4.2 } },
  'brag-climb': {
    scene: 'brag-run',
    params: { part: 'climb', city: 0, azim: 45, orbitAt: 2.5, elev: 6, dist: 52, rise: 46, endBelow: 6, shift: 0.18, dur: 3.8 },
  },
  'brag-raise': {
    scene: 'brag-raise',
    params: {
      azim: 45, clear: 50, corW: 56, corL: 260, density: 0.14, hMin: 15, hMax: 95, vMin: 1, compress: 0,
      raiseAt: 0.3, dist: 330, elev: 9, lookY: 195, pan: 42, drift: 1.2, push: 20, fogD: 320,
    },
  },
};

{
  const preset = PRESETS[query.get('scene') ?? ''];
  if (preset) {
    query.set('scene', preset.scene);
    for (const [k, v] of Object.entries(preset.params)) if (!query.has(k)) query.set(k, String(v));
  }
}

const num = (key: string, fallback: number): number =>
  query.has(key) ? Number(query.get(key)) : fallback;
const str = (key: string, fallback: string): string => query.get(key) ?? fallback;
const SCENE = str('scene', 'hero');
const FIX = 1000;
const TICKS = 60;

const pipe = createPipeline({
  cssWidth: window.innerWidth,
  cssHeight: window.innerHeight,
  dpr: window.devicePixelRatio,
  container: document.getElementById('stage')!,
});
const { scene, camera } = pipe;
const overlay = document.getElementById('overlay')!;
/** Facts about the staged scene, for the renderer's log. */
const info: Record<string, unknown> = {};

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

const mulberry = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const noise = (a: number, b: number): number => {
  let h = 2166136261 ^ a;
  h = Math.imul(h, 16777619) ^ b;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
/** Peaks at about 1.6 times its average speed, where the cubic peaks at 3: for camera moves. */
const easeInOutSine = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * t);
/** 0 before a, 1 after b, eased between. */
const window01 = (t: number, a: number, b: number, ease = easeInOut) =>
  ease(clamp01((t - a) / (b - a)));

/**
 * A lens shift, as a share of the frame: 0.2 moves the subject a fifth of the width to the right
 * without turning the camera, so a composition can leave room for type and keep its perspective.
 */
const lensShift = { x: 0, y: 0 };

const lookAt = (pos: THREE.Vector3Like, target: THREE.Vector3Like, fov = 30) => {
  camera.position.set(pos.x, pos.y, pos.z);
  camera.fov = fov;
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (lensShift.x || lensShift.y) camera.setViewOffset(w, h, -lensShift.x * w, lensShift.y * h, w, h);
  else camera.clearViewOffset();
  camera.updateProjectionMatrix();
  camera.lookAt(target.x, target.y, target.z);
  camera.updateMatrixWorld(true);
};

/** Where a world point lands on the frame, in percent. */
const toScreen = (p: THREE.Vector3) => {
  const v = p.clone().project(camera);
  return { x: (v.x * 0.5 + 0.5) * 100, y: (-v.y * 0.5 + 0.5) * 100 };
};

const cellCentre = (c: number) => c * 8 + 4;

// ---------------------------------------------------------------------------------------------
// The city: standing towers exactly as the board draws them
// ---------------------------------------------------------------------------------------------

/** Tower geometry the way the simulation builds it (devServer/mockApi.ts generateTowerBlocks). */
const towerBlocks = (count: number, seed: number) => {
  const H = DEFAULT_CONFIG.BLOCK_HEIGHT;
  const minExtent = DEFAULT_CONFIG.MIN_WIDTH_THRESHOLD;
  let width = DEFAULT_CONFIG.TOWER_WIDTH * 2;
  let depth = width;
  let x = 0;
  let z = 0;
  const skill = Math.min(0.97, 0.6 + count / 1400);
  const blocks = [{ x: 0, y: 0, z: 0, width, depth, height: H, rotation: 0 }];
  for (let i = 1; i < count; i++) {
    const axis = (i - 1) % 2 === 0 ? 'x' : 'z';
    const extent = axis === 'x' ? width : depth;
    if (noise(seed, i) > skill) {
      const miss = (noise(seed * 31 + 7, i) - 0.5) * extent * 0.3;
      const trimmed = Math.max(minExtent, Math.round(extent - Math.abs(miss)));
      const shift = Math.round(miss / 2);
      if (axis === 'x') {
        width = trimmed;
        x += shift;
      } else {
        depth = trimmed;
        z += shift;
      }
    }
    blocks.push({ x, y: i * H, z, width, depth, height: H, rotation: 0 });
  }
  return blocks;
};

/** The mock's spread of tower heights: mostly modest, a long tail of tall ones. */
const mockHeight = (rnd: () => number) => {
  const roll = rnd();
  if (roll < 0.55) return 20 + Math.floor(rnd() * 90);
  if (roll < 0.85) return 120 + Math.floor(rnd() * 180);
  if (roll < 0.97) return 300 + Math.floor(rnd() * 320);
  return 700 + Math.floor(rnd() * 320);
};

interface CityOptions {
  seed: number;
  /** Half-size of the square of cells, in cells. */
  radius: number;
  /** Share of cells with a tower. */
  density: number;
  skip?: (cx: number, cz: number) => boolean;
  /** Height in blocks for a cell; the mock's spread by default. */
  blocksFor?: (cx: number, cz: number, rnd: () => number) => number;
  /** Faction territories, as seeds of a Voronoi map. */
  territories: number;
  palette: readonly FactionId[];
  /** The board's log squash, 0 (true height, the plot) to 1 (the map). */
  compress: number;
  /** Share of towers built in a stone rather than neon, as on any real map. */
  stoneShare: number;
}

const createCity = (o: CityOptions) => {
  const rnd = mulberry(o.seed);
  const seeds = Array.from({ length: o.territories }, (_, i) => ({
    x: (rnd() * 2 - 1) * o.radius,
    z: (rnd() * 2 - 1) * o.radius,
    faction: o.palette[i % o.palette.length]!,
  }));
  const factionAt = (cx: number, cz: number): FactionId => {
    let best = seeds[0]!;
    let bd = Infinity;
    for (const s of seeds) {
      const d = (s.x - cx) ** 2 + (s.z - cz) ** 2;
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best.faction;
  };
  const towers: TowerMapEntry[] = [];
  const stones = new Map<string, number>();
  let id = 0;
  for (let cx = -o.radius; cx <= o.radius; cx++) {
    for (let cz = -o.radius; cz <= o.radius; cz++) {
      if (o.skip?.(cx, cz)) continue;
      // Gutters between plots stay open, the way the map leaves roads.
      if (((cx % 8) + 8) % 8 === 7 || ((cz % 8) + 8) % 8 === 7) continue;
      if (rnd() > o.density) continue;
      const count = o.blocksFor ? o.blocksFor(cx, cz, rnd) : mockHeight(rnd);
      if (count < 2) continue;
      const faction =
        rnd() < 0.08 ? o.palette[Math.floor(rnd() * o.palette.length)]! : factionAt(cx, cz);
      const userId = `u${id}`;
      if (rnd() < o.stoneShare) stones.set(userId, 1 + Math.floor(rnd() * 7));
      towers.push({
        sessionId: `t${id}`,
        userId,
        username: userId,
        score: count * 10,
        blockCount: count,
        perfectStreak: 0,
        gameMode: 'rotating_block',
        timestamp: 0,
        towerBlocks: towerBlocks(count, 1000 + id * 7),
        height: count * DEFAULT_CONFIG.BLOCK_HEIGHT,
        faction,
        worldX: cellCentre(cx),
        worldZ: cellCentre(cz),
      });
      id++;
    }
  }
  // BoardTowers: one instanced box per block, the rim material, stones by owner.
  const plan = buildBoardInstances(towers, { x: 0, z: 0 }, 2_000_000, () => -1000);
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const stoneAttr = new Float32Array(plan.count);
  for (let i = 0; i < plan.count; i++) {
    const owner = towers[plan.footprints[plan.towerOfInstance[i]!]!.index]!.userId;
    stoneAttr[i] = stones.get(owner) ?? 0;
  }
  geometry.setAttribute('aStone', new THREE.InstancedBufferAttribute(stoneAttr, 1));
  const compress = { value: o.compress };
  const mesh = new THREE.InstancedMesh(
    geometry,
    towerMaterial({ compress, stones: true }),
    Math.max(1, plan.count)
  );
  mesh.instanceMatrix.array.set(plan.matrices);
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor = new THREE.InstancedBufferAttribute(plan.colors.slice(), 3);
  mesh.count = plan.count;
  mesh.frustumCulled = false;
  return { mesh, compress, towers, plan, factionAt };
};

/** TerritoryTiles: one tile per held cell, in its holder's colour. */
const createTiles = (
  cells: ReadonlyArray<{ x: number; z: number; faction: FactionId }>,
  layer: keyof typeof TILE_LAYERS
) => {
  const l = TILE_LAYERS[layer];
  const size = 8 - TILE_INSET;
  const geometry = new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2);
  const material = tileMaterial(l.fill, l.edge, { value: 0 }, layer === 'reach');
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, cells.length));
  const m = new THREE.Matrix4();
  const colors = new Float32Array(Math.max(1, cells.length) * 3);
  cells.forEach((c, i) => {
    m.makeTranslation(c.x, l.y, c.z);
    mesh.setMatrixAt(i, m);
    // tilePlan: the faction's hex as 0..1 channels, as the board's towers take it.
    const rgb = hexToRgb(factionHex(c.faction));
    colors[i * 3] = rgb.r;
    colors[i * 3 + 1] = rgb.g;
    colors[i * 3 + 2] = rgb.b;
  });
  mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
  mesh.count = cells.length;
  mesh.frustumCulled = false;
  mesh.renderOrder = -50;
  return mesh;
};

// ---------------------------------------------------------------------------------------------
// A run, played by the game's simulation and drawn as GameScene draws it
// ---------------------------------------------------------------------------------------------

/** One drop in a scripted run: a perfect, or a miss by this share of the block. */
type Drop = 'perfect' | number;

interface Placement {
  tick: number;
  index: number;
  perfect: boolean;
  /** Perfect placements in a row, this one included. */
  streak: number;
  block: Block;
  /** Where the moving block was when it was let go: the placed block slides in from here. */
  from: Block;
  /** The state right after the drop. */
  state: GameState;
  /**
   * When it lands on the screen, in ticks of wall-clock time. The game freezes the simulation
   * for a beat after every landing (GameScene's hit stop: 85 ms for a perfect, 40 ms otherwise),
   * so the screen runs ahead of the simulation by the stops so far.
   */
  real: number;
}

interface Trim {
  tick: number;
  index: number;
  pieces: Array<{
    x: number;
    y: number;
    z: number;
    w: number;
    h: number;
    d: number;
    dirX: number;
    dirZ: number;
  }>;
}

interface RunTimeline {
  states: GameState[];
  placements: Placement[];
  trims: Trim[];
  /** Body and edge colour per block index. */
  colors: string[];
  faction: FactionId;
  /** The simulation tick on screen at a wall-clock tick, hit stops included. */
  simTick(real: number): number;
}

/** GameScene's hit stop, in ticks: the beat the simulation holds after a landing. */
const hitStop = (perfect: boolean) => ((perfect ? 85 : 40) / 1000) * TICKS;

/** Drops written as a list: `p` for a perfect, a number for a miss by that share of the block. */
const dropsOf = (list: string): Drop[] =>
  list
    .split(',')
    .filter(Boolean)
    .map((d) => (d === 'p' ? 'perfect' : Number(d)));

/** A long run-up: `pattern` repeated `repeat` times, then `tail`. */
const runUpOf = (pattern: string, repeat: number, tail: string): Drop[] => [
  ...Array.from({ length: repeat }, () => dropsOf(pattern)).flat(),
  ...dropsOf(tail),
];

const BAND = (extent: number) =>
  Math.max(RUN_TUNING.MIN_PERFECT_BAND, (extent * RUN_TUNING.PERFECT_BAND_RATIO) / 1000);

/** GameScene's tier ladder, for the chain wave's strength. */
const TIER_THRESHOLDS = [0, 2, 4, 6, 9, 13, 18, 24, 31, 39, 48, 58, 69, 81, 94, 108];
const computeTier = (streak: number) => {
  let tier = 0;
  for (let i = 0; i < TIER_THRESHOLDS.length; i++) {
    if (streak >= TIER_THRESHOLDS[i]!) tier = i;
    else break;
  }
  return Math.min(15, tier);
};

/**
 * Plays a run with the game's simulation, dropping when the moving block reaches the alignment
 * each scripted drop asks for, after at least `minWait` ticks of sliding. Colours are assigned
 * the way GameScene assigns them: the faction's colour breathing with height, held through a
 * streak.
 */
const playRun = (opts: {
  seed: number;
  faction: FactionId;
  drops: Drop[];
  minWait?: number;
  /** Per-block colours instead of the faction's gradient (a relay crew). */
  palette?: (index: number) => string;
  /** Cap the slide speed (a loop needs every block to move the same). */
  speedCap?: number;
  /**
   * How close to the middle a perfect is dropped, as a share of the perfect band. Small values
   * drop dead centre; near 1, a fast block that steps over the middle in one tick is still caught.
   */
  window?: number;
}): RunTimeline => {
  const sim = createRunSimulation(opts.seed, 'rotating_block');
  if (opts.speedCap) sim.setSlideSpeedMax(opts.speedCap);
  let state = sim.createInitialState();
  const states: GameState[] = [state];
  const placements: Placement[] = [];
  const trims: Trim[] = [];
  const accent = factionHex(opts.faction);
  const gradient = (step: number) => {
    const t = (Math.sin(step * 0.3) + 1) / 2;
    return mixHex(mixHex(accent, '#ffffff', 0.16), mixHex(accent, '#08111a', 0.14), t);
  };
  const colors: string[] = [opts.palette ? opts.palette(0) : gradient(0)];
  let shade = 1;
  let frozen: string | null = null;
  let streak = 0;
  let spawnTick = 0;
  const minWait = opts.minWait ?? 20;

  for (const drop of opts.drops) {
    let prev = state.currentBlock;
    for (let guard = 0; guard < 3000 && !state.isGameOver; guard++) {
      const cur = state.currentBlock;
      const top = state.blocks[state.blocks.length - 1];
      if (cur && top && state.tick - spawnTick >= minWait) {
        const axis = state.blocks.length % 2 === 0 ? 'x' : 'z';
        const pos = axis === 'x' ? cur.x : (cur.z ?? 0);
        const centre = axis === 'x' ? top.x : (top.z ?? 0);
        const extent = axis === 'x' ? top.width : (top.depth ?? top.width);
        const off = pos - centre;
        const prevPos = prev ? (axis === 'x' ? prev.x : (prev.z ?? 0)) - centre : off;
        let go = false;
        if (drop === 'perfect') go = Math.abs(off) <= BAND(extent) * (opts.window ?? 0.3);
        else {
          // Crossing the wanted offset, on whichever side the block is coming from.
          const want = drop * extent;
          go = (prevPos - want) * (off - want) <= 0 || (prevPos + want) * (off + want) <= 0;
        }
        if (go) break;
      }
      prev = cur;
      state = sim.stepSimulation(state);
      states.push(state);
    }
    if (state.isGameOver) break;
    const from = state.currentBlock!;
    const before = state.blocks.length;
    state = sim.stepSimulation(state, { tick: state.tick + 1 });
    states.push(state);
    if (state.blocks.length <= before) break;
    const index = state.blocks.length - 1;
    const block = state.blocks[index]!;
    const perfect = !!state.lastPlacement?.noTrim;
    const prevStreak = streak;
    streak = perfect ? streak + 1 : 0;
    if (opts.palette) colors[index] = opts.palette(index);
    else if (frozen && perfect && prevStreak > 0) colors[index] = frozen;
    else {
      colors[index] = gradient(shade);
      shade++;
      if (perfect && prevStreak === 0) frozen = colors[index]!;
    }
    if (!perfect) frozen = null;
    placements.push({ tick: state.tick, index, perfect, streak, block, from, state, real: 0 });
    for (const effect of state.recentTrimEffects.filter((e) => e.tick === state.tick)) {
      trims.push({
        tick: state.tick,
        index,
        pieces: effect.trimmedPieces.map((p) => {
          const x = p.x / FIX;
          const z = (p.z ?? 0) / FIX;
          const len = Math.hypot(x, z) || 1;
          // CutDebris: the trim's y is the piece's underside; it is thrown from its centre.
          return {
            x,
            y: p.y / FIX + p.height / FIX / 2,
            z,
            w: p.width / FIX,
            h: p.height / FIX,
            d: (p.depth ?? p.width) / FIX,
            dirX: x / len,
            dirZ: z / len,
          };
        }),
      });
    }
    spawnTick = state.tick;
  }
  for (let i = 0; i < 600 && !state.isGameOver; i++) {
    state = sim.stepSimulation(state);
    states.push(state);
  }
  let stopped = 0;
  for (const p of placements) {
    p.real = p.tick + stopped;
    stopped += hitStop(p.perfect);
  }
  const simTick = (real: number): number => {
    let before = 0;
    for (const p of placements) {
      if (p.real > real) break;
      const stop = hitStop(p.perfect);
      if (real < p.real + stop) return p.tick;
      before += stop;
    }
    return real - before;
  };
  return { states, placements, trims, colors, faction: opts.faction, simTick };
};

const GRAVITY = 42;

/** CutDebris's flight, integrated from the moment of the cut, so any time can be asked for. */
const flyPiece = (p: Trim['pieces'][number], seed: number, age: number) => {
  const r = mulberry(seed);
  const speed = 7 + r() * 4;
  let vx = p.dirX * speed + (r() - 0.5) * 1.5;
  let vy = 3.5 + r() * 2;
  let vz = p.dirZ * speed + (r() - 0.5) * 1.5;
  let spin = (r() - 0.5) * 4;
  let x = p.x;
  let y = p.y;
  let z = p.z;
  let rot = 0;
  let bounces = 0;
  const dt = 1 / 240;
  for (let t = 0; t < age; t += dt) {
    vy -= GRAVITY * dt;
    x += vx * dt;
    y += vy * dt;
    z += vz * dt;
    rot += spin * dt;
    const restY = p.h / 2;
    if (y <= restY) {
      y = restY;
      if (bounces < 2 && Math.abs(vy) > 3) {
        vy = -vy * 0.32;
        vx *= 0.55;
        vz *= 0.55;
        spin *= 0.5;
        bounces++;
      } else {
        rot = Math.round(rot / (Math.PI / 2)) * (Math.PI / 2);
        return { x, y, z, rot, resting: true, landedAge: age - t };
      }
    }
  }
  return { x, y, z, rot, resting: false, landedAge: 0 };
};

/**
 * Draws a run at any moment, as GameScene would: every block a GameBlock (lit only by its
 * emissive, edges one pixel wide), the block in hand with its shell, offcuts flung and resting,
 * sparks off the cut, landing rings, the chain wave down the tower, and the growth flare.
 */
class RunView {
  readonly group = new THREE.Group();
  private readonly blocks: GameBlockLook[] = [];
  private readonly moving = new GameBlockLook(true);
  private readonly debris: THREE.InstancedMesh;
  private readonly sparks: THREE.Points;
  private readonly rings: Array<{ loop: THREE.LineLoop; mat: THREE.LineBasicMaterial }> = [];
  private readonly flares: Array<{
    lines: THREE.LineSegments;
    mat: THREE.LineBasicMaterial;
    dims: string;
  }> = [];
  stone = 0;
  /** The random seed an offcut flies with; a loop seeds by its place in the pattern. */
  seedOf: (trim: Trim, piece: number) => number = (trim, piece) => trim.tick * 13 + piece;
  /** Offcuts older than this are no longer drawn, in seconds. */
  debrisMaxAge = Infinity;
  /** Per-block colours set by a palette (a relay tower) glow in their own colour. */
  ownEmissive = false;

  constructor(readonly run: RunTimeline) {
    this.group.add(this.moving.group);
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    this.debris = new THREE.InstancedMesh(geometry, createRimMaterial({ intensity: 0.9 }), 64);
    this.debris.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(64 * 3), 3);
    this.debris.frustumCulled = false;
    this.group.add(this.debris);
    const sparkGeometry = new THREE.BufferGeometry();
    sparkGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(500 * 3), 3));
    sparkGeometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(500 * 3), 3));
    this.sparks = new THREE.Points(sparkGeometry, sparkMaterial());
    this.sparks.frustumCulled = false;
    this.group.add(this.sparks);
    const ring = ringGeometry();
    for (let i = 0; i < 12; i++) {
      const mat = new THREE.LineBasicMaterial({
        color: '#ffffff',
        transparent: true,
        opacity: 0,
        toneMapped: false,
      });
      const loop = new THREE.LineLoop(ring, mat);
      loop.frustumCulled = false;
      loop.visible = false;
      this.rings.push({ loop, mat });
      this.group.add(loop);
    }
    for (let i = 0; i < 4; i++) {
      const mat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0, toneMapped: false });
      const lines = new THREE.LineSegments(new THREE.BufferGeometry(), mat);
      lines.visible = false;
      this.flares.push({ lines, mat, dims: '' });
      this.group.add(lines);
    }
  }

  private block(i: number) {
    while (this.blocks.length <= i) {
      const look = new GameBlockLook();
      this.group.add(look.group);
      this.blocks.push(look);
    }
    return this.blocks[i]!;
  }

  stateAt(tick: number): GameState {
    const s = this.run.states;
    return s[Math.max(0, Math.min(s.length - 1, Math.floor(tick)))]!;
  }

  /** World y of the tower's top at a wall-clock tick. */
  topAt(tick: number): number {
    const st = this.stateAt(this.run.simTick(tick));
    const top = st.blocks[st.blocks.length - 1];
    return top ? (top.y + top.height) / FIX : 0;
  }

  /** Draws the run at a wall-clock tick (see Placement.real). */
  update(tick: number, opts: { hideMoving?: boolean; since?: number } = {}) {
    const since = opts.since ?? -Infinity;
    const state = this.stateAt(this.run.simTick(tick));
    const ms = (tick / TICKS) * 1000;
    const theme = factionTheme(this.run.faction);
    const white = new THREE.Color('#ffffff');
    // GameBlock: during a streak every block's emissive is the accent pushed toward white.
    const streaking = state.combo > 0 && !!state.lastPlacement?.isPositionPerfect;
    const placedBy = new Map(this.run.placements.map((p) => [p.index, p]));
    // GameBlock keeps only the latest chain wave: each perfect replaces the one before it.
    const lastPerfect = [...this.run.placements]
      .reverse()
      .find((p) => p.perfect && p.real <= tick && p.real >= since);

    state.blocks.forEach((b, i) => {
      const look = this.block(i);
      look.group.visible = true;
      const w = b.width / FIX;
      const h = b.height / FIX;
      const d = (b.depth ?? b.width) / FIX;
      look.setSize(w, h, d);
      let x = b.x / FIX;
      let y = b.y / FIX + h / 2;
      let z = (b.z ?? 0) / FIX;
      let sx = 1;
      let sy = 1;
      const color = this.run.colors[i] ?? theme.accentHex;
      let flash = 0;
      let rimFlash = 0;
      const placement = placedBy.get(i);
      if (placement) {
        const ageMs = ((tick - placement.real) / TICKS) * 1000;
        const frames = Math.max(0, ageMs / (1000 / 60));
        // GameBlock's follow: 45% of the way per frame across, 60% up and down.
        x += (placement.from.x / FIX - x) * Math.pow(0.55, frames);
        y += (placement.from.y / FIX + h / 2 - y) * Math.pow(0.4, frames);
        z += ((placement.from.z ?? 0) / FIX - z) * Math.pow(0.55, frames);
        if (placement.real >= since) {
          const t = ageMs / (placement.perfect ? 320 : 240);
          if (t >= 0 && t < 1) {
            const amp = placement.perfect ? 0.34 : 0.22;
            const spring = 1 - amp * Math.exp(-t * 5.5) * Math.cos(t * Math.PI * 3.2);
            sx = 1 + (1 - spring) * 0.6;
            sy = spring;
            flash += Math.max(0, 1 - t * 1.4) * (placement.perfect ? 1.6 : 0.8);
            rimFlash += Math.max(0, 1 - t * 1.6);
          }
        }
      }
      if (lastPerfect && lastPerfect.index >= i) {
        const steps = lastPerfect.index - i;
        const local = (ms - (lastPerfect.real / TICKS) * 1000) / 1000 - steps * 0.06;
        const dur = 0.9 + steps * 0.05;
        if (local >= 0 && local < dur) {
          const pr = local / dur;
          const tierBoost = Math.min(0.9, computeTier(lastPerfect.streak) * 0.05);
          const glow = (1 - pr) * (1.3 + tierBoost) * Math.sin(pr * Math.PI);
          flash += glow * 0.42;
          rimFlash += glow * 0.22;
        }
      }
      look.group.position.set(x, y, z);
      look.group.scale.set(sx, sy, sx);
      look.setLook({
        color,
        accentHex: this.ownEmissive ? color : theme.accentHex,
        accentSecondaryHex: this.ownEmissive
          ? mixHex(color, '#ffffff', 0.45)
          : theme.accentSecondaryHex,
        streaking,
        stone: this.stone,
      });
      look.flash.uFlash.value = flash;
      look.flash.uRimFlash.value = Math.min(1, rimFlash);
    });
    for (let i = state.blocks.length; i < this.blocks.length; i++)
      this.blocks[i]!.group.visible = false;

    // The block in hand.
    const cur = state.currentBlock;
    const showMoving = !!cur && !state.isGameOver && !opts.hideMoving;
    this.moving.group.visible = showMoving;
    if (cur && showMoving) {
      const w = cur.width / FIX;
      const h = cur.height / FIX;
      const d = (cur.depth ?? cur.width) / FIX;
      this.moving.setSize(w, h, d);
      this.moving.group.position.set(cur.x / FIX, cur.y / FIX + h / 2, (cur.z ?? 0) / FIX);
      const next = state.blocks.length;
      const color = this.run.colors[next] ?? this.run.colors[next - 1] ?? theme.accentHex;
      this.moving.setLook({
        color,
        accentHex: this.ownEmissive ? color : theme.accentHex,
        accentSecondaryHex: this.ownEmissive
          ? mixHex(color, '#ffffff', 0.45)
          : theme.accentSecondaryHex,
        streaking,
        stone: this.stone,
      });
      this.moving.flash.uFlash.value = 0;
      this.moving.flash.uRimFlash.value = 0;
    }

    // Offcuts and their sparks, newest first.
    let n = 0;
    const tmp = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const col = new THREE.Color();
    const sparkPos = this.sparks.geometry.getAttribute('position') as THREE.BufferAttribute;
    const sparkCol = this.sparks.geometry.getAttribute('color') as THREE.BufferAttribute;
    let s = 0;
    for (let ti = this.run.trims.length - 1; ti >= 0; ti--) {
      const trim = this.run.trims[ti]!;
      const at = placedBy.get(trim.index)?.real ?? trim.tick;
      if (at > tick) continue;
      const age = (tick - at) / TICKS;
      if (age > this.debrisMaxAge) continue;
      const color = new THREE.Color(this.run.colors[trim.index] ?? theme.accentHex).lerp(
        white,
        0.4
      );
      trim.pieces.forEach((p, k) => {
        if (n >= 64) return;
        const seed = this.seedOf(trim, k);
        const f = flyPiece(p, seed * 31 + 7, age);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), f.rot);
        tmp.compose(new THREE.Vector3(f.x, f.y, f.z), q, new THREE.Vector3(p.w, p.h, p.d));
        this.debris.setMatrixAt(n, tmp);
        if (f.resting) {
          const flare = f.landedAge < 0.18 ? 1 - f.landedAge / 0.18 : 0;
          col.copy(color).multiplyScalar(0.42).lerp(color, flare);
        } else col.copy(color);
        this.debris.setColorAt(n, col);
        n++;
        if (age > 0.75 || at < since) return;
        const r = mulberry(seed * 7 + 101);
        for (let i = 0; i < 26 && s < 500; i++) {
          const sx0 = p.x + (r() - 0.5) * p.w;
          const sy0 = p.y + (r() - 0.5) * p.h;
          const sz0 = p.z + (r() - 0.5) * p.d;
          const vx = p.dirX * (4 + r() * 10) + (r() - 0.5) * 6;
          const vy = 2 + r() * 9;
          const vz = p.dirZ * (4 + r() * 10) + (r() - 0.5) * 6;
          const life = 0.35 + r() * 0.35;
          const left = life - age;
          if (left <= 0) continue;
          const yy = Math.max(0, sy0 + vy * age - 0.5 * GRAVITY * 0.8 * age * age);
          sparkPos.setXYZ(s, sx0 + vx * age, yy, sz0 + vz * age);
          const a = clamp01(left / 0.4);
          const c = color.clone().lerp(white, 0.3);
          sparkCol.setXYZ(s, c.r * a, c.g * a, c.b * a);
          s++;
        }
      });
    }
    for (; s < 500; s++) sparkPos.setXYZ(s, 0, -1000, 0);
    sparkPos.needsUpdate = true;
    sparkCol.needsUpdate = true;
    this.debris.count = n;
    this.debris.instanceMatrix.needsUpdate = true;
    if (this.debris.instanceColor) this.debris.instanceColor.needsUpdate = true;

    // Landing rings at the seam the block landed on; a perfect throws a second, wider one.
    this.rings.forEach((r) => (r.loop.visible = false));
    const recent = this.run.placements.filter((p) => p.real <= tick && p.real >= since).slice(-6);
    recent.forEach((p, i) => {
      for (let pass = 0; pass < 2; pass++) {
        const ring = this.rings[i * 2 + pass]!;
        const t = (ms - (p.real / TICKS) * 1000 - pass * 70) / 420;
        if ((pass === 1 && !p.perfect) || t < 0 || t > 1) continue;
        const ease = 1 - Math.pow(1 - t, 3);
        const grow = 1 + ease * (p.perfect ? 1.6 : 0.9) * (pass === 1 ? 1.4 : 1);
        ring.loop.visible = true;
        ring.loop.position.set(p.block.x / FIX, p.block.y / FIX + 0.03, (p.block.z ?? 0) / FIX);
        ring.loop.scale.set(
          (p.block.width / FIX) * grow,
          1,
          ((p.block.depth ?? p.block.width) / FIX) * grow
        );
        ring.mat.color.set(p.perfect ? '#ffffff' : '#6ff3ff');
        ring.mat.opacity = (1 - t) * (pass === 1 ? 0.7 : 1);
      }
    });

    // The growth flare: a perfect that buys width back swells an outline of the block.
    this.flares.forEach((f) => (f.lines.visible = false));
    let fi = 0;
    for (const p of recent) {
      const growth = p.state.recentGrowthEffects?.find((g) => g.tick === p.tick);
      if (!growth || fi >= this.flares.length) continue;
      const age = tick - p.real;
      if (age < 0 || age > 26) continue;
      const f = this.flares[fi++]!;
      const w = growth.block.width / FIX;
      const h = growth.block.height / FIX;
      const d = (growth.block.depth ?? growth.block.width) / FIX;
      const dims = `${w}:${h}:${d}`;
      if (dims !== f.dims) {
        f.lines.geometry.dispose();
        const box = new THREE.BoxGeometry(w, h, d);
        f.lines.geometry = new THREE.EdgesGeometry(box);
        box.dispose();
        f.dims = dims;
      }
      const t = clamp01(age / 26);
      f.lines.visible = true;
      f.lines.position.set(
        growth.block.x / FIX,
        growth.block.y / FIX + h / 2,
        (growth.block.z ?? 0) / FIX
      );
      f.lines.scale.setScalar(1 + 0.08 * (1 - Math.pow(1 - t, 3)));
      f.mat.color.set(theme.accentSecondaryHex);
      f.mat.opacity = Math.max(0, 1 - t * t);
    }
    return state;
  }
}

// ---------------------------------------------------------------------------------------------
// The HUD, as RunHud.tsx and index.css draw it
// ---------------------------------------------------------------------------------------------

/** index.css `--halo`: a tight dark shadow under the type, not a glow. */
const HALO = '0 1px 2px rgba(0, 4, 12, 0.92), 0 0 6px rgba(0, 4, 12, 0.72)';
/** index.css type scale, resolved at this page's width the way the game's CSS resolves it. */
const vw = window.innerWidth / 100;
const rem = 16;
const clampPx = (min: number, pref: number, max: number) => Math.max(min, Math.min(pref, max));
const T_SCORE = clampPx(4 * rem, 23 * vw, 6 * rem);
const T_CALLOUT = clampPx(1.7 * rem, 9 * vw, 2.4 * rem);

class Hud {
  readonly root = document.createElement('div');
  private readonly score = document.createElement('div');
  private readonly callout = document.createElement('div');
  constructor(scale = 1) {
    this.root.style.cssText = 'position:absolute; inset:0; pointer-events:none;';
    this.score.style.cssText = `position:absolute; top:22px; transform:translateX(-50%);
      font: 800 ${T_SCORE * scale}px/0.84 'Big Shoulders Display'; color:#f3f7fa;
      font-variant-numeric: tabular-nums lining-nums; text-shadow:${HALO};`;
    this.callout.style.cssText = `position:absolute; white-space:nowrap; text-align:center;
      font: 700 ${T_CALLOUT * scale}px/1 'Big Shoulders Display'; letter-spacing:0.05em;
      text-transform:uppercase; color:#f3f7fa; text-shadow:${HALO};`;
    this.root.append(this.score, this.callout);
  }

  /**
   * The HUD at a tick: the score counting up from the last landing, and that landing's word over
   * the tower (the streak's name, or how far off it was), popping in and rising away over 1.1 s.
   */
  update(
    view: RunView,
    tick: number,
    o: {
      anchor: { x: number; y: number };
      scoreX: number;
      opacity: number;
      scoreOpacity: number;
      accent: string;
      since?: number;
    }
  ) {
    this.root.style.opacity = String(o.opacity);
    this.score.style.opacity = String(o.scoreOpacity);
    const run = view.run;
    const state = view.stateAt(run.simTick(tick));
    const placed = run.placements.filter((p) => p.real <= tick);
    const last = placed[placed.length - 1];
    let shown = state.score;
    if (last) {
      const before = run.states[last.tick - 1]?.score ?? 0;
      const k = easeOut(clamp01((((tick - last.real) / TICKS) * 1000) / 320));
      shown = Math.round(before + (state.score - before) * k);
    }
    this.score.textContent = shown.toLocaleString('en-US');
    this.score.style.left = `${o.scoreX}%`;
    this.callout.style.opacity = '0';
    if (last && last.real >= (o.since ?? -Infinity)) {
      const age = (((tick - last.real) / TICKS) * 1000) / 1100;
      if (age >= 0 && age < 1) {
        const word = last.perfect
          ? streakName(last.streak)
          : (offWord(last.state.lastPlacement) ?? '');
        const tier = last.perfect ? streakTierIndex(last.streak) : 0;
        const scale = last.perfect ? 1 + 0.05 * Math.min(tier, 7) : 0.75;
        const color = last.perfect
          ? tier >= 6
            ? '#ffd166'
            : tier >= 3
              ? o.accent
              : '#f3f7fa'
          : '#f3f7fa';
        // index.css `hud-callout`: centred on its spot, popping past full size, rising away.
        let op = 1;
        let sc = 1;
        let dy = -50;
        if (age < 0.12) {
          const k = age / 0.12;
          op = k;
          sc = lerp(0.6, 1.06, k);
        } else if (age < 0.7) {
          sc = lerp(1.06, 1, clamp01((age - 0.12) / 0.58));
        } else {
          const k = (age - 0.7) / 0.3;
          op = 1 - k;
          dy = -50 - 14 * k;
        }
        this.callout.textContent = word;
        this.callout.style.color = color;
        this.callout.style.opacity = String(op);
        this.callout.style.left = `${o.anchor.x}%`;
        this.callout.style.top = `${o.anchor.y}%`;
        this.callout.style.transform = `translate(-50%, ${dy}%) scale(${sc * scale})`;
      }
    }
  }
}

/** The wordmark, in the game's display face. `size` is in CSS px at this page's size. */
const wordmark = (o: { left: string; top: string; size: number; align?: 'left' | 'center' }) => `
  <div style="position:absolute; left:${o.left}; top:${o.top}; ${o.align === 'center' ? 'transform:translateX(-50%); text-align:center;' : ''}
      font: 800 ${o.size}px/0.82 'Big Shoulders Display'; letter-spacing:0.01em; color:#f3f7fa; white-space:nowrap;
      text-shadow:${HALO}, 0 0 0.25em rgba(0,4,12,0.55);">STONEFALL</div>`;

// ---------------------------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------------------------

interface Scene {
  frame(t: number): void;
  duration?: number;
}

const SCENES: Record<string, () => Scene> = {};

/**
 * A run in front of the city it belongs to. The run is drawn as the run draws it and the city as
 * the board draws it; the game never shows both at once, and that is the only liberty taken.
 */
const heroWorld = () => {
  const heroX = 4;
  const heroZ = 4;
  const azimDeg = num('azim', 28);
  const az = (azimDeg * Math.PI) / 180;
  const toCam = new THREE.Vector2(Math.cos(az), Math.sin(az));
  const palette = str('palette', 'ember,gold,rose,violet,lime,cobalt').split(',') as FactionId[];
  const city = createCity({
    seed: num('citySeed', 12),
    radius: num('cityR', 34),
    density: num('density', 0.5),
    territories: num('terr', 40),
    palette,
    compress: num('compress', 0),
    stoneShare: num('stones', 0.2),
    skip: (cx, cz) => {
      const dx = cellCentre(cx) - heroX;
      const dz = cellCentre(cz) - heroZ;
      if (Math.hypot(dx, dz) < num('clear', 30)) return true;
      // Nothing between the camera and the hero.
      const along = dx * toCam.x + dz * toCam.y;
      const side = Math.abs(-dx * toCam.y + dz * toCam.x);
      return along > 0 && along < num('corL', 160) && side < num('corW', 60) / 2;
    },
    blocksFor: (cx, cz, rnd) => {
      // Heights grow with distance from the hero, so the skyline rises behind the tower.
      const d = Math.hypot(cellCentre(cx) - heroX, cellCentre(cz) - heroZ);
      const k = lerp(
        num('vMin', 0.06),
        1,
        clamp01((d - num('vIn', 40)) / (num('vOut', 260) - num('vIn', 40)))
      );
      const base = query.has('hMax')
        ? num('hMin', 20) + rnd() * (num('hMax', 120) - num('hMin', 20))
        : mockHeight(rnd);
      return Math.round(base * k * num('cityH', 1));
    },
  });
  if (query.get('city') !== '0') {
    scene.add(city.mesh);
    scene.add(
      createTiles(
        city.towers.map((t) => ({
          x: t.worldX ?? 0,
          z: t.worldZ ?? 0,
          faction: t.faction ?? 'cyan',
        })),
        'land'
      )
    );
  }
  const faction = str('faction', 'cyan') as FactionId;
  scene.add(createTiles([{ x: heroX, z: heroZ, faction }], 'keep'));
  // Hand-placed neighbours, as the plot view frames them: "cx:cz:faction:blocks:stone;..."
  if (query.has('near')) {
    const near: TowerMapEntry[] = [];
    const stones = new Map<string, number>();
    str('near', '')
      .split(';')
      .filter(Boolean)
      .forEach((spec, i) => {
        const [cx, cz, f, n, stone] = spec.split(':');
        const count = Number(n);
        const userId = `n${i}`;
        stones.set(userId, Number(stone ?? 0));
        near.push({
          sessionId: `n${i}`,
          userId,
          username: userId,
          score: count * 10,
          blockCount: count,
          perfectStreak: 0,
          gameMode: 'rotating_block',
          timestamp: 0,
          towerBlocks: towerBlocks(count, 77 + i * 131),
          height: count * DEFAULT_CONFIG.BLOCK_HEIGHT,
          faction: f as FactionId,
          worldX: cellCentre(Number(cx)),
          worldZ: cellCentre(Number(cz)),
        });
      });
    const plan = buildBoardInstances(near, { x: 0, z: 0 }, 2_000_000, () => -1000);
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const stoneAttr = new Float32Array(plan.count);
    for (let i = 0; i < plan.count; i++) {
      stoneAttr[i] =
        stones.get(near[plan.footprints[plan.towerOfInstance[i]!]!.index]!.userId) ?? 0;
    }
    geometry.setAttribute('aStone', new THREE.InstancedBufferAttribute(stoneAttr, 1));
    const mesh = new THREE.InstancedMesh(
      geometry,
      towerMaterial({ compress: { value: 0 }, stones: true }),
      plan.count
    );
    mesh.instanceMatrix.array.set(plan.matrices);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(plan.colors.slice(), 3);
    mesh.count = plan.count;
    mesh.frustumCulled = false;
    scene.add(mesh);
    scene.add(
      createTiles(
        near.map((t) => ({ x: t.worldX!, z: t.worldZ!, faction: t.faction! })),
        'land'
      )
    );
  }
  const floor = createFloor({ fadeDistance: 200 });
  scene.add(floor.mesh);
  const fog = new THREE.Fog('#000814', 100, 600);
  scene.fog = query.get('fog') === '0' ? null : fog;
  return { heroX, heroZ, toCam, city, floor, fog, faction };
};

/** Sets the board's fog and floor fade for a camera standing `d` from what it looks at. */
const boardAtmosphere = (w: ReturnType<typeof heroWorld>, d: number) => {
  // BoardCamera: fog from 0.9 to 3.4 times the distance; BoardScene: the floor fades at 1.7x.
  // A composite looks across the city from close to one tower, so the fog is set for the
  // distance the board would frame the city from (fogD), not the camera's distance to the tower.
  const fd = query.has('fogD') ? num('fogD', d) : d;
  w.fog.near = fd * num('fogNear', 0.9);
  w.fog.far = fd * num('fogFar', 3.4);
  w.floor.material.uniforms.fadeDistance!.value = fd * num('floorFade', 1.7);
  w.floor.update(camera);
};

/** The hero shot: the featuring image, the video's first frame, the tile and the banners. */
SCENES.hero = () => {
  const w = heroWorld();
  const drops: Drop[] = query.has('drops')
    ? dropsOf(str('drops', ''))
    : query.has('pattern')
      ? runUpOf(str('pattern', 'p'), num('repeat', 10), str('tail', '0.3,p'))
      : (() => {
          const n = num('blocks', 34);
          const out: Drop[] = [];
          for (let i = 0; i < n; i++) out.push(i % 7 === 3 ? 0.14 : 'perfect');
          out[n - 1] = num('lastMiss', 0.3);
          return out;
        })();
  const run = playRun({
    seed: num('seed', 11),
    faction: w.faction,
    drops,
    minWait: 14,
    ...(query.has('speedCap') ? { speedCap: num('speedCap', 900) } : {}),
  });
  const view = new RunView(run);
  view.group.position.set(w.heroX, 0, w.heroZ);
  scene.add(view.group);
  const lastTick = run.placements[run.placements.length - 1]?.real ?? 0;
  info.placements = run.placements.length;
  info.perfects = run.placements.filter((p) => p.perfect).length;
  // The chrome's scrim (index.css): type sits on a soft dark wash at the top of the frame, or,
  // on a banner, at its left edge, where the skyline behind the word would otherwise cut into it.
  const scrim =
    query.get('scrim') === 'left'
      ? `<div style="position:absolute; inset:0; background: linear-gradient(to right, rgba(0,8,20,${num('scrimA', 0.8)}) ${num('scrimHold', 30)}%, rgba(0,8,20,0) ${num('scrimW', 55)}%);"></div>`
      : `<div style="position:absolute; left:0; right:0; top:0; height:${num('scrimH', 42)}%;
    background: linear-gradient(to bottom, rgba(0,8,20,${num('scrimA', 0.62)}), rgba(0,8,20,0));"></div>`;
  overlay.innerHTML =
    query.get('logo') === '0'
      ? ''
      : (query.get('scrim') === '0' ? '' : scrim) +
        wordmark({
          left: str('lx', '7%'),
          top: str('ly', '10.5%'),
          size: num('ls', 0.16) * window.innerHeight,
          align: query.get('align') === 'center' ? 'center' : 'left',
        });
  return {
    frame(t) {
      const tick = lastTick + num('after', 6) + t * TICKS;
      view.update(tick, { since: query.get('fresh') === '0' ? Infinity : -Infinity });
      const top = view.topAt(tick);
      const dist = num('dist', 55);
      const target = new THREE.Vector3(w.heroX, top + num('lift', -10.5), w.heroZ);
      const pan = num('pan', 13);
      target.x += -w.toCam.y * pan;
      target.z += w.toCam.x * pan;
      const pos = new THREE.Vector3(
        target.x + w.toCam.x * dist,
        top + num('camY', -14),
        target.z + w.toCam.y * dist
      );
      lookAt(pos, target, num('fov', 38));
      boardAtmosphere(w, pos.distanceTo(new THREE.Vector3(w.heroX, top, w.heroZ)));
    },
  };
};

// ---------------------------------------------------------------------------------------------
// The run's camera: GameScene's follow rig, stepped at sixty frames a second
// ---------------------------------------------------------------------------------------------

/**
 * GameScene's run camera: it stands 33 out on x and z and 16.6 up from the top block (times
 * `reach`, which is 1 on a landscape frame), eases toward that a fraction per frame, looks at the
 * top surface, and takes a shake and a punch toward the tower on every landing.
 */
class RunCamera {
  private readonly base: THREE.Vector3[] = [];
  private readonly look: THREE.Vector3[] = [];
  constructor(
    private readonly view: RunView,
    origin: { x: number; z: number },
    private readonly from: number,
    to: number,
    private readonly reach = 1
  ) {
    const desired = (real: number) => {
      const st = view.stateAt(view.run.simTick(real));
      const top = st.blocks[st.blocks.length - 1]!;
      return {
        base: new THREE.Vector3(
          top.x / FIX + origin.x + 33 * reach,
          (top.y + top.height / 2) / FIX + 16.6 * reach,
          origin.z + 33 * reach
        ),
        look: new THREE.Vector3(
          top.x / FIX + origin.x,
          (top.y + top.height) / FIX,
          (top.z ?? 0) / FIX + origin.z
        ),
      };
    };
    const settle = 240;
    const first = desired(from - settle);
    const b = first.base.clone();
    const l = first.look.clone();
    for (let r = from - settle; r <= to; r++) {
      const d = desired(r);
      b.x += (d.base.x - b.x) * 0.12;
      b.y += (d.base.y - b.y) * 0.08;
      b.z += (d.base.z - b.z) * 0.06;
      l.lerp(d.look, 0.08);
      if (r >= from) {
        this.base.push(b.clone());
        this.look.push(l.clone());
      }
    }
  }

  /** The camera at a wall-clock tick: the rig's pose plus the landing's shake and punch. */
  pose(real: number): { pos: THREE.Vector3; look: THREE.Vector3 } {
    const i = Math.max(0, Math.min(this.base.length - 1, real - this.from));
    const i0 = Math.floor(i);
    const i1 = Math.min(this.base.length - 1, i0 + 1);
    const pos = this.base[i0]!.clone().lerp(this.base[i1]!, i - i0);
    const look = this.look[i0]!.clone().lerp(this.look[i1]!, i - i0);
    const last = [...this.view.run.placements].reverse().find((p) => p.real <= real);
    if (last) {
      const t = (((real - last.real) / TICKS) * 1000) / 280;
      if (t >= 0 && t < 1) {
        const amp = (last.perfect ? 0.55 : 0.24) * (1 - t) * (1 - t) * this.reach;
        const phase = t * 40;
        pos.x += Math.sin(phase * 1.7 + 0.3) * amp;
        pos.y += Math.cos(phase * 1.3 + 1.1) * amp * 0.6;
        pos.z += Math.sin(phase * 1.9 + 2.4) * amp;
        const punch = last.perfect ? 1 : 0.4;
        const toward = look.clone().sub(pos).normalize();
        pos.addScaledVector(
          toward,
          punch * 1.6 * this.reach * Math.sin(Math.min(1, t * 2) * Math.PI)
        );
      }
    }
    return { pos, look };
  }
}

/** A finished run as the board draws it: one instanced tower that builds itself in. */
const boardTowerOf = (
  state: GameState,
  o: {
    x: number;
    z: number;
    faction: FactionId;
    appearAt: number;
    compress: { value: number };
    time: { value: number };
  }
) => {
  const entry: TowerMapEntry = {
    sessionId: 'hero',
    userId: 'hero',
    username: 'hero',
    score: state.score,
    blockCount: state.blocks.length,
    perfectStreak: state.perfectBlockCount,
    gameMode: 'rotating_block',
    timestamp: 0,
    towerBlocks: state.blocks.map((b) => ({
      x: b.x,
      y: b.y,
      z: b.z ?? 0,
      width: b.width,
      depth: b.depth ?? b.width,
      height: b.height,
      rotation: 0,
    })),
    height: state.blocks.reduce((m, b) => Math.max(m, b.y + b.height), 0),
    faction: o.faction,
    worldX: o.x,
    worldZ: o.z,
  };
  const plan = buildBoardInstances([entry], { x: o.x, z: o.z }, 1_000_000, () => o.appearAt);
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  geometry.setAttribute('aDelay', new THREE.InstancedBufferAttribute(plan.delays, 1));
  geometry.setAttribute(
    'aStone',
    new THREE.InstancedBufferAttribute(new Float32Array(plan.count), 1)
  );
  const mesh = new THREE.InstancedMesh(
    geometry,
    towerMaterial({ grow: { time: o.time }, compress: o.compress, stones: true }),
    plan.count
  );
  mesh.instanceMatrix.array.set(plan.matrices);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(plan.colors.slice(), 3);
  mesh.count = plan.count;
  mesh.frustumCulled = false;
  return { mesh, height: (entry.height ?? 0) / FIX };
};

/** index.css `.raise-mark`: the word a raise floats off the tower, over 2 s. */
const raiseMarkStyle = (age: number): { opacity: number; dy: number; scale: number } => {
  const t = clamp01(age / 2);
  // Keyframes at 0, 14, 24, 78 and 100 %, eased the way cubic-bezier(0.16, 1, 0.3, 1) eases.
  if (t < 0.14) {
    const k = easeOut(t / 0.14);
    return { opacity: k, dy: lerp(8, 0, k), scale: lerp(0.7, 1.12, k) };
  }
  if (t < 0.24) {
    const k = easeOut((t - 0.14) / 0.1);
    return { opacity: 1, dy: lerp(0, -3, k), scale: lerp(1.12, 1, k) };
  }
  if (t < 0.78) return { opacity: 1, dy: lerp(-3, -14, (t - 0.24) / 0.54), scale: 1 };
  const k = (t - 0.78) / 0.22;
  return { opacity: 1 - k, dy: lerp(-14, -30, k), scale: 1 };
};

/** An offset from an aim point, as distance, elevation and azimuth (about +y, from +z). */
const toSpherical = (v: THREE.Vector3) => {
  const d = v.length();
  return { d, el: Math.asin(v.y / d), az: Math.atan2(v.x, v.z) };
};
const fromSpherical = (d: number, el: number, az: number) =>
  new THREE.Vector3(
    Math.sin(az) * Math.cos(el) * d,
    Math.sin(el) * d,
    Math.cos(az) * Math.cos(el) * d
  );

/**
 * The promo video, in the game's own order:
 *   the run    -- framed by the run's camera, its HUD counting and calling the streak;
 *   the raise  -- the finished tower stands on its cell the way the board raises one, building in
 *                 from the ground with a shockwave and a "+1", while the camera pulls back;
 *   the map    -- the board's Map view: heights squashed, the viewer's plot lit by its beacon;
 *   the name   -- the wordmark and one line over the map.
 * Its first frame is a frame of the run with the wordmark on it.
 */
SCENES.promo = () => {
  const w = heroWorld();
  const faction = w.faction;
  const runUp = runUpOf(
    str('pattern', 'p,p,p,0.14,p,p,p'),
    num('repeat', 20),
    str('tail', 'p,p,p,0.3')
  );
  const shown = dropsOf(str('shown', 'p,p,p,0.24,p,p,p,p,p'));
  const run = playRun({
    seed: num('seed', 11),
    faction,
    drops: [...runUp, ...shown],
    minWait: num('wait', 14),
    speedCap: num('speedCap', 900),
  });
  const view = new RunView(run);
  view.group.position.set(w.heroX, 0, w.heroZ);
  scene.add(view.group);
  const nUp = runUp.length;
  const startReal = run.placements[nUp - 1]!.real + num('lead', 7);
  const lastShown = run.placements[run.placements.length - 1]!;
  const lastAt = (lastShown.real - startReal) / TICKS;
  info.placements = run.placements.length;
  info.lastDropAt = lastAt.toFixed(2);

  // Beats, in seconds of video.
  const duration = num('duration', 12);
  const raiseAt = num('raiseAt', lastAt + 0.75);
  // Long and gently eased: Reddit asks for slow pans and zooms, and this one sweeps a city of
  // thin bright lines across the frame.
  const pullLen = num('pullLen', 4.8);
  const cardIn = num('cardIn', raiseAt + pullLen - 0.4);

  const rig = new RunCamera(
    view,
    { x: w.heroX, z: w.heroZ },
    startReal - 2,
    startReal + Math.ceil((raiseAt + 1) * TICKS)
  );

  // The finished tower as the board will draw it, building in when it is raised.
  const growTime = { value: 0 };
  const hero = boardTowerOf(lastShown.state, {
    x: w.heroX,
    z: w.heroZ,
    faction,
    appearAt: raiseAt,
    compress: w.city.compress,
    time: growTime,
  });
  hero.mesh.visible = false;
  scene.add(hero.mesh);
  const beacon = plotBeacon(w.heroX, w.heroZ, factionHex(faction));
  scene.add(beacon);
  const outline = keepOutline(w.heroX, w.heroZ, 0, factionHex(faction));
  scene.add(outline);

  // The raise's shockwave: LandingRings at the foot of the tower, a perfect's two rings.
  const shock = [0, 1].map(() => {
    const mat = new THREE.LineBasicMaterial({
      color: '#ffffff',
      transparent: true,
      opacity: 0,
      toneMapped: false,
    });
    const loop = new THREE.LineLoop(ringGeometry(), mat);
    loop.position.set(w.heroX, 0.03, w.heroZ);
    loop.frustumCulled = false;
    loop.visible = false;
    scene.add(loop);
    return { loop, mat };
  });

  // Overlay: the opening wordmark, the HUD, the raise mark, the end card.
  overlay.innerHTML = '';
  const opening = document.createElement('div');
  opening.innerHTML =
    `<div style="position:absolute; left:0; right:0; top:0; height:42%; background: linear-gradient(to bottom, rgba(0,8,20,0.62), rgba(0,8,20,0));"></div>` +
    wordmark({ left: '7%', top: '10.5%', size: 0.16 * window.innerHeight });
  const hud = new Hud();
  const mark = document.createElement('div');
  mark.style.cssText = `position:absolute; white-space:nowrap; font: 800 ${clampPx(1.8 * rem, 9 * vw, 2.4 * rem)}px/0.9 'Big Shoulders Display';
    letter-spacing:0.02em; text-transform:uppercase; color:${factionHex(faction)}; text-shadow:${HALO}; opacity:0;`;
  mark.textContent = str('mark', '+1');
  const card = document.createElement('div');
  card.style.cssText = 'position:absolute; inset:0;';
  card.innerHTML = `
    <div class="scrim" style="position:absolute; left:0; right:0; top:0; height:55%; background: linear-gradient(to bottom, rgba(0,8,20,0.7), rgba(0,8,20,0));"></div>
    <div class="mark">${wordmark({ left: '7%', top: '10.5%', size: 0.16 * window.innerHeight })}</div>
    <div class="line" style="position:absolute; left:7.3%; top:27.5%; white-space:nowrap;
      font: 700 ${0.05 * window.innerHeight}px/1 'Big Shoulders Display'; letter-spacing:0.08em; text-transform:uppercase;
      color:rgba(243,247,250,0.88); text-shadow:${HALO};">${str('tagline', 'Stack high. Claim the map.')}</div>`;
  overlay.append(opening, hud.root, mark, card);
  const scrim = card.querySelector<HTMLElement>('.scrim')!;
  const cardMark = card.querySelector<HTMLElement>('.mark')!;
  const line = card.querySelector<HTMLElement>('.line')!;

  return {
    duration,
    frame(t) {
      const real = startReal + t * TICKS;
      const raised = t >= raiseAt;
      view.group.visible = !raised;
      hero.mesh.visible = raised;
      if (!raised) view.update(real, { hideMoving: real > lastShown.real, since: startReal });

      // The board's clock and its height squash: the raise builds in on the clock, and the map
      // eases toward squashed heights the way BoardTowers does (5 per second).
      growTime.value = t;
      // The Map view squashes heights; the video keeps them true by default (squash=1 restores
      // it). With the camera riding the tower's top, the top sinking a hundred and fifty units
      // swept the whole frame at more than a frame-width a second, and the short skyline the
      // video stands in reads as a map without it.
      const sinceRaise = Math.max(0, t - raiseAt - num('squashDelay', 2.4));
      const c =
        raised && query.get('squash') === '1'
          ? 1 - Math.exp(-num('squashRate', 2) * sinceRaise)
          : 0;
      w.city.compress.value = c;

      // Camera: the run's rig, then a slow crane up and away from the same tower. The aim stays on
      // the tower, sinking only to its middle, so the tower holds its place on the screen while the
      // map opens round it; the camera never passes through the skyline, and the move turns and
      // tilts by a few degrees only (Reddit asks for slow pans and zooms).
      const runPose = rig.pose(Math.min(real, startReal + raiseAt * TICKS));
      const p = window01(t, raiseAt, raiseAt + pullLen, easeInOutSine);
      const runOffset = toSpherical(runPose.pos.clone().sub(runPose.look));
      const drift = Math.max(0, t - raiseAt) * num('drift', 0.03);
      // It ends on the featured image's composition, wider: the tower right of centre, the
      // skyline low, the sky clear top left for the wordmark to come back to.
      const endAz = runOffset.az + (num('endTurn', 0) * Math.PI) / 180;
      const right = new THREE.Vector3(Math.cos(endAz), 0, -Math.sin(endAz));
      const endLook = new THREE.Vector3(w.heroX, num('endLookY', 178), w.heroZ).addScaledVector(
        right,
        -num('endPan', 42)
      );
      // The aim moves mostly late, when the camera is far and the same shift is a small angle.
      const look = runPose.look.clone().lerp(endLook, Math.pow(p, num('aimLate', 2)));
      const offset = fromSpherical(
        Math.exp(lerp(Math.log(runOffset.d), Math.log(num('endDist', 290)), p)),
        lerp(runOffset.el, (num('endEl', 9) * Math.PI) / 180, p),
        lerp(runOffset.az, endAz, p) + drift
      );
      const pos = look.clone().add(offset);
      lookAt(pos, look, 30);
      const mapDistanceNow = offset.length();

      // The board's fog and floor follow the distance to the subject; during the run they are
      // set for the city behind it.
      const fd = Math.max(num('fogD', 150), mapDistanceNow * num('fogK', 0.9));
      w.fog.near = fd * 0.9;
      w.fog.far = fd * 3.4;
      w.floor.material.uniforms.fadeDistance!.value = fd * 1.7;
      w.floor.update(camera);
      beacon.visible = raised;
      (beacon.material as THREE.ShaderMaterial).uniforms.uOpacity!.value =
        0.34 * window01(t, raiseAt + 0.6, raiseAt + 2.2);
      outline.visible = true;

      shock.forEach((ring, i) => {
        const k = ((t - raiseAt) * 1000 - i * 70) / 420;
        ring.loop.visible = raised && k >= 0 && k <= 1;
        const grow = 1 + easeOut(clamp01(k)) * 1.6 * (i === 1 ? 1.4 : 1);
        ring.loop.scale.set(8 * grow, 1, 8 * grow);
        ring.mat.opacity = (1 - clamp01(k)) * (i === 1 ? 0.7 : 1);
      });

      // Overlay.
      opening.style.opacity = String(1 - window01(t, 0.55, 0.95));
      hud.update(view, real, {
        anchor: { x: 50, y: 36 },
        scoreX: 50,
        opacity: 1 - window01(t, raiseAt - 0.35, raiseAt),
        scoreOpacity: window01(t, 0.95, 1.25),
        accent: factionHex(faction),
        since: startReal,
      });
      const markAge = t - raiseAt - 0.55;
      if (markAge >= 0 && markAge < 2) {
        const builtTop = compressHeight(hero.height, c);
        const at = toScreen(new THREE.Vector3(w.heroX, builtTop + 2.5, w.heroZ));
        const st = raiseMarkStyle(markAge);
        mark.style.left = `${at.x}%`;
        mark.style.top = `${at.y}%`;
        mark.style.opacity = String(st.opacity);
        mark.style.transform = `translate(-50%, calc(-100% + ${st.dy}px)) scale(${st.scale})`;
      } else mark.style.opacity = '0';
      // The end card: the opening's wordmark back where it was, the line rising in under it.
      scrim.style.opacity = String(window01(t, cardIn - 0.3, cardIn + 0.6));
      const m = window01(t, cardIn, cardIn + 0.6, easeOut);
      cardMark.style.opacity = String(m);
      const l = window01(t, cardIn + 0.4, cardIn + 1.0, easeOut);
      line.style.opacity = String(l);
      line.style.transform = `translateY(${lerp(30, 0, l)}%)`;
    },
  };
};

/**
 * The fallback GIF: a seamless loop of a long perfect streak, framed by the run's camera.
 *
 * Everything in a perfect streak repeats: the blocks keep the tower's full width and its frozen
 * colour, the slide alternates sides every four blocks and runs at a capped speed, the camera's
 * follow settles into the same lag every drop, and past 108 in a row the HUD says the same word
 * (Orbit, in gold) on every landing. So eight drops later the frame is the frame it started on,
 * moved up eight blocks, and the camera has moved up with it. The score would give it away, so
 * the loop leaves it out.
 */
SCENES.loop = () => {
  const faction = str('faction', 'cyan') as FactionId;
  const floor = createFloor({ fadeDistance: 260 });
  scene.add(floor.mesh);
  const lead = num('streak', 112);
  const period = num('period', 8);
  const run = playRun({
    seed: num('seed', 11),
    faction,
    drops: Array.from({ length: lead + period + 4 }, () => 'perfect' as Drop),
    minWait: num('wait', 14),
    speedCap: num('speedCap', 900),
  });
  const view = new RunView(run);
  view.group.position.set(4, 0, 4);
  scene.add(view.group);
  const a = run.placements[lead - 1]!;
  const b = run.placements[lead - 1 + period]!;
  const start = a.real + num('phase', 20);
  const span = b.real - a.real;
  info.loopSeconds = (span / TICKS).toFixed(4);
  info.streakAtStart = a.streak;
  const rig = new RunCamera(view, { x: 4, z: 4 }, start - 2, start + span + 4);
  overlay.innerHTML =
    query.get('logo') === '0'
      ? ''
      : `<div style="position:absolute; left:0; right:0; top:0; height:42%; background: linear-gradient(to bottom, rgba(0,8,20,0.62), rgba(0,8,20,0));"></div>` +
        wordmark({ left: '7%', top: '10.5%', size: num('ls', 0.16) * window.innerHeight });
  const hud = new Hud();
  if (query.get('hud') !== '0') overlay.append(hud.root);
  return {
    duration: span / TICKS,
    frame(t) {
      const real = start + t * TICKS;
      view.update(real);
      const pose = rig.pose(real);
      lookAt(pose.pos, pose.look, 30);
      floor.update(camera);
      hud.update(view, real, {
        anchor: { x: 50, y: 36 },
        scoreX: 50,
        opacity: 1,
        scoreOpacity: 0,
        accent: factionHex(faction),
      });
    },
  };
};

/**
 * The icon: the run's moment, close. A tower of the run's blocks, the block in hand sliding in,
 * the piece a near miss cut off falling away with its sparks. No city: at 64 pixels it is noise.
 */
SCENES.icon = () => {
  const faction = str('faction', 'cyan') as FactionId;
  const floor = createFloor({ fadeDistance: num('fade', 180), originX: 0, originZ: 0 });
  scene.add(floor.mesh);
  scene.add(createTiles([{ x: 4, z: 4, faction }], 'keep'));
  const run = playRun({
    seed: num('seed', 3),
    faction,
    drops: dropsOf(str('drops', 'p,p,p,0.14,p,p,0.2,p,p,0.3')),
    minWait: 14,
    ...(query.has('speedCap') ? { speedCap: num('speedCap', 900) } : {}),
  });
  const view = new RunView(run);
  view.group.position.set(4, 0, 4);
  // Only the piece being cut now: the earlier offcuts lying about are the game's record of a
  // run, and at 64 pixels they read as stray marks.
  view.debrisMaxAge = num('debrisAge', 0.8);
  scene.add(view.group);
  const last = run.placements[run.placements.length - 1]!;
  info.placements = run.placements.length;
  return {
    frame(t) {
      const real = last.real + num('after', 7) + t * TICKS;
      view.update(real);
      const top = view.topAt(real);
      const target = new THREE.Vector3(4 + num('tx', 0), top + num('lift', -3), 4 + num('tz', 0));
      const az = (num('azim', 45) * Math.PI) / 180;
      const el = (num('elev', 28) * Math.PI) / 180;
      const dist = num('dist', 60);
      lookAt(
        {
          x: target.x + Math.sin(az) * Math.cos(el) * dist,
          y: target.y + Math.sin(el) * dist,
          z: target.z + Math.cos(az) * Math.cos(el) * dist,
        },
        target,
        num('fov', 30)
      );
      floor.update(camera);
    },
  };
};

/**
 * The banners: a slice through the middle of the board's Map view. The camera stands where the
 * Map view stands (its pitch, its distance, its slow drift) and keeps the Map view's horizontal
 * field of view, so a banner of any shape is the same picture as the game's map, cropped.
 * No type: Reddit sets the community's name beside it.
 */
SCENES.banner = () => {
  const w = heroWorld();
  const run = playRun({
    seed: num('seed', 11),
    faction: w.faction,
    drops: runUpOf(str('pattern', 'p,p,p,0.14,p,p,p'), num('repeat', 20), str('tail', 'p,p,p')),
    minWait: 14,
    speedCap: 900,
  });
  const hero = boardTowerOf(run.placements[run.placements.length - 1]!.state, {
    x: w.heroX,
    z: w.heroZ,
    faction: w.faction,
    appearAt: -1000,
    compress: w.city.compress,
    time: { value: 0 },
  });
  scene.add(hero.mesh);
  if (query.get('beacon') !== '0') scene.add(plotBeacon(w.heroX, w.heroZ, factionHex(w.faction)));
  scene.add(keepOutline(w.heroX, w.heroZ, 0, factionHex(w.faction)));
  return {
    frame() {
      w.city.compress.value = num('compress', 1);
      const aspect = window.innerWidth / window.innerHeight;
      // The Map view at 3:2 sees 43.6 degrees across; keep that, whatever the banner's shape.
      const hfov = (num('hfov', 43.6) * Math.PI) / 180;
      const fov = (2 * Math.atan(Math.tan(hfov / 2) / aspect) * 180) / Math.PI;
      const dist = num(
        'dist',
        baseDistance('all', { aspect: 1.5, fovDeg: 30, extent: 288 }) * num('zoom', 0.6)
      );
      const az = (num('azim', 45) * Math.PI) / 180;
      const el = num('pitch', PITCH.all);
      const target = new THREE.Vector3(
        w.heroX + num('tx', 0),
        num('ty', 0),
        w.heroZ + num('tz', 0)
      );
      lookAt(
        {
          x: target.x + Math.sin(az) * Math.cos(el) * dist,
          y: target.y + Math.sin(el) * dist,
          z: target.z + Math.cos(az) * Math.cos(el) * dist,
        },
        target,
        fov
      );
      // BoardCamera's fog and BoardScene's floor fade for this distance.
      w.fog.near = dist * 0.9;
      w.fog.far = dist * 3.4;
      w.floor.material.uniforms.fadeDistance!.value = dist * 1.7;
      w.floor.update(camera);
    },
  };
};

/**
 * The logo lockup: the app icon and the wordmark side by side on the game's night. Nothing 3D;
 * the icon is the rendered one (build.mjs puts it in out/), so the two can never disagree.
 */
SCENES.lockup = () => {
  const h = window.innerHeight;
  overlay.innerHTML = `
    <div style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; gap:${0.075 * h}px;">
      <img src="${str('icon', './out/icon-512.png')}" style="height:${num('iconH', 0.6) * h}px; border-radius:${num('iconH', 0.6) * h * 0.22}px;" />
      <div style="font: 800 ${num('ls', 0.42) * h}px/0.82 'Big Shoulders Display'; letter-spacing:0.01em; color:#f3f7fa; white-space:nowrap; padding-top:${0.03 * h}px;">STONEFALL</div>
    </div>`;
  return {
    frame() {
      lookAt({ x: 0, y: 10, z: 10 }, { x: 0, y: 0, z: 0 }, 30);
    },
  };
};

// ---------------------------------------------------------------------------------------------
// /brag: the launch video's 3D plates (brag-output/brag-plan.md)
// ---------------------------------------------------------------------------------------------

/**
 * The run the video is cut from: a run-up to a tall, fast tower, one near miss that breaks the
 * streak, then a long run of perfects. The hook shows the first of those (Flush, Plumb, Dead
 * level), the climb the hundred and eighth (Orbit), the raise the tower that made.
 */
const bragRun = () => {
  const runUp = runUpOf(str('pattern', 'p,p,p,0.14,p,p,p'), num('repeat', 8), str('tail', '0.3'));
  const run = playRun({
    seed: num('seed', 11),
    faction: 'cyan',
    drops: [...runUp, ...Array.from({ length: num('streak', 112) }, () => 'perfect' as Drop)],
    minWait: num('wait', 14),
    window: num('window', 0.85),
    ...(query.has('speedCap') ? { speedCap: num('speedCap', 1500) } : {}),
  });
  // The first perfect after the miss: the streak's first block.
  const first = run.placements.findIndex((p, i) => i >= runUp.length && p.streak === 1);
  const orbit = run.placements.findIndex((p, i) => i > first && p.streak === 108);
  info.runUp = runUp.length;
  info.placements = run.placements.length;
  info.first = first;
  info.orbit = orbit;
  info.streakAtEnd = run.placements[run.placements.length - 1]?.streak;
  return { run, first, orbit };
};

/** The streak name the HUD says for a placement, or null when it says the same as last time. */
const newName = (p: Placement) =>
  p.perfect && STREAK_NAMES.some((n) => n.streak === p.streak) ? streakName(p.streak) : null;
const STREAK_NAMES = [1, 2, 4, 6, 9, 13, 18, 24, 31, 39, 48, 58, 69, 81, 94, 108].map((streak) => ({ streak }));

/**
 * The run's plates: `part=hook` is the run camera on the first perfects, the tower pushed right of
 * frame for the word tower; `part=climb` rises up the tower to its top as the hundred and eighth
 * perfect lands. Both report their landings in clip seconds, for the type and the music.
 */
SCENES['brag-run'] = () => {
  const w = heroWorld();
  const { run, first, orbit } = bragRun();
  const view = new RunView(run);
  view.group.position.set(w.heroX, 0, w.heroZ);
  scene.add(view.group);
  const part = str('part', 'hook');
  const shift = num('shift', 0.2);
  const fogD = num('fogD', 170);
  const atmosphere = () => {
    w.fog.near = fogD * 0.9;
    w.fog.far = fogD * 3.4;
    w.floor.material.uniforms.fadeDistance!.value = fogD * 1.7;
    w.floor.update(camera);
  };
  const tick0 =
    part === 'hook'
      ? run.placements[first]!.real - num('lead', 0.6) * TICKS
      : run.placements[orbit]!.real - num('orbitAt', 2.5) * TICKS;
  const shown = run.placements.filter((p) => p.real >= tick0 && p.real <= tick0 + num('dur', 4.2) * TICKS);
  info.landings = shown.map((p) => ({
    t: +((p.real - tick0) / TICKS).toFixed(4),
    blocks: p.index + 1,
    streak: p.streak,
    perfect: p.perfect,
    name: newName(p),
    off: p.perfect ? null : offWord(p.state.lastPlacement),
  }));
  info.top = view.topAt(run.placements[orbit]!.real);
  const rig = part === 'hook' ? new RunCamera(view, { x: w.heroX, z: w.heroZ }, tick0 - 2, tick0 + 6 * TICKS) : null;
  return {
    frame(t) {
      const real = tick0 + t * TICKS;
      view.update(real, { since: tick0 - TICKS });
      lensShift.x = shift;
      if (rig) {
        const pose = rig.pose(real);
        lookAt(pose.pos, pose.look, 30);
      } else {
        // A pedestal up the tower's face to its top: the camera rises with its aim, slowly.
        const top = view.topAt(real);
        const k = easeInOutSine(clamp01(t / num('riseLen', 3.0)));
        const y = top - lerp(num('rise', 46), num('endBelow', 6), k);
        const az = (num('azim', 45) * Math.PI) / 180;
        const el = (num('elev', 9) * Math.PI) / 180;
        const d = num('dist', 62);
        const look = new THREE.Vector3(w.heroX, y, w.heroZ);
        lookAt(look.clone().add(fromSpherical(d, el, az)), look, 30);
      }
      atmosphere();
    },
  };
};

/**
 * The raise and the outro: the tower the climb finished stands up out of its cell in the board's
 * look, a shockwave on the floor and "+1" over it, in a wide shot of the skyline that drifts slowly
 * to the end. Unsquashed: the skyline reads as a map from here, and the tower stands over it.
 */
SCENES['brag-raise'] = () => {
  const w = heroWorld();
  const { run, orbit } = bragRun();
  const raiseAt = num('raiseAt', 0.3);
  const growTime = { value: 0 };
  const hero = boardTowerOf(run.placements[orbit]!.state, {
    x: w.heroX,
    z: w.heroZ,
    faction: w.faction,
    appearAt: raiseAt,
    compress: w.city.compress,
    time: growTime,
  });
  scene.add(hero.mesh);
  const beacon = plotBeacon(w.heroX, w.heroZ, factionHex(w.faction));
  scene.add(beacon, keepOutline(w.heroX, w.heroZ, 0, factionHex(w.faction)));
  const shock = [0, 1].map((i) => {
    const mat = new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, toneMapped: false });
    const loop = new THREE.LineLoop(ringGeometry(), mat);
    loop.position.set(w.heroX, 0.03, w.heroZ);
    loop.frustumCulled = false;
    loop.visible = false;
    scene.add(loop);
    return { loop, mat, pass: i };
  });
  info.top = hero.height;
  // The raise mark (index.css .raise-mark): "+1" in the player's colour, floating off the top.
  const mark = document.createElement('div');
  mark.style.cssText = `position:absolute; white-space:nowrap; font: 800 ${num('markPx', 44)}px/0.9 'Big Shoulders Display';
    letter-spacing:0.02em; color:${factionHex(w.faction)}; text-shadow:${HALO}; opacity:0;`;
  mark.textContent = '+1';
  overlay.append(mark);
  const fogD = num('fogD', 520);
  return {
    frame(t) {
      growTime.value = t;
      const az = ((num('azim', 45) + num('drift', 2.2) * t) * Math.PI) / 180;
      const right = new THREE.Vector3(Math.cos(az), 0, -Math.sin(az));
      const look = new THREE.Vector3(w.heroX, num('lookY', 150), w.heroZ).addScaledVector(right, -num('pan', 70));
      const d = num('dist', 470) - num('push', 30) * easeInOutSine(clamp01(t / 8));
      lookAt(look.clone().add(fromSpherical(d, (num('elev', 7) * Math.PI) / 180, az)), look, 30);
      w.fog.near = fogD * 0.9;
      w.fog.far = fogD * 3.4;
      w.floor.material.uniforms.fadeDistance!.value = fogD * 1.7;
      w.floor.update(camera);
      (beacon.material as THREE.ShaderMaterial).uniforms.uOpacity!.value = 0.34 * window01(t, raiseAt + 0.5, raiseAt + 2);
      shock.forEach((ring) => {
        const k = ((t - raiseAt) * 1000 - ring.pass * 70) / 420;
        ring.loop.visible = k >= 0 && k <= 1;
        const grow = 1 + easeOut(clamp01(k)) * 1.6 * (ring.pass === 1 ? 1.4 : 1);
        ring.loop.scale.set(8 * grow, 1, 8 * grow);
        ring.mat.opacity = (1 - clamp01(k)) * (ring.pass === 1 ? 0.7 : 1);
      });
      const age = t - raiseAt - 0.45;
      if (age >= 0 && age < 2) {
        const at = toScreen(new THREE.Vector3(w.heroX, hero.height + 2.5, w.heroZ));
        const st = raiseMarkStyle(age);
        mark.style.left = `${at.x}%`;
        mark.style.top = `${at.y}%`;
        mark.style.opacity = String(st.opacity);
        mark.style.transform = `translate(-50%, calc(-100% + ${st.dy}px)) scale(${st.scale})`;
      } else mark.style.opacity = '0';
    },
  };
};

// ---------------------------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------------------------

const build = SCENES[SCENE];
if (!build) throw new Error(`no scene ${SCENE}`);
const active = build();
info.buffer = [pipe.renderer.domElement.width, pipe.renderer.domElement.height];

const frame = (t: number) => {
  active.frame(t);
  pipe.render();
};

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

// Fonts and any images in the overlay are loaded before the first frame is drawn.
const imagesLoaded = () =>
  Promise.all(
    [...overlay.querySelectorAll('img')].map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise((r) => img.addEventListener('load', r, { once: true }))
    )
  );

window.stage = {
  ready: document.fonts.ready.then(imagesLoaded).then(() => frame(num('t', 0))),
  frame,
  info,
  ...(active.duration !== undefined ? { duration: active.duration } : {}),
};
void FACTIONS;
