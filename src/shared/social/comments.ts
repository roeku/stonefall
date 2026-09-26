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
 * The game writes the comment from a fixed set of phrasings and the numbers the run actually
 * produced. The player may edit it before it goes (see `addsCommentary`): what they write is
 * their own comment, posted from their account like anything else they say on Reddit, and it is
 * never shown inside the game, where only the run's own numbers and names appear.
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

/** The comment as the player edits it: plain text, its paragraphs kept. */
export const commentDraft = (b: ScoreComment): string => composeBody(b).replace(/\*\*/g, '');

/** The longest comment a player can write. Reddit takes ten thousand; a score needs far fewer. */
export const OWN_COMMENT_MAX = 2000;

/** What a comment says, not how: its words and numbers, lower-cased, in order. */
const words = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/** The same words in the same order: the game's comment untouched, whatever became of spacing. */
export const sameWords = (a: string, b: string): boolean =>
  words(a).join(' ') === words(b).join(' ');

/**
 * Whether an edited comment says something of the player's own: a word the game's comment did
 * not have. That is what Devvit's rules mean by a score with commentary, which may be a top-level
 * comment; a generic score goes under the pinned Scores comment. So cutting words, reordering them
 * or changing the punctuation leaves it the game's comment, and it still goes in the thread.
 */
export const addsCommentary = (generated: string, edited: string): boolean => {
  const pool = new Map<string, number>();
  for (const w of words(generated)) pool.set(w, (pool.get(w) ?? 0) + 1);
  for (const w of words(edited)) {
    const left = pool.get(w) ?? 0;
    if (left === 0) return true;
    pool.set(w, left - 1);
  }
  return false;
};

/**
 * A player's own text, ready to post: trimmed, and within the limit. Undefined for nothing
 * (which posts the game's comment); null when it is too long to take.
 */
export const ownCommentText = (raw: unknown): string | null | undefined => {
  if (typeof raw !== 'string') return undefined;
  const text = raw.replace(/\r\n?/g, '\n').trim();
  if (!text) return undefined;
  return text.length > OWN_COMMENT_MAX ? null : text;
};

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
