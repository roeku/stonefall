import { describe, expect, it } from 'vitest';
import {
  cellToWorld,
  fromGlobalCell,
  isCellInRegion,
  REGION_PITCH,
  REGION_RADIUS,
  regionCenterCell,
  regionCoordForIndex,
  toGlobalCell,
  worldToCell,
} from './worldGrid';

/**
 * Every player builds in one shared coordinate space, so this arithmetic decides where towers
 * actually appear and whether a coordinate quoted in a comment resolves to the right place.
 *
 * The failure mode is silent: an off-by-one puts a tower in a neighbour's region, or two
 * players get handed the same patch and their builds interleave. Neither throws.
 */
describe('region packing', () => {
  it('puts the first region at the origin', () => {
    expect(regionCoordForIndex(0)).toEqual({ rx: 0, rz: 0 });
  });

  it('never hands two players the same region', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const { rx, rz } = regionCoordForIndex(i);
      const key = `${rx},${rz}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    expect(seen.size).toBe(500);
  });

  it('packs outward densely rather than scattering', () => {
    // Every region in ring k must be reached before any region in ring k+1, or the built area
    // develops holes as players join.
    let maxRingSoFar = 0;
    for (let i = 0; i < 200; i++) {
      const { rx, rz } = regionCoordForIndex(i);
      const ring = Math.max(Math.abs(rx), Math.abs(rz));
      expect(ring).toBeGreaterThanOrEqual(maxRingSoFar - 0);
      maxRingSoFar = Math.max(maxRingSoFar, ring);
    }
    // 200 regions should still be a compact blob, not a long arm.
    const { rx, rz } = regionCoordForIndex(199);
    expect(Math.max(Math.abs(rx), Math.abs(rz))).toBeLessThanOrEqual(8);
  });

  it('fills each ring completely before starting the next', () => {
    // Ring k contains exactly (2k+1)^2 - (2k-1)^2 = 8k regions.
    for (let ring = 1; ring <= 4; ring++) {
      const start = (2 * ring - 1) ** 2;
      const count = 8 * ring;
      const ringCoords = new Set<string>();
      for (let i = start; i < start + count; i++) {
        const { rx, rz } = regionCoordForIndex(i);
        expect(Math.max(Math.abs(rx), Math.abs(rz))).toBe(ring);
        ringCoords.add(`${rx},${rz}`);
      }
      expect(ringCoords.size).toBe(count);
    }
  });

  it('handles nonsense indices without throwing', () => {
    expect(regionCoordForIndex(-1)).toEqual({ rx: 0, rz: 0 });
    expect(regionCoordForIndex(1.5)).toEqual({ rx: 0, rz: 0 });
  });
});

describe('global cell conversion', () => {
  it('round-trips local cells through global for many regions', () => {
    for (let index = 0; index < 60; index++) {
      const region = regionCoordForIndex(index);
      for (let lx = -REGION_RADIUS; lx <= REGION_RADIUS; lx++) {
        for (let lz = -REGION_RADIUS; lz <= REGION_RADIUS; lz++) {
          const global = toGlobalCell(region, lx, lz);
          const back = fromGlobalCell(global.x, global.z);
          expect(back.region).toEqual(region);
          expect(back.localX).toBe(lx);
          expect(back.localZ).toBe(lz);
        }
      }
    }
  });

  it('keeps regions from overlapping in global space', () => {
    // Two adjacent regions must not claim the same global cell, or neighbours would overwrite
    // each other's placements.
    const claimed = new Map<string, string>();
    for (let index = 0; index < 40; index++) {
      const region = regionCoordForIndex(index);
      for (let lx = -REGION_RADIUS; lx <= REGION_RADIUS; lx++) {
        for (let lz = -REGION_RADIUS; lz <= REGION_RADIUS; lz++) {
          const g = toGlobalCell(region, lx, lz);
          const key = `${g.x},${g.z}`;
          expect(claimed.has(key)).toBe(false);
          claimed.set(key, `${region.rx},${region.rz}`);
        }
      }
    }
  });

  it('leaves a gutter between neighbouring regions', () => {
    const a = regionCenterCell({ rx: 0, rz: 0 });
    const b = regionCenterCell({ rx: 1, rz: 0 });
    const gap = b.x - a.x - (REGION_RADIUS * 2 + 1);
    expect(gap).toBeGreaterThan(0);
    expect(b.x - a.x).toBe(REGION_PITCH);
  });

  it('rejects cells outside a region, including the gutter', () => {
    const region = { rx: 0, rz: 0 };
    expect(isCellInRegion(region, 0, 0)).toBe(true);
    expect(isCellInRegion(region, REGION_RADIUS, REGION_RADIUS)).toBe(true);
    // One past the edge is gutter, which belongs to nobody.
    expect(isCellInRegion(region, REGION_RADIUS + 1, 0)).toBe(false);
    // A cell squarely in the neighbouring region.
    expect(isCellInRegion(region, REGION_PITCH, 0)).toBe(false);
  });

  it('does not let one player claim a cell in another region', () => {
    const mine = regionCoordForIndex(0);
    const theirs = regionCoordForIndex(1);
    const theirCell = toGlobalCell(theirs, 0, 0);
    expect(isCellInRegion(mine, theirCell.x, theirCell.z)).toBe(false);
  });
});

describe('world conversion', () => {
  it('round-trips cells through world space, including negatives', () => {
    for (let cell = -40; cell <= 40; cell++) {
      expect(worldToCell(cellToWorld(cell))).toBe(cell);
    }
  });

  it('normalises negative zero', () => {
    // -0 compares equal to 0 but stringifies into cell keys and payloads as a second spelling.
    expect(Object.is(worldToCell(cellToWorld(0) - 0.01), -0)).toBe(false);
  });
});

/**
 * Cell names are quoted in comments, so they have to be unique inside a plot, stable however
 * the map grows, and the same on every surface that prints them.
 */
describe('cell names', () => {
  it('inverts the spiral for every index', async () => {
    const { regionIndexForCoord } = await import('./worldGrid');
    for (let i = 0; i < 700; i++) {
      expect(regionIndexForCoord(regionCoordForIndex(i))).toBe(i);
    }
  });

  it('names the keep centre D4 and the corners A1 and G7', async () => {
    const { cellName, plotNumber, cellLabel } = await import('./worldGrid');
    const c = regionCenterCell(regionCoordForIndex(11));
    expect(cellName(c.x, c.z)).toBe('D4');
    expect(cellName(c.x - REGION_RADIUS, c.z - REGION_RADIUS)).toBe('A1');
    expect(cellName(c.x + REGION_RADIUS, c.z + REGION_RADIUS)).toBe('G7');
    expect(plotNumber(c.x, c.z)).toBe(12);
    expect(cellLabel(c.x + 1, c.z - 3)).toBe('E1 on plot 12');
  });

  it('gives every buildable cell of a plot a distinct name and the gutter none', async () => {
    const { cellName } = await import('./worldGrid');
    const c = regionCenterCell({ rx: -2, rz: 1 });
    const seen = new Set<string>();
    for (let dx = -REGION_RADIUS; dx <= REGION_RADIUS; dx++) {
      for (let dz = -REGION_RADIUS; dz <= REGION_RADIUS; dz++) {
        seen.add(cellName(c.x + dx, c.z + dz));
      }
    }
    expect(seen.size).toBe((REGION_RADIUS * 2 + 1) ** 2);
    expect(cellName(c.x + REGION_RADIUS + 1, c.z)).toBe('the road');
  });
});
