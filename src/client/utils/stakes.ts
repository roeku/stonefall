import type { FactionId } from '../../shared/types/factions';
import {
  cellKind,
  landCountByFaction,
  type Holdings,
  type LandHold,
  type PlacementVerdict,
} from '../../shared/types/territory';
import { REGION_PITCH } from '../../shared/types/worldGrid';

/**
 * What a run is worth on the map, worked out before the player has to ask.
 *
 * A run on its own had nothing to pass unless the player had aimed it from a card first, and a
 * finished tower was offered a spot on the keep, which adds nothing to the colour's ground. These
 * are the answers the chrome now leads with: something real to chase during the run, and the
 * spot that counts for the colour once it is over, with the keep still one tap away as the safe
 * choice. Pure, so the rules can be tested without a board.
 */

export type Judge = (x: number, z: number, score: number) => PlacementVerdict;

export interface Viewer {
  userId: string | null;
  faction: FactionId;
}

export interface Cell {
  x: number;
  z: number;
}

export interface Aim extends Cell {
  kind: 'keep' | 'claim' | 'take';
  /** The hold that topples, for a take. */
  from?: LandHold | undefined;
}

/**
 * How far out from the plot open land is looked for. Reach runs from anything the colour holds,
 * so it can run past the plot; one pitch covers the plot and the edges of its neighbours.
 */
const SEARCH_RADIUS = REGION_PITCH + 3;

const distance = (a: Cell, b: Cell | null): number =>
  b ? Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z)) : 0;

/** Ground a colour gains nothing from taking: the viewer's own, and their allies'. */
const isRival = (hold: LandHold, me: Viewer): boolean =>
  hold.userId !== me.userId && hold.faction !== me.faction;

/** How many rival bars one run is shown, lowest first. More is a list nobody reads mid-run. */
export const LADDER_SIZE = 5;

/**
 * The rival holds a run should chase when the player has not picked one, lowest bar first: the
 * nearest thing a run can pass is the one worth putting in front of it, and passing it puts the
 * next one up in front instead. Ties go to the hold nearest the plot. Empty when nothing in reach
 * belongs to another colour.
 */
export const chaseLadder = (
  holdings: Holdings,
  judge: Judge,
  me: Viewer,
  home: Cell | null,
  /** A cell to leave out: one just raised on, before the board has been re-read. */
  skip?: Cell | null,
  size = LADDER_SIZE
): LandHold[] =>
  holdings.land
    .filter(
      (h) =>
        isRival(h, me) &&
        !(skip && h.x === skip.x && h.z === skip.z) &&
        // One above the bar: the question is whether the cell can be had at all.
        judge(h.x, h.z, h.score + 1).ok
    )
    .sort((a, b) => a.score - b.score || distance(a, home) - distance(b, home))
    .slice(0, size);

/** The first rung of the ladder: the lowest rival bar in reach, or null when there is none. */
export const chaseFor = (
  holdings: Holdings,
  judge: Judge,
  me: Viewer,
  home: Cell | null,
  skip?: Cell | null
): LandHold | null => chaseLadder(holdings, judge, me, home, skip, 1)[0] ?? null;

/**
 * Where a finished tower should be aimed when the placement screen opens.
 *
 * In order: the cell the run was chasing, if the tower can have it; the best rival hold it
 * beats, which is the highest bar under its score; the nearest open land in reach; the keep.
 * Only land counts toward a colour's ground, which is why the keep comes last. The keep cell is
 * returned even when it is full, so the chrome can say why nothing can go down.
 */
export const aimFor = (opts: {
  holdings: Holdings;
  judge: Judge;
  me: Viewer;
  score: number;
  /** The plot's centre, to measure "nearest" from. */
  home: Cell | null;
  /** The keep cell placement would otherwise open on. */
  keep: Cell | null;
  /** The cell the run was chasing, if any. */
  chased?: Cell | null | undefined;
}): Aim | null => {
  const { holdings, judge, me, score, home, keep, chased } = opts;

  if (chased) {
    const v = judge(chased.x, chased.z, score);
    if (v.ok && v.kind !== 'keep') {
      return {
        x: chased.x,
        z: chased.z,
        kind: v.kind,
        from: v.kind === 'take' ? v.from : undefined,
      };
    }
  }

  let take: LandHold | null = null;
  for (const h of holdings.land) {
    if (!isRival(h, me) || h.score >= score) continue;
    const v = judge(h.x, h.z, score);
    if (!v.ok || v.kind !== 'take') continue;
    if (
      !take ||
      h.score > take.score ||
      (h.score === take.score && distance(h, home) < distance(take, home))
    ) {
      take = h;
    }
  }
  if (take) return { x: take.x, z: take.z, kind: 'take', from: take };

  if (home) {
    const held = new Set(holdings.land.map((h) => `${h.x},${h.z}`));
    for (let ring = 1; ring <= SEARCH_RADIUS; ring++) {
      for (let dx = -ring; dx <= ring; dx++) {
        for (let dz = -ring; dz <= ring; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
          const x = home.x + dx;
          const z = home.z + dz;
          if (cellKind(x, z) !== 'land' || held.has(`${x},${z}`)) continue;
          const v = judge(x, z, score);
          if (v.ok && v.kind === 'claim') return { x, z, kind: 'claim' };
        }
      }
    }
  }

  return keep ? { x: keep.x, z: keep.z, kind: 'keep' } : null;
};

export interface Standing {
  /** 1-based place among the colours holding anything. 0 when this colour holds nothing. */
  place: number;
  /** How many colours hold anything. */
  of: number;
  cells: number;
}

/** Where a colour stands on the map: the same count the standings line draws. */
export const standingOf = (holdings: Holdings, faction: FactionId): Standing => {
  const counts = landCountByFaction(holdings);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const i = ranked.findIndex(([f]) => f === faction);
  return {
    place: i < 0 ? 0 : i + 1,
    of: ranked.length,
    cells: counts.get(faction) ?? 0,
  };
};

/** "1st", "2nd", "11th". */
export const ordinal = (n: number): string => {
  const suffix = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${suffix[(v - 20) % 10] ?? suffix[v] ?? suffix[0]}`;
};
