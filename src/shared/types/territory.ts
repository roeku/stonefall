import type { StoneId } from '../social/stones';
import { factionName, type FactionId } from './factions';
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
 * - The centre cell of a region somebody has been handed is its owner's KEEP: a player's, or on a
 *   `factions` map a colour's (see RULES below). Nobody else can build there, ever. It is where a
 *   run is built, so there is always safe ground and always somewhere to come home to. It used to
 *   be the centre 3x3; each map keeps the size it opened with (see `KEEP_RADIUS`), so a day in
 *   play never changes shape.
 * - Every other cell is LAND, the centres of regions nobody keeps included. Land is claimed by
 *   raising a tower on it, held by whoever's tower stands there, and taken by raising a tower
 *   with a higher score: the old tower topples and the winner stands in its place. One tower per
 *   land cell. There used to be a road between regions and a reserved centre in every region
 *   nobody kept, and nothing could stand on either; with a keep per colour rather than per player
 *   they only broke up the ground colours spread over.
 * - REACH is how far from held ground a player can build: any land cell within two cells of
 *   anything their colour holds, keeps included. From a one-cell keep that is the 5x5 round it,
 *   and the rest is earned by holding land nearer to it. Reach is by colour, not by player, which
 *   is what lets a faction spread as one bloc.
 *
 * Whose keep it is depends on the map's RULES. On a `plots` map, the first kind, every player is
 * handed a plot and a keep of their own, and an ally's land is taken like anybody else's. On a
 * `factions` map only the first player of a colour is handed a plot: its keep is the colour's,
 * safe for every member and stacked by all of them. Everyone after builds out from the colour's
 * ground, and a tower raised on land the colour already holds stacks there instead of toppling
 * it. A rival has to beat the best tower in the stack, and the whole stack comes down. So a colour
 * gathers round one keep and grows outward from it, into open ground or into another colour's.
 *
 * Everything here is pure and shared. The server judges with it, the local harness judges with
 * it, and the client draws and pre-checks with it, so what the map shows as takeable is what the
 * server will accept.
 */

/**
 * Cells from a keep's centre to its edge, on a map opened now: 0 is a keep of one cell.
 *
 * The keep's size is part of a map, not of the code: a map stores the radius it opened with and
 * every rule below is told which it is judging. A map that stored none opened before the keep
 * shrank, and has the old 3x3 (`LEGACY_KEEP_RADIUS`), so the towers already standing in its
 * ring stay on keep ground rather than turning into land nobody holds.
 */
export const KEEP_RADIUS = 0;

/** The keep radius of a map opened before the keep became one cell. */
export const LEGACY_KEEP_RADIUS = 1;

/** A stored keep radius, or the legacy one when there is none. */
export const keepRadiusOr = (stored: unknown): number => {
  // Blank is absent, not zero: Number('') is 0, which would read as a one-cell keep.
  const n = typeof stored === 'string' && stored.trim() !== '' ? Number(stored) : stored;
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < REGION_RADIUS
    ? n
    : LEGACY_KEEP_RADIUS;
};

/**
 * How a map shares its ground: `plots`, a plot and keep per player, or `factions`, a plot and
 * keep per colour with allies stacking on each other's land. Like the keep size it is the map's,
 * stored when it opens, so a day in play never changes rules under the people playing it.
 */
export type MapRules = 'plots' | 'factions';

/** The rules a map opened now plays by. */
export const RULES: MapRules = 'factions';

/** The rules of a map opened before colours shared a keep. */
export const LEGACY_RULES: MapRules = 'plots';

/** Stored rules, or the legacy ones when there are none. */
export const rulesOr = (stored: unknown): MapRules =>
  stored === 'plots' || stored === 'factions' ? stored : LEGACY_RULES;

/** How far from held ground a tower may be raised, in cells (Chebyshev). */
export const REACH = 2;

export type CellKind = 'keep' | 'land';

export const sameRegion = (a: RegionCoord, b: RegionCoord): boolean =>
  a.rx === b.rx && a.rz === b.rz;

/**
 * Whether a cell is keep or land: keep when it is within `keepRadius` of the centre of a region
 * in `keeps`, the regions somebody has been handed, and land everywhere else.
 */
export const cellKind = (
  x: number,
  z: number,
  keeps: readonly RegionCoord[],
  keepRadius: number
): CellKind => {
  const { region, localX, localZ } = fromGlobalCell(x, z);
  if (Math.max(Math.abs(localX), Math.abs(localZ)) > keepRadius) return 'land';
  return keeps.some((k) => sameRegion(k, region)) ? 'keep' : 'land';
};

/**
 * The regions with a keep, as a player sees them: every keep in `holdings`, and their own, which
 * is theirs from the moment it is handed out, before anything stands on it.
 */
export const keptRegions = (holdings: Holdings, own: RegionCoord | null): readonly RegionCoord[] =>
  own ? [own, ...holdings.keeps] : holdings.keeps;

/** The region a cell belongs to. */
export const regionOfCell = (x: number, z: number): RegionCoord => fromGlobalCell(x, z).region;

/** The cells of a region's keep: one, or nine on a legacy map. */
export const keepCellsOf = (region: RegionCoord, keepRadius: number): GlobalCell[] => {
  const c = regionCenterCell(region);
  const out: GlobalCell[] = [];
  for (let dx = -keepRadius; dx <= keepRadius; dx++) {
    for (let dz = -keepRadius; dz <= keepRadius; dz++) {
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

/**
 * A player's keep on the map: whose it is and what colour it flies. On a `factions` map every
 * member of a colour builds from the colour's keep, so several records name the same region.
 */
export interface KeepRecord {
  userId: string;
  username: string;
  faction: FactionId;
  rx: number;
  rz: number;
  centerX: number;
  centerZ: number;
  /**
   * The stone the owner's towers are made of on this map, as of their last change that day
   * (shared/social/stones.ts). Absent is the default.
   */
  stone?: StoneId;
}

/**
 * A land cell somebody holds: the tower that holds it and what it takes to beat it.
 *
 * When allies have stacked there, the tower named is the best in the stack, since its score is
 * the bar, and `stack` says how many stand there in all.
 */
export interface LandHold {
  x: number;
  z: number;
  userId: string;
  username: string;
  faction: FactionId | null;
  score: number;
  sessionId: string;
  placedAt: number;
  /** Towers standing on the cell, this one among them. Absent is one. */
  stack?: number;
}

/** One tower in a cell's stack. */
export type StackedTower = Omit<LandHold, 'x' | 'z' | 'stack'>;

/**
 * A cell's stack as one hold: the best tower in it, the earliest on a tie, and how many stand.
 * `towers` runs bottom to top and must not be empty.
 */
export const holdOfStack = (x: number, z: number, towers: readonly StackedTower[]): LandHold => {
  const best = towers.reduce((a, t) => (t.score > a.score ? t : a));
  return { x, z, ...best, ...(towers.length > 1 ? { stack: towers.length } : {}) };
};

/** How many towers stand on a held cell. */
export const stackOf = (hold: LandHold): number => hold.stack ?? 1;

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
  holdings: Holdings,
  keepRadius: number
): Set<string> => {
  const held = new Set<string>();
  if (ownRegion) for (const c of keepCellsOf(ownRegion, keepRadius)) held.add(cellKey(c.x, c.z));
  for (const k of holdings.keeps) {
    if (k.faction !== faction) continue;
    for (const c of keepCellsOf({ rx: k.rx, rz: k.rz }, keepRadius)) held.add(cellKey(c.x, c.z));
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
  /** Onto the player's own keep, or their colour's, stacking on whatever stands in the cell. */
  | { ok: true; kind: 'keep'; stackOn: number }
  /** Onto empty land within reach. */
  | { ok: true; kind: 'claim' }
  /** Onto land the player's colour holds, on a `factions` map: on top of the towers there. */
  | { ok: true; kind: 'stack'; stackOn: number; on: LandHold }
  /** Onto held land, beating the tower there, or the best in its stack. */
  | { ok: true; kind: 'take'; from: LandHold }
  | {
      ok: false;
      code: 'foreign-keep' | 'out-of-reach' | 'bar' | 'stack-full' | 'cap';
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
  /**
   * Towers already standing in the keep cells the player builds on, by cell key: their own on a
   * `plots` map, everybody's in the colour's keep on a `factions` map.
   */
  keepStacks: ReadonlyMap<string, number>;
  maxStack: number;
  /** Towers the player has standing anywhere, against their cap. */
  standing: number;
  maxStanding: number;
  /** The keep radius of the map being built on. */
  keepRadius: number;
  /** The rules of the map being built on. */
  rules: MapRules;
}

/**
 * Whether a tower may be raised at a cell, and what raising it would do.
 *
 * The one place the rules are spelled out. The reasons are written for the player, because the
 * server sends them straight back and the client shows them under the ghost.
 */
export const judgePlacement = (q: PlacementQuery): PlacementVerdict => {
  const kind = cellKind(q.x, q.z, keptRegions(q.holdings, q.region), q.keepRadius);

  if (q.standing >= q.maxStanding) {
    return {
      ok: false,
      code: 'cap',
      reason: `You have ${q.maxStanding} towers standing. Topple one of your own first.`,
    };
  }

  const region = regionOfCell(q.x, q.z);
  const factions = q.rules === 'factions';

  if (kind === 'keep') {
    const owner = q.holdings.keeps.find((k) => k.rx === region.rx && k.rz === region.rz);
    const mine =
      (q.region !== null && sameRegion(region, q.region)) ||
      (factions && owner?.faction === q.faction);
    if (mine) {
      const stack = q.keepStacks.get(cellKey(q.x, q.z)) ?? 0;
      if (stack >= q.maxStack) {
        return { ok: false, code: 'stack-full', reason: `That cell is full (${q.maxStack}).` };
      }
      return { ok: true, kind: 'keep', stackOn: stack };
    }
    // Somebody else's. A cell is keep only where a keep has been handed out, so unless the region
    // is the player's own, `owner` is the keep that made it one.
    const whose = owner && (factions ? factionName(owner.faction) : `u/${owner.username}`);
    return {
      ok: false,
      code: 'foreign-keep',
      reason: whose ? `That is ${whose}'s keep.` : 'That is a keep.',
    };
  }

  const held = cellsHeldBy(q.faction, q.region, q.holdings, q.keepRadius);
  if (!withinReach(q.x, q.z, held)) {
    return {
      ok: false,
      code: 'out-of-reach',
      reason: `Out of reach. Hold something within ${REACH} cells of it.`,
    };
  }

  const hold = q.holdings.land.find((h) => h.x === q.x && h.z === q.z);
  if (!hold) return { ok: true, kind: 'claim' };
  // Your colour's ground is never toppled from inside: a tower raised there goes on top.
  if (factions && hold.faction === q.faction) {
    const stack = stackOf(hold);
    if (stack >= q.maxStack) {
      return { ok: false, code: 'stack-full', reason: `That cell is full (${q.maxStack}).` };
    }
    return { ok: true, kind: 'stack', stackOn: stack, on: hold };
  }
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

/**
 * Land holds, derived from the towers standing on land cells: one per cell, named for the best
 * tower in its stack (`holdOfStack`). A cell holds one tower unless allies stacked there.
 */
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
  }>,
  keeps: readonly RegionCoord[],
  keepRadius: number
): LandHold[] => {
  const byCell = new Map<string, StackedTower[]>();
  for (const t of towers) {
    if (t.gridX === undefined || t.gridZ === undefined) continue;
    if (cellKind(t.gridX, t.gridZ, keeps, keepRadius) !== 'land') continue;
    const tower: StackedTower = {
      userId: t.userId,
      username: t.username,
      faction: t.faction ?? null,
      score: t.score,
      sessionId: t.sessionId,
      placedAt: t.timestamp,
    };
    const key = cellKey(t.gridX, t.gridZ);
    const stack = byCell.get(key);
    if (stack) stack.push(tower);
    else byCell.set(key, [tower]);
  }
  return [...byCell].map(([key, stack]) => {
    const cell = parseCellKey(key)!;
    return holdOfStack(cell.x, cell.z, stack);
  });
};

/**
 * Cells held per faction, for the standings line. Keeps count their cells: one, or nine. A keep
 * is counted once however many players build from it.
 */
export const landCountByFaction = (
  holdings: Holdings,
  keepRadius: number
): Map<FactionId, number> => {
  const counts = new Map<FactionId, number>();
  const add = (f: FactionId | null, n: number) => {
    if (!f) return;
    counts.set(f, (counts.get(f) ?? 0) + n);
  };
  const keepCells = (2 * keepRadius + 1) ** 2;
  const counted = new Set<string>();
  for (const k of holdings.keeps) {
    const region = `${k.rx},${k.rz}`;
    if (counted.has(region)) continue;
    counted.add(region);
    add(k.faction, keepCells);
  }
  for (const h of holdings.land) add(h.faction, 1);
  return counts;
};
