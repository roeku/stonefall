import { describe, it, expect } from 'vitest';
import { openingCellFor } from './boardCells';

/**
 * Placement used to open with no cell aimed at, which meant the tower the player had just spent
 * a run building was not drawn at all until they tapped. These lock the cell it opens on.
 */
describe('openingCellFor', () => {
  const region = { centerX: 10, centerZ: 10, radius: 3 };
  const occ = (entries: Array<[string, number]>) => new Map(entries);

  it('opens on the centre when it is empty, because that is where the run was built', () => {
    expect(openingCellFor(region, occ([]), 3)).toEqual({ x: 10, z: 10 });
  });

  it('prefers empty ground over stacking on an occupied centre', () => {
    const result = openingCellFor(region, occ([['10,10', 1]]), 3);
    expect(result).not.toEqual({ x: 10, z: 10 });
    expect(Math.max(Math.abs(result.x - 10), Math.abs(result.z - 10))).toBe(1);
  });

  it('falls back to a cell with room once every cell has something on it', () => {
    const all: Array<[string, number]> = [];
    for (let x = 7; x <= 13; x++) for (let z = 7; z <= 13; z++) all.push([`${x},${z}`, 1]);
    // Every cell holds one tower; the centre still has room under a cap of 3.
    expect(openingCellFor(region, occ(all), 3)).toEqual({ x: 10, z: 10 });
  });

  it('still returns the centre when the whole plot is full, so the chrome can explain', () => {
    const all: Array<[string, number]> = [];
    for (let x = 7; x <= 13; x++) for (let z = 7; z <= 13; z++) all.push([`${x},${z}`, 3]);
    expect(openingCellFor(region, occ(all), 3)).toEqual({ x: 10, z: 10 });
  });

  it('stays inside the plot', () => {
    const all: Array<[string, number]> = [];
    for (let x = 7; x <= 13; x++) for (let z = 7; z <= 13; z++) if (!(x === 13 && z === 13)) all.push([`${x},${z}`, 3]);
    const r = openingCellFor(region, occ(all), 3);
    expect(Math.max(Math.abs(r.x - 10), Math.abs(r.z - 10))).toBeLessThanOrEqual(3);
  });
});
