/**
 * Excerpt, not a module: the road and the reserved centre, cut out of
 * src/shared/types/territory.ts and src/shared/types/worldGrid.ts on 2026-10-28.
 *
 * Regions were seven cells square with a one-cell ROAD between neighbours, and the centre of
 * every region was a KEEP by geometry alone, whether or not anybody had been handed the region.
 * Nothing could stand on the road, and a centre nobody kept was refused as `reserved` ("Kept for a
 * newcomer" on a `plots` map, "No colour keeps this one" on a `factions` map). Both made sense
 * while every player had a plot of their own. Once colours gathered round one keep each, the road
 * cut the ground they spread over into strips and the unkept centres were holes in it, so both
 * went: regions now tile edge to edge, eight square (the road is each one's column H and row 8),
 * and a cell is keep only within a keep somebody holds. `cellKind` takes the kept regions since.
 *
 * The client refused a tap on the road before judging it (BoardScene `aimAt` and the floor tap),
 * skipped a comment link to a road cell (shared/social/comments.ts) and an opened link landing on
 * one (App.tsx), and named the verdicts "Road" and "Nobody's keep" (board/verdictWords.ts).
 */

// --- shared/types/worldGrid.ts ------------------------------------------------------------

/**
 * Empty cells between neighbouring regions.
 *
 * Without a gutter, adjacent players' structures butt straight up against each other and it
 * becomes impossible to see where one person's build ends and the next begins.
 */
export const REGION_GUTTER = 1;

/** Distance between region centres, in cells. */
export const REGION_PITCH = REGION_SPAN + REGION_GUTTER;

export const fromGlobalCell = (
  x: number,
  z: number
): { region: RegionCoord; localX: number; localZ: number } => {
  // Round rather than floor, so the gutter either side of a region resolves to the nearer
  // region instead of always biasing one direction.
  const rx = Math.round(x / REGION_PITCH) + 0;
  const rz = Math.round(z / REGION_PITCH) + 0;
  const center = regionCenterCell({ rx, rz });
  return { region: { rx, rz }, localX: x - center.x, localZ: z - center.z };
};

/** The cell's name inside its plot, "A1" to "G7". A gutter cell is "the road". */
export const cellName = (x: number, z: number): string => {
  const { localX, localZ } = fromGlobalCell(x, z);
  if (Math.abs(localX) > REGION_RADIUS || Math.abs(localZ) > REGION_RADIUS) return 'the road';
  return `${String.fromCharCode(65 + localX + REGION_RADIUS)}${localZ + REGION_RADIUS + 1}`;
};

// --- shared/types/territory.ts ------------------------------------------------------------

export type CellKind = 'road' | 'keep' | 'land';

/** Where a cell sits within the grid's structure. Independent of who owns anything. */
export const cellKind = (x: number, z: number, keepRadius: number): CellKind => {
  const { localX, localZ } = fromGlobalCell(x, z);
  const d = Math.max(Math.abs(localX), Math.abs(localZ));
  if (d > REGION_RADIUS) return 'road';
  return d <= keepRadius ? 'keep' : 'land';
};

// In judgePlacement, first thing:
//   if (kind === 'road') return { ok: false, code: 'road', reason: 'That is a road.' };
//
// and last in its keep branch, for a centre nobody had been handed:
//   return {
//     ok: false,
//     code: 'reserved',
//     reason: factions ? 'No colour keeps this one. Nobody builds here.' : 'Kept for a newcomer.',
//   };
