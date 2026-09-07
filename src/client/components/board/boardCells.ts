import type { TowerMapEntry } from '../../../shared/types/api';
import { towerBox } from './boardInstancing';

export const cellKey = (x: number, z: number): string => `${x},${z}`;

/** How many towers already sit in each cell, so the UI can say what a tap would stack onto. */
export const countByCell = (towers: readonly TowerMapEntry[]): Map<string, number> => {
  const map = new Map<string, number>();
  for (const t of towers) {
    if (t.gridX === undefined || t.gridZ === undefined) continue;
    const key = cellKey(t.gridX, t.gridZ);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
};

/**
 * Height of the top of everything standing in a cell, in world units.
 *
 * This is where a new tower placed there would stand. The ghost used to sit on the floor
 * regardless, so stacking previewed as one tower drawn through another.
 */
export const stackTopAt = (towers: readonly TowerMapEntry[], x: number, z: number): number => {
  let top = 0;
  for (const t of towers) {
    if (t.gridX !== x || t.gridZ !== z) continue;
    const box = towerBox(t.towerBlocks);
    const base = (t.stackBaseY ?? 0) / 1000;
    const height = box ? box.maxY : 0;
    top = Math.max(top, base + height);
  }
  return top;
};

/** Distinct builders among a set of towers. */
export const countBuilders = (towers: readonly TowerMapEntry[]): number => {
  const ids = new Set<string>();
  for (const t of towers) ids.add(t.userId || t.username);
  return ids.size;
};

/** 1-based rank of a tower by score among a set. Ties share the higher rank. */
export const rankOf = (tower: TowerMapEntry, among: readonly TowerMapEntry[]): number => {
  let ahead = 0;
  for (const t of among) if (t.score > tower.score) ahead += 1;
  return ahead + 1;
};

/**
 * The cell placement should open on: empty ground nearest the plot's centre, or failing that
 * anywhere with room left.
 *
 * The centre first because that is where the run was just built, so the tower appears where the
 * player last saw it. Empty before stacked because opening on an occupied cell makes the first
 * thing the chrome says "tap again to stack", which proposes stacking to somebody who has not
 * asked for it.
 */
export const openingCellFor = (
  region: { centerX: number; centerZ: number; radius: number },
  occupied: ReadonlyMap<string, number>,
  maxStack: number
): { x: number; z: number } => {
  const stackAt = (x: number, z: number): number => occupied.get(`${x},${z}`) ?? 0;
  for (const limit of [1, maxStack]) {
    if (stackAt(region.centerX, region.centerZ) < limit) {
      return { x: region.centerX, z: region.centerZ };
    }
    for (let ring = 1; ring <= region.radius; ring++) {
      for (let dx = -ring; dx <= ring; dx++) {
        for (let dz = -ring; dz <= ring; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
          const x = region.centerX + dx;
          const z = region.centerZ + dz;
          if (stackAt(x, z) < limit) return { x, z };
        }
      }
    }
  }
  // Every cell full. Aim at the centre anyway so the tower is visible and the chrome can say
  // why it cannot go down there.
  return { x: region.centerX, z: region.centerZ };
};
