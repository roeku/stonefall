import { DEFAULT_TOWER_GRID_OFFSET, DEFAULT_TOWER_GRID_SIZE } from './towerPlacement';

/**
 * The one coordinate space everybody builds in.
 *
 * There is a single grid. Each player owns a square region of it, and a placement is a cell in
 * that shared space rather than in a private one. That is what lets a coordinate quoted in a
 * comment mean the same thing to everyone, and what lets one screen show both "my grid" and
 * "the community" -- they differ only by where the camera is pointing.
 *
 * Regions are packed outward from the origin in a square spiral, so the built area stays dense
 * as players join instead of scattering across empty space.
 */

/** Cells from a region's centre to its edge. A region is (2r + 1)^2 buildable cells. */
export const REGION_RADIUS = 3;

/** Buildable width of a region, in cells. */
export const REGION_SPAN = REGION_RADIUS * 2 + 1;

/**
 * Empty cells between neighbouring regions.
 *
 * Without a gutter, adjacent players' structures butt straight up against each other and it
 * becomes impossible to see where one person's build ends and the next begins.
 */
export const REGION_GUTTER = 1;

/** Distance between region centres, in cells. */
export const REGION_PITCH = REGION_SPAN + REGION_GUTTER;

export interface RegionCoord {
  rx: number;
  rz: number;
}

export interface GlobalCell {
  x: number;
  z: number;
}

/**
 * Region index to region coordinate, as a square spiral out from the origin.
 *
 * Index 0 is the centre, then rings outward. Deterministic and total: every non-negative index
 * maps to exactly one region and vice versa, so a player's region can be stored as a single
 * integer and the layout can be recomputed anywhere without a lookup table.
 */
export const regionCoordForIndex = (index: number): RegionCoord => {
  if (!Number.isInteger(index) || index < 0) {
    return { rx: 0, rz: 0 };
  }
  if (index === 0) {
    return { rx: 0, rz: 0 };
  }

  // Which ring the index falls in. Ring k holds the cells between (2k-1)^2 and (2k+1)^2.
  const ring = Math.ceil((Math.sqrt(index + 1) - 1) / 2);
  const ringStart = (2 * ring - 1) * (2 * ring - 1); // first index of this ring
  const sideLength = 2 * ring; // steps along each of the four sides
  const offset = index - ringStart;
  const side = Math.floor(offset / sideLength);
  const step = offset % sideLength;

  switch (side) {
    case 0: // right edge, walking down (+z)
      return { rx: ring, rz: -ring + step + 1 };
    case 1: // bottom edge, walking left (-x)
      return { rx: ring - step - 1, rz: ring };
    case 2: // left edge, walking up (-z)
      return { rx: -ring, rz: ring - step - 1 };
    default: // top edge, walking right (+x)
      return { rx: -ring + step + 1, rz: -ring };
  }
};

/** Centre cell of a region, in global grid coordinates. */
export const regionCenterCell = (region: RegionCoord): GlobalCell => ({
  x: region.rx * REGION_PITCH,
  z: region.rz * REGION_PITCH,
});

/** A cell inside a region (local, centred on 0) to its global coordinate. */
export const toGlobalCell = (region: RegionCoord, localX: number, localZ: number): GlobalCell => {
  const center = regionCenterCell(region);
  return { x: center.x + localX, z: center.z + localZ };
};

/** Global coordinate back to the region containing it, plus the local offset within it. */
export const fromGlobalCell = (
  x: number,
  z: number
): { region: RegionCoord; localX: number; localZ: number } => {
  // Round rather than floor, so the gutter either side of a region resolves to the nearer
  // region instead of always biasing one direction.
  //
  // `+ 0` normalises -0, which Math.round yields for any cell just left of the origin (e.g.
  // -3/8). It compares equal to 0, so this is invisible until a region is used as part of a
  // key or serialised, at which point the same region has two spellings.
  const rx = Math.round(x / REGION_PITCH) + 0;
  const rz = Math.round(z / REGION_PITCH) + 0;
  const center = regionCenterCell({ rx, rz });
  return { region: { rx, rz }, localX: x - center.x, localZ: z - center.z };
};

/** True when a global cell is inside the given region's buildable area (excludes the gutter). */
export const isCellInRegion = (region: RegionCoord, x: number, z: number): boolean => {
  const center = regionCenterCell(region);
  return (
    Math.abs(x - center.x) <= REGION_RADIUS && Math.abs(z - center.z) <= REGION_RADIUS
  );
};

/** Global cell to world position. Towers sit at cell centres. */
export const cellToWorld = (cell: number): number =>
  DEFAULT_TOWER_GRID_OFFSET + cell * DEFAULT_TOWER_GRID_SIZE + DEFAULT_TOWER_GRID_SIZE / 2;

/**
 * World position back to a global cell.
 *
 * `+ 0` normalises -0, which Math.round produces just left of the origin. It compares equal to
 * 0, but would otherwise leak into cell keys and request payloads as a second spelling of the
 * same cell.
 */
export const worldToCell = (world: number): number =>
  Math.round(
    (world - DEFAULT_TOWER_GRID_OFFSET - DEFAULT_TOWER_GRID_SIZE / 2) / DEFAULT_TOWER_GRID_SIZE
  ) + 0;

/**
 * Radius in cells needed to show `regionCount` regions.
 *
 * Used to size the drawn grid so it covers the built area without stretching to the horizon.
 */
export const gridRadiusForRegions = (regionCount: number): number => {
  const safeCount = Math.max(1, Math.floor(regionCount));
  const ring = Math.ceil((Math.sqrt(safeCount) - 1) / 2);
  return (ring + 1) * REGION_PITCH;
};

/**
 * True when a global cell falls inside the given region.
 *
 * The region-relative variant already exists; this takes the region's centre cell instead, which
 * is what callers holding a `PlayerRegion` actually have. Without it every caller repeats the
 * same subtraction, and the two views that need it -- filtering towers to "mine", and rejecting
 * a placement tap -- would each own a copy of the same arithmetic.
 */
export const isGlobalCellInRegion = (
  centerX: number,
  centerZ: number,
  cellX: number,
  cellZ: number
): boolean =>
  Math.abs(cellX - centerX) <= REGION_RADIUS && Math.abs(cellZ - centerZ) <= REGION_RADIUS;
