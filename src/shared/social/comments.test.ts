import { describe, expect, it } from 'vitest';
import {
  OWN_COMMENT_MAX,
  addsCommentary,
  commentDraft,
  commentPreview,
  ownCommentText,
  sameWords,
  type ScoreComment,
} from './comments';

/**
 * Where a comment goes: the game's own words under the pinned Scores comment, a comment the
 * player has put words of their own into as a top-level comment of theirs.
 */

const best: ScoreComment = {
  kind: 'best',
  score: 4638,
  blocks: 26,
  perfectStreak: 25,
  faction: 'lime',
};
const game = commentPreview(best); // "4,638 off 26 blocks, best chain 25 perfect. New personal best."

describe('the draft a player edits', () => {
  it('is the comment in plain text, its paragraphs kept', () => {
    expect(commentDraft(best)).toBe(
      '4,638 off 26 blocks, best chain 25 perfect.\n\nNew personal best.'
    );
  });
});

describe('sameWords', () => {
  it('ignores spacing, case and punctuation', () => {
    expect(sameWords(commentDraft(best), game)).toBe(true);
    expect(sameWords('4 638 OFF 26 blocks best chain 25 perfect new personal best!!', game)).toBe(
      true
    );
  });

  it('notices a word changed', () => {
    expect(sameWords(game.replace('personal', 'overall'), game)).toBe(false);
  });
});

describe('addsCommentary', () => {
  it('is true for words of the player’s own', () => {
    expect(addsCommentary(game, `${game} Finally got past the wobble at 20.`)).toBe(true);
    expect(addsCommentary(game, 'Beat that.')).toBe(true);
  });

  it('is false for cutting, reordering or re-punctuating the game’s words', () => {
    expect(addsCommentary(game, 'New personal best.')).toBe(false);
    expect(addsCommentary(game, 'New personal best! 4,638 off 26 blocks.')).toBe(false);
    expect(addsCommentary(game, game.toUpperCase())).toBe(false);
  });

  it('counts a repeated word as new once the game’s ran out', () => {
    expect(addsCommentary(game, `${game} best`)).toBe(true);
  });

  it('does not count emoji alone as words', () => {
    expect(addsCommentary(game, `${game} 🔥🔥`)).toBe(false);
  });
});

describe('ownCommentText', () => {
  it('trims, and takes nothing as nothing', () => {
    expect(ownCommentText('  hi there \n')).toBe('hi there');
    expect(ownCommentText('   ')).toBeUndefined();
    expect(ownCommentText(undefined)).toBeUndefined();
    expect(ownCommentText(42)).toBeUndefined();
  });

  it('refuses a comment over the limit', () => {
    expect(ownCommentText('x'.repeat(OWN_COMMENT_MAX))).toHaveLength(OWN_COMMENT_MAX);
    expect(ownCommentText('x'.repeat(OWN_COMMENT_MAX + 1))).toBeNull();
  });
});
