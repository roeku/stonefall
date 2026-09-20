import type { FactionId } from '../../../shared/types/factions';
import { factionHex } from '../../../shared/types/factions';
import {
  cellKey,
  cellsHeldBy,
  keepCellsOf,
  withinReach,
  cellKind,
  type Holdings,
} from '../../../shared/types/territory';
import { cellToWorld, type RegionCoord } from '../../../shared/types/worldGrid';
import { hexToRgb, type Rgb } from './boardInstancing';

/**
 * Which cells get a tile, and in what colour. Pure, so it can be tested in node.
 *
 * Three layers, drawn separately because they are drawn differently:
 *
 * - keeps: nine cells each, in the owner's current colour;
 * - land: one cell per hold, in the colour of the tower standing there;
 * - reach: every land cell the viewer could raise a tower on right now, in their own colour,
 *   faint, so the edge of what is possible is visible before a cell is tapped.
 */
export interface Tile {
  x: number;
  z: number;
  worldX: number;
  worldZ: number;
  rgb: Rgb;
}

export interface TilePlan {
  keeps: Tile[];
  land: Tile[];
  reach: Tile[];
}

const tile = (x: number, z: number, faction: FactionId | null): Tile => ({
  x,
  z,
  worldX: cellToWorld(x),
  worldZ: cellToWorld(z),
  rgb: hexToRgb(factionHex(faction)),
});

/** How far out from held ground reach tiles are searched. Reach itself decides membership. */
const REACH_SEARCH = 3;

export const planTiles = (
  holdings: Holdings,
  viewer: { faction: FactionId; region: RegionCoord | null } | null
): TilePlan => {
  const keeps: Tile[] = [];
  const land: Tile[] = [];
  const reach: Tile[] = [];

  for (const k of holdings.keeps) {
    for (const c of keepCellsOf({ rx: k.rx, rz: k.rz })) keeps.push(tile(c.x, c.z, k.faction));
  }
  for (const h of holdings.land) land.push(tile(h.x, h.z, h.faction));

  if (viewer) {
    const held = cellsHeldBy(viewer.faction, viewer.region, holdings);
    // Candidate cells: a window round every held cell. Reach decides, so the window only has
    // to be at least as wide as the reach.
    const seen = new Set<string>();
    for (const key of held) {
      const [xs, zs] = key.split(',');
      const hx = Number(xs);
      const hz = Number(zs);
      for (let dx = -REACH_SEARCH; dx <= REACH_SEARCH; dx++) {
        for (let dz = -REACH_SEARCH; dz <= REACH_SEARCH; dz++) {
          const x = hx + dx;
          const z = hz + dz;
          const k = cellKey(x, z);
          if (seen.has(k) || held.has(k)) continue;
          seen.add(k);
          if (cellKind(x, z) !== 'land') continue;
          if (!withinReach(x, z, held)) continue;
          reach.push(tile(x, z, viewer.faction));
        }
      }
    }
  }

  return { keeps, land, reach };
};
