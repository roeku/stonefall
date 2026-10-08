import type { BragKind } from '../types/api';
import { factionName, type FactionId } from '../types/factions';
import { cellName } from '../types/worldGrid';

/**
 * What a score comment says, word for word.
 *
 * Shared, so the game can show the player the exact comment before they confirm it and the
 * server posts that same text. Devvit's rules for acting as a user ask for exactly this: the
 * player sees what will appear on Reddit, and under whose name, before anything is sent.
 *
 * The game writes the comment from a fixed set of phrasings and the numbers the run actually
 * produced. The player may put words of their own above it (see `commentToPost`): those are their
 * own comment, posted from their account like anything else they say on Reddit, and they are
 * never shown inside the game once posted, where only the run's own numbers and names appear.
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
  /** For `took`: the cell was this player's until the person named took it. A retake. */
  back?: boolean | undefined;
  /**
   * Where the run's tower stands, as the server found it on the player's plot: the line links to
   * it there. Not part of the words, so a line that names no cell links its score.
   */
  tower?: { x: number; z: number } | undefined;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** The post a comment goes into, which its cell link opens. */
export interface CommentPost {
  subredditName: string;
  postId: string;
}

/**
 * A link that opens the post on one cell.
 *
 * Reddit hands the `devvitshare` query parameter's `userData` to the game when the post opens
 * (`getShareData`). It carries the cell's world coordinates, because the name the comment shows
 * ("E7") is only unique within a plot.
 *
 * The parameter is Devvit's whole `ShareParam`, with the deprecated `path`, `params` and `hash`
 * left empty: a link with `userData` alone opened the post without it, and this is the shape of
 * a link from another game that works.
 */
export const cellLink = (post: CommentPost, x: number, z: number): string => {
  const share = JSON.stringify({ path: '', params: {}, hash: '', userData: `${x},${z}` });
  const id = post.postId.replace(/^t3_/, '');
  return `https://www.reddit.com/r/${post.subredditName}/comments/${id}/?devvitshare=${encodeURIComponent(share)}`;
};

/**
 * The cell a link's share data names (`cellLink`). Anyone can edit a link, so anything but two
 * whole numbers is nothing.
 */
export const parseCellLink = (data: unknown): { x: number; z: number } | null => {
  if (typeof data !== 'string') return null;
  const m = /^(-?\d{1,4}),(-?\d{1,4})$/.exec(data.trim());
  return m ? { x: Number(m[1]), z: Number(m[2]) } : null;
};

/**
 * The comment text: one line.
 *
 * Deliberately plain and short. Neon in the game, ordinary Reddit English in the thread: a
 * comment that reads like marketing gets downvoted, and a paragraph of stats gets scrolled past.
 * It used to carry the block count, the perfect chain, the plot and a second sentence; nobody
 * read that far. What is left is the one thing that happened and the score, and a name when
 * there is somebody to answer.
 *
 * Given the post it goes into, the line links to the run's tower there (`cellLink`): one link,
 * on the cell's name when the line names one, otherwise on the score.
 */
export const composeBody = (b: ScoreComment, post?: CommentPost): string => {
  const at = b.tower ?? b.cell;
  // Nothing stands on the road, so a link there would open on nothing.
  const link =
    post && at && cellName(at.x, at.z) !== 'the road' ? cellLink(post, at.x, at.z) : null;
  const name = b.cell ? cellName(b.cell.x, b.cell.z) : 'a cell';
  const onName = link !== null && b.cell !== undefined && name !== 'the road';
  const cell = onName ? `[${name}](${link})` : name;
  const bold = `**${b.score.toLocaleString('en-US')}**`;
  const score = link && !onName ? `[${bold}](${link})` : bold;
  const flag = factionName(b.faction);

  switch (b.kind) {
    case 'passed':
      // The one that actually starts arguments. Naming the person is the whole point, so it is
      // only ever sent when the player chose to send it, and only for a score the server can
      // find on today's map or in today's thread.
      return b.passedUsername
        ? `${score}, past u/${b.passedUsername}${
            b.passedScore ? `'s ${b.passedScore.toLocaleString('en-US')}` : ''
          }. Your move.`
        : `${score}, up the board.`;
    case 'took':
      return b.passedUsername
        ? `Took ${cell} ${b.back ? 'back ' : ''}from u/${b.passedUsername} with ${score}. Your move.`
        : `Took ${cell} for ${flag} with ${score}.`;
    case 'claimed':
      return `Claimed ${cell} for ${flag} with ${score}.`;
    case 'best':
      return `New best: ${score}.`;
    case 'first':
      return `First tower: ${score}.`;
    case 'fell':
      return `Fell at block ${b.blocks.toLocaleString('en-US')} of today's relay.`;
    case 'plain':
    default:
      return `${score} off ${b.blocks.toLocaleString('en-US')} ${plural(b.blocks, 'block', 'blocks')}.`;
  }
};

/** The comment as a reader sees it: the Markdown bold dropped, paragraphs joined. */
export const commentPreview = (b: ScoreComment): string =>
  composeBody(b).replace(/\*\*/g, '').replace(/\n\n/g, ' ');

/**
 * The most a player can add to the game's line. Written in a small box in the post, so a line or
 * two, not an essay; Reddit itself takes ten thousand.
 */
export const NOTE_MAX = 280;

/** What a comment says, not how: its words and numbers, lower-cased, in order. */
const words = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/**
 * Whether the player's words say something the game's line does not: a word it did not have.
 * That is what Devvit's rules mean by a score with commentary, which may be a top-level comment;
 * a generic score goes under the pinned Scores comment. Repeating the game's words, in any order
 * or punctuation, adds nothing.
 */
export const addsCommentary = (generated: string, note: string): boolean => {
  const pool = new Map<string, number>();
  for (const w of words(generated)) pool.set(w, (pool.get(w) ?? 0) + 1);
  for (const w of words(note)) {
    const left = pool.get(w) ?? 0;
    if (left === 0) return true;
    pool.set(w, left - 1);
  }
  return false;
};

/**
 * The player's own words, ready to post: trimmed, and within the limit. Undefined for nothing;
 * null when it is too long to take.
 */
export const ownNote = (raw: unknown): string | null | undefined => {
  if (typeof raw !== 'string') return undefined;
  const text = raw.replace(/\r\n?/g, '\n').trim();
  if (!text) return undefined;
  return text.length > NOTE_MAX ? null : text;
};

/**
 * What goes on Reddit, and where: the one decision, shared by the server, the harness and the
 * preview, so what the player sees is what is posted.
 *
 * The game's line is always there. On its own it goes under the pinned Scores comment. With words
 * of the player's own it goes under them, as their top-level comment: their voice leads and the
 * score reads as a signature, and the line cannot be edited away or made to say what the run did
 * not. Words that only repeat the line add nothing, so it goes under Scores alone.
 *
 * Null when the player's words are too long.
 */
export const commentToPost = (
  c: ScoreComment,
  rawNote?: unknown,
  post?: CommentPost
): { text: string; topLevel: boolean } | null => {
  const note = ownNote(rawNote);
  if (note === null) return null;
  const body = composeBody(c, post);
  if (note === undefined || !addsCommentary(commentPreview(c), note)) {
    return { text: body, topLevel: false };
  }
  return { text: `${note}\n\n${body}`, topLevel: true };
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
  'The game only posts when a player taps Post on the exact text.';

/**
 * The pinned comment as a day opens it: what happened yesterday, when there is something to say
 * (`shared/social/daily.ts`), above what the comment is for.
 */
export const scoresThreadText = (intro?: string | null): string =>
  intro ? `${intro}\n\n${SCORES_THREAD_TEXT}` : SCORES_THREAD_TEXT;
