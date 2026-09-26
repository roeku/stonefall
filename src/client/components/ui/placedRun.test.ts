import { describe, expect, it } from 'vitest';
import { commentPreview, composeBody } from '../../../shared/social/comments';
import { commentFor, type PlacedRun } from './placedRun';

/**
 * The comment a player confirms is the comment that is posted. The confirmation renders
 * `commentPreview(commentFor(run))`, the request is built from the same `commentFor(run)`, and the
 * server writes `composeBody` from what it is sent, so these hold the three together.
 */

const run = (over: Partial<PlacedRun> = {}): PlacedRun => ({
  sessionId: 's1',
  score: 4638,
  blocks: 26,
  perfectStreak: 25,
  isBest: false,
  isFirst: false,
  faction: 'lime',
  ...over,
});

describe('commentFor', () => {
  it('names the toppled owner for a take, with the cell and the score they had', () => {
    const c = commentFor(
      run({ took: { username: 'player25', score: 4313 }, cell: { x: 3, z: 4 } })
    );
    expect(c.kind).toBe('took');
    expect(c.passedUsername).toBe('player25');
    expect(c.passedScore).toBe(4313);
    expect(c.cell).toEqual({ x: 3, z: 4 });
  });

  it('names the passed player for a pass, without a cell', () => {
    const c = commentFor(
      run({ passed: { username: 'kv_nine', score: 900 }, cell: { x: 3, z: 4 } })
    );
    expect(c.kind).toBe('passed');
    expect(c.passedUsername).toBe('kv_nine');
    expect(c.cell).toBeUndefined();
  });

  it('names nobody for a best, a first tower or a claim', () => {
    expect(commentFor(run({ isBest: true })).passedUsername).toBeUndefined();
    expect(commentFor(run({ isFirst: true })).kind).toBe('first');
    const claim = commentFor(run({ cell: { x: 1, z: 1 } }));
    expect(claim.kind).toBe('claimed');
    expect(claim.passedUsername).toBeUndefined();
  });

  it('carries the colour the run was built under', () => {
    expect(commentFor(run({ faction: 'ember' })).faction).toBe('ember');
    expect(commentFor(run({ faction: undefined })).faction).toBeNull();
  });
});

describe('the comment text', () => {
  it('shows the player exactly what is posted, without the Markdown', () => {
    const c = commentFor(
      run({ took: { username: 'player25', score: 4313 }, cell: { x: 3, z: 4 } })
    );
    const body = composeBody(c);
    expect(body.startsWith('**4,638** off 26 blocks, best chain 25 perfect.')).toBe(true);
    expect(body).toContain('from u/player25, who had 4,313 standing there.');
    expect(commentPreview(c)).toBe(body.replace(/\*\*/g, '').replace(/\n\n/g, ' '));
    expect(commentPreview(c)).not.toContain('**');
  });

  it('formats numbers the same way whatever the viewer locale is', () => {
    // The server posts in en-US; a preview in the player's own locale would differ from it.
    const body = composeBody(commentFor(run({ score: 1234567, isBest: true })));
    expect(body).toContain('**1,234,567**');
  });

  it('says a relay fall in one sentence', () => {
    expect(
      composeBody({ kind: 'fell', score: 0, blocks: 12, perfectStreak: 0, faction: 'lime' })
    ).toBe("Fell at block 12 of today's relay tower.");
  });
});
