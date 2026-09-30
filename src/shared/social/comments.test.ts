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
const game = commentPreview(best); // "New best: 4,638."

describe('the draft a player edits', () => {
  it('is the comment in plain text', () => {
    expect(commentDraft(best)).toBe('New best: 4,638.');
  });
});

describe('the game’s comments', () => {
  const base = { score: 9658, blocks: 48, perfectStreak: 45, faction: 'violet' as const };
  const cell = { x: 1, z: 3 };

  it('are one short sentence, whatever happened', () => {
    const all: ScoreComment[] = [
      { ...base, kind: 'took', passedUsername: 'player7', passedScore: 1847, cell },
      { ...base, kind: 'took', cell },
      { ...base, kind: 'passed', passedUsername: 'player7', passedScore: 1847 },
      { ...base, kind: 'passed' },
      { ...base, kind: 'claimed', cell },
      { ...base, kind: 'best' },
      { ...base, kind: 'first' },
      { ...base, kind: 'plain' },
      { ...base, kind: 'fell' },
    ];
    for (const c of all) {
      const text = commentPreview(c);
      expect(text.split(/[.!?](\s|$)/).filter((s) => s.trim()).length).toBeLessThanOrEqual(2);
      expect(text.length).toBeLessThanOrEqual(52);
    }
  });

  it('name the cell, the person and the score, and nothing about how the run went', () => {
    expect(
      commentPreview({ ...base, kind: 'took', passedUsername: 'player7', passedScore: 1847, cell })
    ).toBe('Took E7 from u/player7 with 9,658. Your move.');
    expect(
      commentPreview({ ...base, kind: 'passed', passedUsername: 'player7', passedScore: 1847 })
    ).toBe("9,658, past u/player7's 1,847. Your move.");
    expect(commentPreview({ ...base, kind: 'claimed', cell })).toBe(
      'Claimed E7 for Violet with 9,658.'
    );
  });
});

describe('sameWords', () => {
  it('ignores spacing, case and punctuation', () => {
    expect(sameWords(commentDraft(best), game)).toBe(true);
    expect(sameWords('NEW best 4 638!!', game)).toBe(true);
  });

  it('notices a word changed', () => {
    expect(sameWords(game.replace('New', 'Old'), game)).toBe(false);
  });
});

describe('addsCommentary', () => {
  it('is true for words of the player’s own', () => {
    expect(addsCommentary(game, `${game} Finally got past the wobble at 20.`)).toBe(true);
    expect(addsCommentary(game, 'Beat that.')).toBe(true);
  });

  it('is false for cutting, reordering or re-punctuating the game’s words', () => {
    expect(addsCommentary(game, 'New best.')).toBe(false);
    expect(addsCommentary(game, '4,638! New best')).toBe(false);
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
