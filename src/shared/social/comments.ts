import type { BragKind } from '../types/api';
import { factionName, type FactionId } from '../types/factions';
import { cellLabel } from '../types/worldGrid';

/**
 * What a score comment says, word for word.
 *
 * Shared, so the game can show the player the exact comment before they confirm it and the
 * server posts that same text. Devvit's rules for acting as a user ask for exactly this: the
 * player sees what will appear on Reddit, and under whose name, before anything is sent.
 *
 * The player never writes the text. Every comment is assembled from a fixed set of phrasings and
 * the numbers the run actually produced, so there is no free text to moderate and no way to use
 * the game to send somebody an insult.
 */
export interface ScoreComment {
  kind: BragKind;
  score: number;
  blocks: number;
  perfectStreak: number;
  faction: FactionId | null;
  /** Whose score the run went past, or whose tower it toppled. Checked by the server. */
  passedUsername?: string | undefined;
  passedScore?: number | undefined;
  cell?: { x: number; z: number } | undefined;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/**
 * The comment text.
 *
 * Deliberately plain. Neon in the game, ordinary Reddit English in the thread, because a comment
 * that reads like marketing gets downvoted and a comment that reads like a person gets replies.
 */
export const composeBody = (b: ScoreComment): string => {
  const score = b.score.toLocaleString('en-US');
  const blocks = `${b.blocks.toLocaleString('en-US')} ${plural(b.blocks, 'block', 'blocks')}`;
  const chain =
    b.perfectStreak > 1 ? `, best chain ${b.perfectStreak.toLocaleString('en-US')} perfect` : '';
  const run = `**${score}** off ${blocks}${chain}.`;
  const cell = b.cell ? cellLabel(b.cell.x, b.cell.z) : 'a cell';
  const flag = factionName(b.faction);

  switch (b.kind) {
    case 'passed':
      // The one that actually starts arguments. Naming the person is the whole point, so it is
      // only ever sent when the player chose to send it, and only for a score the server can
      // find on today's map or in today's thread.
      return b.passedUsername
        ? `${run}\n\nThat puts me past u/${b.passedUsername}${
            b.passedScore ? ` on ${b.passedScore.toLocaleString('en-US')}` : ''
          }. Your move.`
        : `${run}\n\nMoved up the board.`;
    case 'took':
      return b.passedUsername
        ? `${run}\n\nTook ${cell} from u/${b.passedUsername}${
            b.passedScore ? `, who had ${b.passedScore.toLocaleString('en-US')} standing there` : ''
          }. ${flag} holds it now. Your move.`
        : `${run}\n\nTook ${cell} for ${flag}.`;
    case 'claimed':
      return `${run}\n\nClaimed ${cell} for ${flag}.`;
    case 'best':
      return `${run}\n\nNew personal best.`;
    case 'first':
      return `${run}\n\nFirst tower on my keep.`;
    case 'fell':
      return `Fell at block ${b.blocks.toLocaleString('en-US')} of today's relay tower.`;
    case 'plain':
    default:
      return run;
  }
};

/** The comment as a reader sees it: the Markdown bold dropped, paragraphs joined. */
export const commentPreview = (b: ScoreComment): string =>
  composeBody(b).replace(/\*\*/g, '').replace(/\n\n/g, ' ');

/**
 * The app's own pinned comment on each day's post.
 *
 * Score comments are replies to it rather than top-level comments, which is the pattern Devvit's
 * rules require for sharing a score: the repetitive results stay folded under one comment, out
 * of the way of the conversation, and each one is still the player's own comment to delete.
 */
export const SCORES_THREAD_TEXT =
  '**Scores.** Players who choose to share a result reply here, from their own account. ' +
  'The game only posts when a player taps Comment and confirms the text.';
