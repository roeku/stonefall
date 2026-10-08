import type { TowerBlock, TowerMapEntry } from './api';

/**
 * A tower's blocks, packed for the board.
 *
 * Geometry is nearly all of the board: as objects every block costs about 83 bytes of JSON, so a
 * busy day's 40,000 blocks came to over 3 MB, read from Redis, parsed and sent on every look at
 * the map. A tower's blocks barely differ from one block to the next: each sits on the one below,
 * every block is the same height, nothing rotates, and a drop changes at most one side. So the
 * board stores and sends the first block's `y`, the one height `h`, and for each block four
 * numbers in `d`: x, z, width and depth, each as the change from the block below (from 0 for the
 * first). Most of those are 0, which is about a seventh of the size before compression.
 */
export interface PackedBlocks {
  y: number;
  h: number;
  d: number[];
}

/**
 * A tower as the board stores and sends it: `packed` in place of `towerBlocks` when the blocks
 * pack exactly, `towerBlocks` as they are when they do not. `unpackTower` gives back the entry.
 */
export type BoardTower = Omit<TowerMapEntry, 'towerBlocks'> & {
  towerBlocks?: TowerBlock[];
  packed?: PackedBlocks;
};

export const unpackBlocks = (p: PackedBlocks): TowerBlock[] => {
  const out: TowerBlock[] = [];
  let x = 0;
  let z = 0;
  let width = 0;
  let depth = 0;
  let y = p.y;
  for (let i = 0; i + 3 < p.d.length; i += 4) {
    x += p.d[i]!;
    z += p.d[i + 1]!;
    width += p.d[i + 2]!;
    depth += p.d[i + 3]!;
    out.push({ x, y, z, width, depth, height: p.h, rotation: 0 });
    y += p.h;
  }
  return out;
};

const same = (a: TowerBlock, b: TowerBlock): boolean =>
  a.x === b.x &&
  a.y === b.y &&
  a.z === b.z &&
  a.width === b.width &&
  a.depth === b.depth &&
  a.height === b.height &&
  a.rotation === b.rotation;

/**
 * The blocks packed, or null when packing would change them: a block that rotates, differs in
 * height, floats off the one below, or has no z or depth. The packing is checked by unpacking it,
 * so whatever is returned comes back exactly.
 */
export const packBlocks = (blocks: readonly TowerBlock[]): PackedBlocks | null => {
  const first = blocks[0];
  const packed: PackedBlocks = { y: first?.y ?? 0, h: first?.height ?? 0, d: [] };
  let x = 0;
  let z = 0;
  let width = 0;
  let depth = 0;
  for (const b of blocks) {
    if (b.z === undefined || b.depth === undefined) return null;
    packed.d.push(b.x - x, b.z - z, b.width - width, b.depth - depth);
    x = b.x;
    z = b.z;
    width = b.width;
    depth = b.depth;
  }
  const back = unpackBlocks(packed);
  if (back.length !== blocks.length) return null;
  for (let i = 0; i < back.length; i++) if (!same(back[i]!, blocks[i]!)) return null;
  return packed;
};

/** The entry as the board stores it, with its blocks packed when they pack exactly. */
export const packTower = (entry: TowerMapEntry): BoardTower => {
  const packed = packBlocks(entry.towerBlocks);
  if (!packed) return entry;
  const { towerBlocks: _blocks, ...rest } = entry;
  return { ...rest, packed };
};

/** The entry back as the board draws it. Takes either form, so older stored pages still read. */
export const unpackTower = (tower: BoardTower): TowerMapEntry => {
  const { packed, towerBlocks, ...rest } = tower;
  return {
    ...rest,
    towerBlocks: packed ? unpackBlocks(packed) : Array.isArray(towerBlocks) ? towerBlocks : [],
  };
};
