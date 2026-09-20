import type { FactionId } from './factions';
import {
  REGION_RADIUS,
  fromGlobalCell,
  regionCenterCell,
  type GlobalCell,
  type RegionCoord,
} from './worldGrid';

/**
 * Territory: who holds which cell, and where a player may raise a tower.
 *
 * The board used to be private plots side by side: every cell of a region belonged to the
 * player it was allocated to, and placing a tower anywhere on it changed nothing for anyone.
 * The map was a gallery. These rules turn it into ground that can be won and lost:
 *
 * - The centre 3x3 of a region is its owner's KEEP. Nobody else can build there, ever. It is
 *   where a newcomer's first towers stand and where a run is built, so there is always safe
 *   ground and always somewhere to come home to.
 * - The forty cells round the keep are LAND. Land is claimed by raising a tower on it, held by
 *   whoever's tower stands there, and taken by raising a tower with a higher score: the old
 *   tower topples and the winner stands in its place. One tower per land cell.
 * - The gutter between regions is ROAD. Nothing is built on it, so plots stay legible as blocks.
 * - REACH is how far from held ground a player can build: any land cell within two cells of
 *   anything their colour holds, keeps included. Two, because from a keep that is exactly the
 *   region the keep sits in, so day one plays like the old private plot; hold your own edge and
 *   the neighbour's edge comes into reach across the road. Reach is by colour, not by player,
 *   which is what lets a faction spread as one bloc.
 *
 * Everything here is pure and shared. The server judges with it, the local harness judges with
 * it, and the client draws and pre-checks with it, so what the map shows as takeable is what the
 * server will accept.
 */

/** Cells from a keep's centre to its edge. 1 is a 3x3 keep. */
export const KEEP_RADIUS = 1;

/** How far from held ground a tower may be raised, in cells (Chebyshev). */
export const REACH = 2;

export type CellKind = 'road' | 'keep' | 'land';

/** Where a cell sits within the grid's structure. Independent of who owns anything. */
export const cellKind = (x: number, z: number): CellKind => {
  const { localX, localZ } = fromGlobalCell(x, z);
  const d = Math.max(Math.abs(localX), Math.abs(localZ));
  if (d > REGION_RADIUS) return 'road';
  return d <= KEEP_RADIUS ? 'keep' : 'land';
};

/** The region a cell belongs to, road cells resolving to the nearer region. */
export const regionOfCell = (x: number, z: number): RegionCoord => fromGlobalCell(x, z).region;

export const sameRegion = (a: RegionCoord, b: RegionCoord): boolean =>
  a.rx === b.rx && a.rz === b.rz;

/** The nine cells of a region's keep. */
export const keepCellsOf = (region: RegionCoord): GlobalCell[] => {
  const c = regionCenterCell(region);
  const out: GlobalCell[] = [];
  for (let dx = -KEEP_RADIUS; dx <= KEEP_RADIUS; dx++) {
    for (let dz = -KEEP_RADIUS; dz <= KEEP_RADIUS; dz++) {
      out.push({ x: c.x + dx, z: c.z + dz });
    }
  }
  return out;
};

export const cellKey = (x: number, z: number): string => `${x},${z}`;

export const parseCellKey = (key: string): GlobalCell | null => {
  const [xs, zs] = key.split(',');
  const x = Number(xs);
  const z = Number(zs);
  return Number.isInteger(x) && Number.isInteger(z) ? { x, z } : null;
};

export const chebyshev = (ax: number, az: number, bx: number, bz: number): number =>
  Math.max(Math.abs(ax - bx), Math.abs(az - bz));

/** A keep on the map: whose it is and what colour it flies. */
export interface KeepRecord {
  userId: string;
  username: string;
  faction: FactionId;
  rx: number;
  rz: number;
  centerX: number;
  centerZ: number;
}

/** A land cell somebody holds: the tower standing there and what it takes to beat it. */
export interface LandHold {
  x: number;
  z: number;
  userId: string;
  username: string;
  faction: FactionId | null;
  score: number;
  sessionId: string;
  placedAt: number;
}

export interface Holdings {
  keeps: readonly KeepRecord[];
  land: readonly LandHold[];
}

/**
 * Every cell a colour holds: its members' keeps plus the land its towers stand on.
 *
 * `ownRegion` is always included whether or not it appears in `keeps`, because a player's own
 * keep is theirs from the moment it is assigned, before anything is drawn on it.
 */
export const cellsHeldBy = (
  faction: FactionId,
  ownRegion: RegionCoord | null,
  holdings: Holdings
): Set<string> => {
  const held = new Set<string>();
  if (ownRegion) for (const c of keepCellsOf(ownRegion)) held.add(cellKey(c.x, c.z));
  for (const k of holdings.keeps) {
    if (k.faction !== faction) continue;
    for (const c of keepCellsOf({ rx: k.rx, rz: k.rz })) held.add(cellKey(c.x, c.z));
  }
  for (const h of holdings.land) {
    if (h.faction === faction) held.add(cellKey(h.x, h.z));
  }
  return held;
};

/** True when a cell is within REACH of any held cell. */
export const withinReach = (x: number, z: number, held: ReadonlySet<string>): boolean => {
  for (let dx = -REACH; dx <= REACH; dx++) {
    for (let dz = -REACH; dz <= REACH; dz++) {
      if (held.has(cellKey(x + dx, z + dz))) return true;
    }
  }
  return false;
};

export type PlacementVerdict =
  /** Onto the player's own keep, stacking on whatever stands in the cell. */
  | { ok: true; kind: 'keep'; stackOn: number }
  /** Onto empty land within reach. */
  | { ok: true; kind: 'claim' }
  /** Onto held land, beating the tower there. */
  | { ok: true; kind: 'take'; from: LandHold }
  | {
      ok: false;
      code: 'road' | 'reserved' | 'foreign-keep' | 'out-of-reach' | 'bar' | 'stack-full' | 'cap';
      reason: string;
      /** Set for `bar`: the score standing there. */
      bar?: number;
      from?: LandHold;
    };

export interface PlacementQuery {
  x: number;
  z: number;
  /** Score of the tower being raised. */
  score: number;
  userId: string;
  faction: FactionId;
  /** The player's own region, if assigned. */
  region: RegionCoord | null;
  holdings: Holdings;
  /** Towers already standing in the player's keep cell, by cell key. */
  keepStacks: ReadonlyMap<string, number>;
  maxStack: number;
  /** Towers the player has standing anywhere, against their cap. */
  standing: number;
  maxStanding: number;
}

/**
 * Whether a tower may be raised at a cell, and what raising it would do.
 *
 * The one place the rules are spelled out. The reasons are written for the player, because the
 * server sends them straight back and the client shows them under the ghost.
 */
export const judgePlacement = (q: PlacementQuery): PlacementVerdict => {
  const kind = cellKind(q.x, q.z);
  if (kind === 'road') return { ok: false, code: 'road', reason: 'That is a road.' };

  if (q.standing >= q.maxStanding) {
    return {
      ok: false,
      code: 'cap',
      reason: `You have ${q.maxStanding} towers standing. Topple one of your own first.`,
    };
  }

  const region = regionOfCell(q.x, q.z);

  if (kind === 'keep') {
    if (q.region && sameRegion(region, q.region)) {
      const stack = q.keepStacks.get(cellKey(q.x, q.z)) ?? 0;
      if (stack >= q.maxStack) {
        return { ok: false, code: 'stack-full', reason: `That cell is full (${q.maxStack}).` };
      }
      return { ok: true, kind: 'keep', stackOn: stack };
    }
    const owner = q.holdings.keeps.find((k) => k.rx === region.rx && k.rz === region.rz);
    return owner
      ? { ok: false, code: 'foreign-keep', reason: `That is u/${owner.username}'s keep.` }
      : { ok: false, code: 'reserved', reason: 'Kept for a newcomer.' };
  }

  const held = cellsHeldBy(q.faction, q.region, q.holdings);
  if (!withinReach(q.x, q.z, held)) {
    return {
      ok: false,
      code: 'out-of-reach',
      reason: `Out of reach. Hold something within ${REACH} cells of it.`,
    };
  }

  const hold = q.holdings.land.find((h) => h.x === q.x && h.z === q.z);
  if (!hold) return { ok: true, kind: 'claim' };
  if (q.score <= hold.score) {
    return {
      ok: false,
      code: 'bar',
      reason: `Beat ${hold.score.toLocaleString()} to take it.`,
      bar: hold.score,
      from: hold,
    };
  }
  return { ok: true, kind: 'take', from: hold };
};

/** Land holds, derived from the towers standing on land cells. One tower per land cell. */
export const landHoldsFrom = (
  towers: ReadonlyArray<{
    sessionId: string;
    userId: string;
    username: string;
    score: number;
    faction?: FactionId | null | undefined;
    gridX?: number | undefined;
    gridZ?: number | undefined;
    timestamp: number;
  }>
): LandHold[] => {
  const out: LandHold[] = [];
  for (const t of towers) {
    if (t.gridX === undefined || t.gridZ === undefined) continue;
    if (cellKind(t.gridX, t.gridZ) !== 'land') continue;
    out.push({
      x: t.gridX,
      z: t.gridZ,
      userId: t.userId,
      username: t.username,
      faction: t.faction ?? null,
      score: t.score,
      sessionId: t.sessionId,
      placedAt: t.timestamp,
    });
  }
  return out;
};

/** Cells held per faction, for the standings line. Keeps count nine cells each. */
export const landCountByFaction = (holdings: Holdings): Map<FactionId, number> => {
  const counts = new Map<FactionId, number>();
  const add = (f: FactionId | null, n: number) => {
    if (!f) return;
    counts.set(f, (counts.get(f) ?? 0) + n);
  };
  for (const k of holdings.keeps) add(k.faction, keepCellsOf({ rx: 0, rz: 0 }).length);
  for (const h of holdings.land) add(h.faction, 1);
  return counts;
};
