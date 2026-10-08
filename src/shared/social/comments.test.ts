import { describe, expect, it } from 'vitest';
import {
  NOTE_MAX,
  SCORES_THREAD_TEXT,
  addsCommentary,
  cellLink,
  commentPreview,
  commentToPost,
  ownNote,
  parseCellLink,
  scoresThreadText,
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
      { ...base, kind: 'took', passedUsername: 'player7', passedScore: 1847, cell, back: true },
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
      commentPreview({
        ...base,
        kind: 'took',
        passedUsername: 'player7',
        passedScore: 1847,
        cell,
        back: true,
      })
    ).toBe('Took E7 back from u/player7 with 9,658. Your move.');
    expect(
      commentPreview({ ...base, kind: 'passed', passedUsername: 'player7', passedScore: 1847 })
    ).toBe("9,658, past u/player7's 1,847. Your move.");
    expect(commentPreview({ ...base, kind: 'claimed', cell })).toBe(
      'Claimed E7 for Violet with 9,658.'
    );
  });
});

describe('cell links', () => {
  const base = { score: 4638, blocks: 26, perfectStreak: 25, faction: 'lime' as const };
  const post = { subredditName: 'stonefall', postId: 't3_abc12' };

  it('link the cell’s name to the post on that cell, in the shape Reddit hands over', () => {
    const body = commentToPost({ ...base, kind: 'claimed', cell: { x: 1, z: 3 } }, '', post)!.text;
    const m = /^Claimed \[E7\]\((\S+)\) for Lime with \*\*4,638\*\*\.$/.exec(body);
    expect(m).not.toBeNull();
    const url = new URL(m![1]!);
    expect(url.origin + url.pathname).toBe('https://www.reddit.com/r/stonefall/comments/abc12/');
    // Byte for byte what a working link from another game carries, but for the coordinates.
    expect(url.search).toBe(
      '?devvitshare=%7B%22path%22%3A%22%22%2C%22params%22%3A%7B%7D%2C%22hash%22%3A%22%22%2C%22userData%22%3A%221%2C3%22%7D'
    );
    const share = JSON.parse(url.searchParams.get('devvitshare')!) as { userData: string };
    expect(parseCellLink(share.userData)).toEqual({ x: 1, z: 3 });
  });

  it('link the score when the line names no cell, so every map comment leads to its tower', () => {
    const tower = { x: -24, z: -8 };
    const passed = commentToPost(
      { ...base, kind: 'passed', passedUsername: 'player7', passedScore: 1595, tower },
      '',
      post
    )!.text;
    expect(passed).toBe(
      `[**4,638**](${cellLink(post, -24, -8)}), past u/player7's 1,595. Your move.`
    );
    expect(commentToPost({ ...base, kind: 'first', tower }, '', post)!.text).toBe(
      `First tower: [**4,638**](${cellLink(post, -24, -8)}).`
    );
  });

  it('put one link on a line, on the cell’s name when it has one', () => {
    const cell = { x: 1, z: 3 };
    const text = commentToPost({ ...base, kind: 'claimed', cell, tower: cell }, '', post)!.text;
    expect(text.match(/\]\(/g)).toHaveLength(1);
    expect(text).toContain('[E7](');
    expect(commentToPost({ ...base, kind: 'fell' }, '', post)!.text).not.toContain('](');
  });

  it('survive Markdown: nothing in the URL closes the link early', () => {
    expect(cellLink(post, -12, 40)).not.toMatch(/[()\s\]]/);
  });

  it('are left out of the preview, and off the road', () => {
    const took = {
      ...base,
      kind: 'took' as const,
      passedUsername: 'player7',
      cell: { x: 1, z: 3 },
    };
    expect(commentPreview(took)).toBe('Took E7 from u/player7 with 4,638. Your move.');
    expect(commentToPost({ ...took, cell: { x: 4, z: 3 } }, '', post)!.text).not.toContain('](');
  });

  it('read back only two whole coordinates', () => {
    expect(parseCellLink('-12,40')).toEqual({ x: -12, z: 40 });
    expect(parseCellLink(' 7,1 ')).toEqual({ x: 7, z: 1 });
    for (const bad of [
      undefined,
      null,
      7,
      '',
      '7',
      '7,1,2',
      '1.5,2',
      'cell:7,1',
      '7, 1',
      '99999,1',
    ]) {
      expect(parseCellLink(bad)).toBeNull();
    }
  });
});

describe('the pinned comment', () => {
  it('opens with yesterday when there is something to say, above what it is for', () => {
    expect(scoresThreadText(null)).toBe(SCORES_THREAD_TEXT);
    expect(scoresThreadText('**Yesterday.** Best tower: u/kv_nine.')).toBe(
      `**Yesterday.** Best tower: u/kv_nine.\n\n${SCORES_THREAD_TEXT}`
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
