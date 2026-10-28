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

/**
 * Cells from a region's centre to its west and north edges.
 *
 * Regions tile the grid edge to edge, eight cells square. Eight is even, so the centre is not the
 * middle: a region runs three cells west and north of it and four east and south. It used to be
 * seven square with a one-cell road between neighbours, which nothing could be built on; the
 * road's cells are now each region's east column and south row.
 */
export const REGION_RADIUS = 3;

/** The square centred on a region's centre, in cells: what a camera fits a plot to. */
export const REGION_SPAN = REGION_RADIUS * 2 + 1;

/** Width of a region, and the distance between region centres, in cells. */
export const REGION_PITCH = 8;

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
  // A region starts REGION_RADIUS cells west and north of its centre, so the offset puts a
  // region's whole span under one floor: local -3 to +4. The +4 column and row are the old road,
  // which the floor's plot lines already drew inside the region to its west and north.
  //
  // `+ 0` normalises -0, so the same region never has two spellings in a key or a payload.
  const rx = Math.floor((x + REGION_RADIUS) / REGION_PITCH) + 0;
  const rz = Math.floor((z + REGION_RADIUS) / REGION_PITCH) + 0;
  const center = regionCenterCell({ rx, rz });
  return { region: { rx, rz }, localX: x - center.x, localZ: z - center.z };
};

const sameCoord = (a: RegionCoord, b: RegionCoord): boolean => a.rx === b.rx && a.rz === b.rz;

/** True when a global cell is inside the given region. */
export const isCellInRegion = (region: RegionCoord, x: number, z: number): boolean =>
  sameCoord(fromGlobalCell(x, z).region, region);

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
  sameCoord(fromGlobalCell(cellX, cellZ).region, fromGlobalCell(centerX, centerZ).region);

/**
 * Region coordinate back to its spiral index: the inverse of `regionCoordForIndex`.
 *
 * The index is the order plots were handed out in, so it is the one number about a plot that
 * never changes however the map grows. That is what makes it usable as a name.
 */
export const regionIndexForCoord = ({ rx, rz }: RegionCoord): number => {
  const ring = Math.max(Math.abs(rx), Math.abs(rz));
  if (ring === 0) return 0;
  const ringStart = (2 * ring - 1) * (2 * ring - 1);
  const side = 2 * ring;
  if (rx === ring && rz > -ring) return ringStart + (rz + ring - 1);
  if (rz === ring && rx < ring) return ringStart + side + (ring - rx - 1);
  if (rx === -ring && rz < ring) return ringStart + 2 * side + (ring - rz - 1);
  return ringStart + 3 * side + (rx + ring - 1);
};

/**
 * Names a player can say.
 *
 * Global coordinates are unbounded and signed, so a chess-style name over the whole map would
 * either shift as the map grows or need three letters at the origin. Plots are the unit players
 * think in, so a cell is named inside its plot -- columns A to H west to east, rows 1 to 8 north
 * to south, the centre at D4 -- and the plot by its number in arrival order, which is the spiral
 * index and never changes. "E7 on plot 12" means the same thing in a comment, on a card and in
 * the run HUD. Column H and row 8 were the road, so every name from before it opened still holds.
 */
export const plotNumber = (x: number, z: number): number =>
  regionIndexForCoord(fromGlobalCell(x, z).region) + 1;

/** The cell's name inside its plot, "A1" to "H8". */
export const cellName = (x: number, z: number): string => {
  const { localX, localZ } = fromGlobalCell(x, z);
  return `${String.fromCharCode(65 + localX + REGION_RADIUS)}${localZ + REGION_RADIUS + 1}`;
};

/** The full name: "E7 on plot 12". */
export const cellLabel = (x: number, z: number): string =>
  `${cellName(x, z)} on plot ${plotNumber(x, z)}`;
