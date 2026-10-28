import type { TowerMapEntry } from '../../../shared/types/api';
import { factionName, type FactionId } from '../../../shared/types/factions';
import {
  cellKind,
  keptRegions,
  regionOfCell,
  stackOf,
  type Holdings,
  type MapRules,
  type PlacementVerdict,
} from '../../../shared/types/territory';
import { cellName } from '../../../shared/types/worldGrid';
import { stoneOf as stoneNamed, type StoneId } from '../../../shared/social/stones';
import type { Target } from '../../hooks/useSocial';
import { shortReason } from './verdictWords';

/**
 * What a tapped tower or cell is, and the one thing to do about it.
 *
 * These used to be two cards at the foot of the board, each a small panel of name, score,
 * block count and buttons. The board now splits them the way the rest of the chrome is split:
 * whose it is and its bar are written on the thing itself, in the scene, and the one action sits
 * at the bottom where the thumb is. Pure, so what a tap offers can be tested without a board.
 */
export interface Brief {
  /** The cell's name, e.g. "F3". Null for a tower the grid does not place. */
  where: string | null;
  /** Whose it is, as the tag says it: "u/name", "Your tower", "Open land", "Your keep". */
  who: string;
  /** Their colour, for the name. Null for nobody's. */
  faction: FactionId | null;
  /** The bar standing there, when there is one. */
  score: number | null;
  /** The one thing to do about it: a run aimed at it. */
  action: { verb: string; sub: string | null; aim: Target } | null;
  /** Why nothing can be done, when nothing can. */
  blocked: string | null;
}

export interface BriefViewer {
  userId: string | null;
  faction: FactionId;
  /** The viewer's plot, as a region. */
  region: { rx: number; rz: number } | null;
}

type Judge = (x: number, z: number, score: number) => PlacementVerdict;

interface BriefOptions {
  viewer: BriefViewer;
  judge: Judge;
  /**
   * False on an older post's day: everything can be looked at and nothing started there. The
   * screen already says whose day it is, and its one action plays today's, so a tapped thing
   * carries no line of its own.
   */
  live: boolean;
  /** The keep size of the map being looked at. */
  keepRadius: number;
  /** Whose keeps the map being looked at has: a player's each, or a colour's. */
  rules: MapRules;
  /** The stone a player builds in on this map, which their towers are drawn in. */
  stoneOf?: ((userId: string) => StoneId | null) | undefined;
}

/** A tapped tower: whose, its score, and take its cell, or failing that beat its score. */
export const towerBrief = (
  tower: TowerMapEntry,
  holdings: Holdings,
  { viewer, judge, live, keepRadius, stoneOf }: BriefOptions
): Brief => {
  const mine = viewer.userId !== null && tower.userId === viewer.userId;
  const cell =
    tower.gridX !== undefined && tower.gridZ !== undefined
      ? { x: tower.gridX, z: tower.gridZ }
      : null;
  const onLand =
    cell !== null &&
    cellKind(cell.x, cell.z, keptRegions(holdings, viewer.region), keepRadius) === 'land';
  const where = cell ? cellName(cell.x, cell.z) : null;
  // A stone other than the default is named under the cell: it is what this tower is made of,
  // and naming it is how a player who sees one learns there is something to earn.
  const stone = stoneOf?.(tower.userId) ?? null;
  const brief: Brief = {
    where:
      stone && stone !== 'neon'
        ? [where, stoneNamed(stone).name].filter(Boolean).join(' · ')
        : where,
    who: mine ? 'Your tower' : `u/${tower.username}`,
    faction: tower.faction ?? null,
    score: tower.score,
    action: null,
    blocked: null,
  };
  if (!live) return brief;

  // Judged one above the bar: the question is whether the cell can be had at all. On a factions
  // map the colour's own cells are stacked on, never taken, so only a take is offered here.
  const probe = onLand && cell ? judge(cell.x, cell.z, tower.score + 1) : null;
  const score = tower.score.toLocaleString();
  if (probe?.ok && probe.kind === 'take' && cell) {
    return {
      ...brief,
      action: {
        verb: mine ? 'Replace it' : `Take ${where}`,
        sub: mine ? `Beat your ${score}` : `Beat ${score}`,
        aim: {
          kind: 'take',
          username: tower.username,
          faction: tower.faction ?? undefined,
          score: tower.score,
          cell,
          own: mine,
        },
      },
    };
  }
  const blocked = probe ? shortReason(probe) : null;
  if (mine) return { ...brief, blocked };
  // A tower that cannot be taken is still a score to chase.
  return {
    ...brief,
    action: {
      verb: 'Beat it',
      sub: blocked ?? `Pass ${score}`,
      aim: {
        kind: 'beat',
        username: tower.username,
        faction: tower.faction ?? undefined,
        score: tower.score,
      },
    },
  };
};

/** A tapped cell: a keep and whose, open land to claim, or somebody's hold to take. */
export const cellBrief = (
  cell: { x: number; z: number },
  holdings: Holdings,
  { viewer, judge, live, keepRadius, rules }: BriefOptions
): Brief => {
  const where = cellName(cell.x, cell.z);
  const factions = rules === 'factions';

  if (cellKind(cell.x, cell.z, keptRegions(holdings, viewer.region), keepRadius) === 'keep') {
    const region = regionOfCell(cell.x, cell.z);
    const owner = holdings.keeps.find((k) => k.rx === region.rx && k.rz === region.rz);
    const mine =
      (viewer.region !== null &&
        viewer.region.rx === region.rx &&
        viewer.region.rz === region.rz) ||
      (factions && owner?.faction === viewer.faction);
    // A colour's keep is the colour's, whoever founded it. A cell is keep only where a keep was
    // handed out, so one that is not the viewer's has an owner.
    const whose = !owner
      ? 'A keep'
      : factions
        ? `${factionName(owner.faction)}'s keep`
        : `u/${owner.username}'s keep`;
    return {
      where,
      who: mine ? 'Your keep' : whose,
      faction: owner?.faction ?? null,
      score: null,
      action: null,
      blocked: null,
    };
  }

  const hold = holdings.land.find((h) => h.x === cell.x && h.z === cell.z);
  const blocked = live ? shortReason(judge(cell.x, cell.z, (hold?.score ?? 0) + 1)) : null;

  if (!hold) {
    return {
      where,
      who: 'Open land',
      faction: null,
      score: null,
      action:
        blocked || !live
          ? null
          : {
              verb: `Claim ${where}`,
              sub: `+1 cell for ${factionName(viewer.faction)}`,
              aim: { kind: 'claim', score: 0, cell },
            },
      blocked,
    };
  }

  const mine = viewer.userId !== null && hold.userId === viewer.userId;
  const score = hold.score.toLocaleString();
  // Named for the best tower in the cell's stack, whose score is the bar, and the rest counted.
  const more = stackOf(hold) - 1;
  const who = `${mine ? 'Your land' : `u/${hold.username}`}${more > 0 ? ` +${more}` : ''}`;
  // The colour's own ground on a factions map: a tower goes on top of it, and there is no run to
  // start against it.
  if (factions && hold.faction === viewer.faction) {
    return { where, who, faction: hold.faction, score: hold.score, action: null, blocked: null };
  }
  return {
    where,
    who,
    faction: hold.faction ?? null,
    score: hold.score,
    action:
      blocked || !live
        ? null
        : {
            verb: mine ? 'Replace it' : `Take ${where}`,
            sub: mine ? `Beat your ${score}` : `Beat ${score}`,
            aim: {
              kind: 'take',
              username: hold.username,
              faction: hold.faction ?? undefined,
              score: hold.score,
              cell,
              own: mine,
            },
          },
    blocked,
  };
};
