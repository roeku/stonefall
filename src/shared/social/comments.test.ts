import { describe, expect, it } from 'vitest';
import {
  NOTE_MAX,
  addsCommentary,
  commentPreview,
  commentToPost,
  ownNote,
  type ScoreComment,
} from './comments';

/**
 * What is posted and where: the game's line alone under the pinned Scores comment, or the
 * player's words with the line under them as a top-level comment of theirs.
 */

const best: ScoreComment = {
  kind: 'best',
  score: 4638,
  blocks: 26,
  perfectStreak: 25,
  faction: 'lime',
};
const game = commentPreview(best); // "New best: 4,638."

describe('commentToPost', () => {
  it('posts the game’s line alone under Scores when the player writes nothing', () => {
    expect(commentToPost(best)).toEqual({ text: 'New best: **4,638**.', topLevel: false });
    expect(commentToPost(best, '   ')).toEqual({ text: 'New best: **4,638**.', topLevel: false });
  });

  it('puts the player’s words above the game’s line, as their own comment', () => {
    expect(commentToPost(best, '  Finally held my nerve past 20. ')).toEqual({
      text: 'Finally held my nerve past 20.\n\nNew best: **4,638**.',
      topLevel: true,
    });
  });

  it('keeps the line whatever the player writes: it cannot be edited away', () => {
    const post = commentToPost(best, 'Beat that.');
    expect(post?.text.endsWith('New best: **4,638**.')).toBe(true);
  });

  it('posts the line alone when the player only repeats it', () => {
    expect(commentToPost(best, 'new best!')).toEqual({
      text: 'New best: **4,638**.',
      topLevel: false,
    });
  });

  it('refuses words over the limit', () => {
    expect(commentToPost(best, 'x'.repeat(NOTE_MAX))?.topLevel).toBe(true);
    expect(commentToPost(best, 'x'.repeat(NOTE_MAX + 1))).toBeNull();
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

describe('ownNote', () => {
  it('trims, and takes nothing as nothing', () => {
    expect(ownNote('  hi there \n')).toBe('hi there');
    expect(ownNote('   ')).toBeUndefined();
    expect(ownNote(undefined)).toBeUndefined();
    expect(ownNote(42)).toBeUndefined();
  });

  it('refuses words over the limit', () => {
    expect(ownNote('x'.repeat(NOTE_MAX))).toHaveLength(NOTE_MAX);
    expect(ownNote('x'.repeat(NOTE_MAX + 1))).toBeNull();
  });
});
