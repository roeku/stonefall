import type { BragKind } from '../../../shared/types/api';
import type { ScoreComment } from '../../../shared/social/comments';
import type { FactionId } from '../../../shared/types/factions';

/**
 * A raised run the game may offer to announce, and the comment it would make.
 *
 * Kept out of the component files so the confirmation and the request are built from one place:
 * what the player is shown is, field for field, what the server is sent and writes from.
 */

export interface PlacedRun {
  sessionId: string;
  score: number;
  blocks: number;
  perfectStreak: number;
  /** Set when the run beat the score the player was chasing. */
  passed?: { username: string; score: number; faction?: FactionId | undefined } | undefined;
  /** Set when the tower took a cell from somebody else. */
  took?: { username: string; score: number; faction?: FactionId | undefined } | undefined;
  /** The cell it stands on, when it stands on land. */
  cell?: { x: number; z: number } | undefined;
  /** Set when the run beat everything else the player has standing. */
  isBest: boolean;
  /** Set when this is the first tower they have raised. */
  isFirst: boolean;
  /** The colour the run was built under, as the server stored it: the comment names it. */
  faction?: FactionId | null | undefined;
}

/** Which of the fixed phrasings a raised run has earned. Naming somebody wins. */
export const bragKindFor = (run: PlacedRun): BragKind =>
  run.took
    ? 'took'
    : run.passed
      ? 'passed'
      : run.cell
        ? 'claimed'
        : run.isFirst
          ? 'first'
          : run.isBest
            ? 'best'
            : 'plain';

/**
 * The comment a raised run would post, field for field what the server is sent and writes from,
 * so the confirmation can show its exact text.
 */
export const commentFor = (run: PlacedRun): ScoreComment => {
  const kind = bragKindFor(run);
  const named = kind === 'took' ? run.took : kind === 'passed' ? run.passed : undefined;
  return {
    kind,
    score: run.score,
    blocks: run.blocks,
    perfectStreak: run.perfectStreak,
    faction: run.faction ?? null,
    passedUsername: named?.username,
    passedScore: named?.score,
    cell: kind === 'took' || kind === 'claimed' ? run.cell : undefined,
  };
};
