import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What the Devvit Rules ask of the storage and the comments, against an in-memory stand-in for
 * Devvit's Redis and Reddit clients: score comments are replies under one pinned comment, deleted
 * posts and comments leave the records, and the retirement job clears what named players forever
 * without touching the records that are still live.
 */

type Z = Map<string, number>;
const store = {
  strings: new Map<string, string>(),
  hashes: new Map<string, Map<string, string>>(),
  zsets: new Map<string, Z>(),
  ttl: new Map<string, number>(),
};
const comments: Array<{
  id: string;
  parent: string;
  text: string;
  runAs: string;
  pinned: boolean;
}> = [];

const has = (k: string) => store.strings.has(k) || store.hashes.has(k) || store.zsets.has(k);
const drop = (k: string) => {
  store.strings.delete(k);
  store.hashes.delete(k);
  store.zsets.delete(k);
  store.ttl.delete(k);
};
const zset = (k: string): Z => {
  let z = store.zsets.get(k);
  if (!z) store.zsets.set(k, (z = new Map()));
  return z;
};
const ranked = (k: string) => [...(store.zsets.get(k) ?? new Map())].sort((a, b) => a[1] - b[1]);
const span = <T>(rows: T[], start: number, stop: number): T[] => {
  const n = rows.length;
  const from = start < 0 ? Math.max(0, n + start) : start;
  const to = stop < 0 ? n + stop : Math.min(stop, n - 1);
  return from > to ? [] : rows.slice(from, to + 1);
};

const redis = {
  get: async (k: string) => store.strings.get(k),
  set: async (k: string, v: string, o?: { nx?: boolean; expiration?: Date }) => {
    if (o?.nx && has(k)) return;
    store.strings.set(k, v);
    if (o?.expiration) store.ttl.set(k, o.expiration.getTime());
  },
  del: async (...keys: string[]) => keys.forEach(drop),
  exists: async (...keys: string[]) => keys.filter(has).length,
  expire: async (k: string, seconds: number) => {
    if (has(k)) store.ttl.set(k, Date.now() + seconds * 1000);
  },
  hSet: async (k: string, fields: Record<string, string>) => {
    const h = store.hashes.get(k) ?? new Map<string, string>();
    for (const [f, v] of Object.entries(fields)) h.set(f, v);
    store.hashes.set(k, h);
  },
  hGetAll: async (k: string) => Object.fromEntries(store.hashes.get(k) ?? []),
  zAdd: async (k: string, ...rows: Array<{ member: string; score: number }>) => {
    for (const r of rows) zset(k).set(r.member, r.score);
  },
  zRange: async (k: string, start: number, stop: number, o?: { reverse?: boolean }) => {
    const rows = ranked(k);
    if (o?.reverse) rows.reverse();
    return span(rows, start, stop).map(([member, score]) => ({ member, score }));
  },
  zRem: async (k: string, members: string[]) => {
    for (const m of members) store.zsets.get(k)?.delete(m);
    if (store.zsets.get(k)?.size === 0) drop(k);
  },
  zRemRangeByRank: async (k: string, start: number, stop: number) => {
    for (const [m] of span(ranked(k), start, stop)) store.zsets.get(k)?.delete(m);
  },
};

let nextComment = 1;
const reddit = {
  getCurrentUser: async () => ({ id: 't2_me', username: 'me' }),
  submitComment: async (o: { id: string; text: string; runAs?: string }) => {
    const c = {
      id: `t1_${nextComment++}`,
      parent: o.id,
      text: o.text,
      runAs: o.runAs ?? 'APP',
      pinned: false,
    };
    comments.push(c);
    return {
      id: c.id,
      permalink: `/r/test/comments/x/_/${c.id.slice(3)}`,
      distinguish: async (sticky?: boolean) => void (c.pinned = !!sticky),
    };
  },
};

vi.mock('@devvit/web/server', () => ({ redis, reddit, context: { postId: 't3_post' } }));

const { SocialService } = await import('./socialService');
const { Admin } = await import('./admin');
const { scoresThreadKey, feedKey, userKey, SCORE_BOARD, LEGACY_MAP, USER_DATA_TTL_SECONDS } =
  await import('./keys');

beforeEach(() => {
  store.strings.clear();
  store.hashes.clear();
  store.zsets.clear();
  store.ttl.clear();
  comments.length = 0;
});

const brag = (sessionId: string, edited?: string) =>
  SocialService.brag(
    { sessionId, kind: 'best', score: 1200, blocks: 14, perfectStreak: 3, faction: 'lime' },
    't3_post',
    edited
  );

describe('score comments', () => {
  it('reply as the player under one pinned comment the app makes', async () => {
    expect((await brag('a')).ok).toBe(true);
    expect((await brag('b')).ok).toBe(true);

    const pinned = comments.filter((c) => c.parent === 't3_post');
    expect(pinned).toHaveLength(1);
    expect(pinned[0]).toMatchObject({ runAs: 'APP', pinned: true });
    const replies = comments.filter((c) => c.parent === pinned[0]!.id);
    expect(replies.map((c) => c.runAs)).toEqual(['USER', 'USER']);
    expect(replies[0]!.text).toContain('New personal best.');
  });

  it('expire with their post: the feed names players', async () => {
    await brag('a');
    const ttl = store.ttl.get(feedKey('t3_post'))!;
    expect(ttl - Date.now()).toBeLessThanOrEqual(USER_DATA_TTL_SECONDS * 1000);
  });

  it('leave the feed when deleted, and a deleted pinned comment is replaced by the next score', async () => {
    await brag('a');
    const [pinned, reply] = comments;
    await SocialService.forgetComment(reply!.id, 't3_post');
    expect(await SocialService.feed(12, 't3_post')).toHaveLength(0);

    await SocialService.forgetComment(pinned!.id, 't3_post');
    expect(store.strings.has(scoresThreadKey('t3_post'))).toBe(false);
    await brag('b');
    expect(comments.filter((c) => c.parent === 't3_post')).toHaveLength(2);
  });

  it('keep the game’s own words, bold score and all, when the player submits them unchanged', async () => {
    const result = await brag(
      'a',
      '1,200 off 14 blocks, best chain 3 perfect.\n\nNew personal best.'
    );
    expect(result).toMatchObject({ ok: true, topLevel: false });
    const reply = comments.find((c) => c.runAs === 'USER')!;
    expect(reply.text).toBe('**1,200** off 14 blocks, best chain 3 perfect.\n\nNew personal best.');
    expect(reply.parent).not.toBe('t3_post');
  });

  it('go up as the player’s own top-level comment when they add words of their own', async () => {
    const own = '1,200 off 14 blocks. The wobble at block 9 nearly had me.';
    const result = await brag('a', own);
    expect(result).toMatchObject({ ok: true, topLevel: true });
    const mine = comments.find((c) => c.runAs === 'USER')!;
    expect(mine).toMatchObject({ parent: 't3_post', text: own });
    // No pinned comment is made for a comment that does not go under it.
    expect(comments.filter((c) => c.runAs === 'APP')).toHaveLength(0);
    // The game keeps the run, not the words.
    expect(JSON.stringify(await SocialService.feed(12, 't3_post'))).not.toContain('wobble');
  });

  it('stay under Scores, in the player’s words, when they only cut the game’s', async () => {
    const result = await brag('a', 'New personal best.');
    expect(result).toMatchObject({ ok: true, topLevel: false });
    const reply = comments.find((c) => c.runAs === 'USER')!;
    expect(reply.text).toBe('New personal best.');
    expect(reply.parent).not.toBe('t3_post');
  });

  it('refuse a comment over the limit, and leave the run free to try again', async () => {
    const result = await brag('a', `${'word '.repeat(500)}`);
    expect(result.ok).toBe(false);
    expect(comments).toHaveLength(0);
    expect((await brag('a')).ok).toBe(true);
  });

  it('all go when their post is deleted', async () => {
    await brag('a');
    await SocialService.forgetPost('t3_post');
    expect(has(feedKey('t3_post'))).toBe(false);
    expect(has(scoresThreadKey('t3_post'))).toBe(false);
  });
});

describe('the retirement job', () => {
  it('clears what named players forever and leaves live records, only giving them an expiry', async () => {
    // A live player record with no expiry, and the old score table that listed them.
    await redis.hSet(userKey('t2_live'), { username: 'live', faction: 'jade' });
    await redis.zAdd(SCORE_BOARD, { member: 't2_live', score: 900 });
    // The map from before maps were daily.
    await redis.zAdd(LEGACY_MAP.PLOT_INDEX, { member: 't2_old', score: 1 });
    await redis.set(
      LEGACY_MAP.plot('t2_old'),
      JSON.stringify({ userId: 't2_old', username: 'old', placements: [{ sessionId: 'r1' }] })
    );
    await redis.set('run:r1', JSON.stringify({ userId: 't2_old', username: 'old' }));
    await redis.set(LEGACY_MAP.keep('t2_old'), '{}');
    await redis.zAdd(LEGACY_MAP.LAND_INDEX, { member: '3,4', score: 1 });
    await redis.set(LEGACY_MAP.cell('3,4'), JSON.stringify({ username: 'old' }));
    // The keyspace from before the rewrite.
    await redis.zAdd('index:grids', { member: 't2_older', score: 1 });
    await redis.set('grid:t2_older', '{}');

    let batch = await Admin.retireBatch();
    for (let i = 0; i < 5 && !batch.done; i++) batch = await Admin.retireBatch();
    expect(batch.done).toBe(true);
    expect(await Admin.retired()).toBe(true);

    for (const gone of [
      SCORE_BOARD,
      LEGACY_MAP.PLOT_INDEX,
      LEGACY_MAP.plot('t2_old'),
      LEGACY_MAP.keep('t2_old'),
      'run:r1',
      LEGACY_MAP.LAND_INDEX,
      LEGACY_MAP.cell('3,4'),
      'index:grids',
      'grid:t2_older',
    ]) {
      expect(has(gone), gone).toBe(false);
    }
    expect(store.hashes.get(userKey('t2_live'))?.get('faction')).toBe('jade');
    expect(store.ttl.get(userKey('t2_live'))).toBeGreaterThan(Date.now());
  });

  it('does nothing harmful when run again', async () => {
    await Admin.retireBatch();
    const again = await Admin.retireBatch();
    expect(again.done).toBe(true);
  });
});
