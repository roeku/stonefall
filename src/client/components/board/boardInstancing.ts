import type { TowerBlock, TowerMapEntry } from '../../../shared/types/api';
import { PLAYER_COLOR_THEMES } from '../../constants/playerColors';

/**
 * Turns a list of placed towers into the flat per-instance arrays one InstancedMesh needs.
 *
 * Pure and free of three.js so it can be unit-tested in node. The renderer does nothing but
 * hand these arrays to the GPU.
 *
 * Every block is one box instance. The body is black and only the rim of each face is lit, so a
 * tower is a stack of glowing outlines with a solid silhouette -- the same look the game uses,
 * and what makes a thousand of them read as a skyline rather than a wireframe smear.
 */

/** Block coordinates are fixed-point: 1000 = one world unit. */
const FIXED = 1000;

/**
 * Blocks the board will draw in full detail.
 *
 * A real subreddit can hold thousands of towers of a few hundred blocks each, which is more
 * geometry than a phone will push at 60fps. Towers nearest the camera's focus get every block;
 * once the budget is spent the rest are drawn as a single box the size of the whole tower. At
 * the distance those towers are seen from, the two are indistinguishable.
 */
export const BLOCK_BUDGET = 60_000;
export const MOBILE_BLOCK_BUDGET = 22_000;

/** How long one tower takes to build itself, bottom to top, when it first appears. */
export const BUILD_SECONDS = 0.45;

export interface TowerFootprint {
  /** Tower session id, which is how selection refers to it. */
  id: string;
  /** Index into the towers array this plan was built from. */
  index: number;
  /** World-space centre of the tower's bounding box. */
  centerX: number;
  centerY: number;
  centerZ: number;
  /** World-space size of the bounding box. */
  width: number;
  height: number;
  depth: number;
  /** World y the tower stands on: the ground, or the top of whatever it is stacked on. */
  baseY: number;
  blockCount: number;
  /** False when the tower was drawn as a single silhouette box. */
  detailed: boolean;
}

export interface BoardInstancePlan {
  count: number;
  /** Column-major 4x4 per instance. */
  matrices: Float32Array;
  /** Linear RGB rim colour per instance. */
  colors: Float32Array;
  /** Absolute clock time each instance starts growing, in seconds. */
  delays: Float32Array;
  /** Index into `footprints` of the tower each instance belongs to. */
  towerOfInstance: Int32Array;
  /** One per drawn tower, in the order of the input array. */
  footprints: TowerFootprint[];
  detailedTowers: number;
  totalBlocks: number;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Deterministic hash to [0, 1), so a tower without a declared colour always gets the same one. */
const hashUnit = (input: string): number => {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
};

const hexToRgb = (hex: string): Rgb => {
  const clean = hex.replace('#', '');
  const n = parseInt(clean.length === 3 ? clean.replace(/(.)/g, '$1$1') : clean, 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
};

const BLUE = hexToRgb(PLAYER_COLOR_THEMES.blue.accentHex);
const ORANGE = hexToRgb(PLAYER_COLOR_THEMES.orange.accentHex);

/** Rim colour for a tower: the owner's declared side, or a stable coin flip when undeclared. */
export const rimColorFor = (tower: Pick<TowerMapEntry, 'sessionId' | 'playerColorChoice'>): Rgb => {
  if (tower.playerColorChoice === 'blue') return BLUE;
  if (tower.playerColorChoice === 'orange') return ORANGE;
  return hashUnit(tower.sessionId) < 0.5 ? BLUE : ORANGE;
};

interface Box {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

const isDrawable = (b: TowerBlock | undefined): b is TowerBlock =>
  !!b &&
  Number.isFinite(b.x) &&
  Number.isFinite(b.y) &&
  Number.isFinite(b.width) &&
  Number.isFinite(b.height) &&
  b.width > 0 &&
  b.height > 0;

/** Bounding box of a tower's blocks in tower-local world units. Null when nothing is drawable. */
export const towerBox = (blocks: readonly TowerBlock[] | undefined): Box | null => {
  if (!blocks) return null;
  let box: Box | null = null;
  for (const b of blocks) {
    if (!isDrawable(b)) continue;
    const x = b.x / FIXED;
    const y = b.y / FIXED;
    const z = (b.z ?? 0) / FIXED;
    const w = b.width / FIXED;
    const h = b.height / FIXED;
    const d = (b.depth ?? b.width) / FIXED;
    // A rotated block sweeps a wider footprint than its width; use the diagonal so the box
    // still contains it. Only the footprint is affected -- height is unrotated.
    const rot = ((b.rotation ?? 0) / FIXED) * (Math.PI / 180);
    const c = Math.abs(Math.cos(rot));
    const s = Math.abs(Math.sin(rot));
    const hw = (w * c + d * s) / 2;
    const hd = (w * s + d * c) / 2;
    if (!box) {
      box = { minX: x - hw, maxX: x + hw, minY: y, maxY: y + h, minZ: z - hd, maxZ: z + hd };
    } else {
      box.minX = Math.min(box.minX, x - hw);
      box.maxX = Math.max(box.maxX, x + hw);
      box.minY = Math.min(box.minY, y);
      box.maxY = Math.max(box.maxY, y + h);
      box.minZ = Math.min(box.minZ, z - hd);
      box.maxZ = Math.max(box.maxZ, z + hd);
    }
  }
  return box;
};

/**
 * Writes a translate * rotateY * scale matrix in three.js column-major layout.
 *
 * Written by hand rather than through Matrix4.compose so this module stays independent of
 * three.js. The layout matches Matrix4.compose for a rotation about Y exactly.
 */
export const writeMatrix = (
  out: Float32Array,
  offset: number,
  tx: number,
  ty: number,
  tz: number,
  rotY: number,
  sx: number,
  sy: number,
  sz: number
): void => {
  const c = Math.cos(rotY);
  const s = Math.sin(rotY);
  out[offset] = c * sx;
  out[offset + 1] = 0;
  out[offset + 2] = -s * sx;
  out[offset + 3] = 0;
  out[offset + 4] = 0;
  out[offset + 5] = sy;
  out[offset + 6] = 0;
  out[offset + 7] = 0;
  out[offset + 8] = s * sz;
  out[offset + 9] = 0;
  out[offset + 10] = c * sz;
  out[offset + 11] = 0;
  out[offset + 12] = tx;
  out[offset + 13] = ty;
  out[offset + 14] = tz;
  out[offset + 15] = 1;
};

/**
 * Decides which towers get full detail.
 *
 * Nearest to the focus first, because that is what the camera is looking at. Returns the set of
 * input indices that fit inside the budget.
 */
export const chooseDetailed = (
  towers: readonly TowerMapEntry[],
  focus: { x: number; z: number },
  budget: number
): Set<number> => {
  const order = towers
    .map((t, index) => ({
      index,
      d2: ((t.worldX ?? 0) - focus.x) ** 2 + ((t.worldZ ?? 0) - focus.z) ** 2,
      n: t.towerBlocks?.length ?? 0,
    }))
    .filter((e) => e.n > 0)
    .sort((a, b) => a.d2 - b.d2 || a.index - b.index);

  const detailed = new Set<number>();
  let used = 0;
  for (const e of order) {
    if (used + e.n > budget) continue;
    used += e.n;
    detailed.add(e.index);
  }
  return detailed;
};

/**
 * Builds the instance arrays.
 *
 * `appearAt(id, distance)` returns the absolute clock time a tower should start growing. The
 * caller owns that map so a tower that was already on screen keeps its old time (and stays
 * fully grown) when the list is rebuilt around it, while a new one animates in.
 */
export const buildBoardInstances = (
  towers: readonly TowerMapEntry[],
  focus: { x: number; z: number },
  budget: number,
  appearAt: (id: string, distance: number) => number
): BoardInstancePlan => {
  const detailed = chooseDetailed(towers, focus, budget);

  // First pass: sizes, so the arrays can be allocated once.
  let count = 0;
  let totalBlocks = 0;
  const boxes: Array<Box | null> = towers.map((t, i) => {
    const box = towerBox(t.towerBlocks);
    if (!box) return null;
    const n = t.towerBlocks.length;
    totalBlocks += n;
    count += detailed.has(i) ? n : 1;
    return box;
  });

  const matrices = new Float32Array(count * 16);
  const colors = new Float32Array(count * 3);
  const delays = new Float32Array(count);
  const towerOfInstance = new Int32Array(count);
  const footprints: TowerFootprint[] = [];

  let cursor = 0;
  towers.forEach((tower, index) => {
    const box = boxes[index];
    if (!box) return;

    const worldX = tower.worldX ?? 0;
    const worldZ = tower.worldZ ?? 0;
    const baseY = (tower.stackBaseY ?? 0) / FIXED;
    const distance = Math.hypot(worldX - focus.x, worldZ - focus.z);
    const startAt = appearAt(tower.sessionId, distance);
    const rgb = rimColorFor(tower);
    const isDetailed = detailed.has(index);

    if (isDetailed) {
      const blocks = tower.towerBlocks;
      const n = blocks.length;
      // Bottom first, so the build-in climbs.
      const ordered = [...blocks].sort((a, b) => a.y - b.y);
      ordered.forEach((b, i) => {
        if (!isDrawable(b)) return;
        const w = b.width / FIXED;
        const h = b.height / FIXED;
        const d = (b.depth ?? b.width) / FIXED;
        writeMatrix(
          matrices,
          cursor * 16,
          worldX + b.x / FIXED,
          baseY + b.y / FIXED + h / 2,
          worldZ + (b.z ?? 0) / FIXED,
          ((b.rotation ?? 0) / FIXED) * (Math.PI / 180),
          w,
          h,
          d
        );
        colors[cursor * 3] = rgb.r;
        colors[cursor * 3 + 1] = rgb.g;
        colors[cursor * 3 + 2] = rgb.b;
        delays[cursor] = startAt + (i / Math.max(1, n)) * BUILD_SECONDS;
        towerOfInstance[cursor] = footprints.length;
        cursor += 1;
      });
    } else {
      writeMatrix(
        matrices,
        cursor * 16,
        worldX + (box.minX + box.maxX) / 2,
        baseY + (box.minY + box.maxY) / 2,
        worldZ + (box.minZ + box.maxZ) / 2,
        0,
        Math.max(0.5, box.maxX - box.minX),
        Math.max(0.5, box.maxY - box.minY),
        Math.max(0.5, box.maxZ - box.minZ)
      );
      colors[cursor * 3] = rgb.r;
      colors[cursor * 3 + 1] = rgb.g;
      colors[cursor * 3 + 2] = rgb.b;
      delays[cursor] = startAt;
      towerOfInstance[cursor] = footprints.length;
      cursor += 1;
    }

    footprints.push({
      id: tower.sessionId,
      index,
      centerX: worldX + (box.minX + box.maxX) / 2,
      centerY: baseY + (box.minY + box.maxY) / 2,
      centerZ: worldZ + (box.minZ + box.maxZ) / 2,
      width: box.maxX - box.minX,
      height: box.maxY - box.minY,
      depth: box.maxZ - box.minZ,
      baseY,
      blockCount: tower.towerBlocks.length,
      detailed: isDetailed,
    });
  });

  // Undrawable blocks inside an otherwise detailed tower leave unused slots at the end.
  return {
    count: cursor,
    matrices: cursor === count ? matrices : matrices.subarray(0, cursor * 16),
    colors: cursor === count ? colors : colors.subarray(0, cursor * 3),
    delays: cursor === count ? delays : delays.subarray(0, cursor),
    towerOfInstance: cursor === count ? towerOfInstance : towerOfInstance.subarray(0, cursor),
    footprints,
    detailedTowers: detailed.size,
    totalBlocks,
  };
};
