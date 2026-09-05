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
