import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The game's flair and its awards, against an in-memory stand-in for Devvit's Redis and Reddit's
 * flair: every player wears it from their first game, a day's winners wear their awards until the
 * next day's, an ended streak comes down, and taking it off gives back the player's own flair.
 */

const hashes = new Map<string, Map<string, string>>();
const strings = new Map<string, string>();
const zsets = new Map<string, Map<string, number>>();
const hash = (k: string) => {
  let h = hashes.get(k);
  if (!h) hashes.set(k, (h = new Map()));
  return h;
};

const redis = {
  get: async (k: string) => strings.get(k),
  set: async (k: string, v: string) => void strings.set(k, v),
  del: async (...keys: string[]) =>
    keys.forEach((k) => (hashes.delete(k), strings.delete(k), zsets.delete(k))),
  exists: async (...keys: string[]) => keys.filter((k) => hashes.has(k) || strings.has(k)).length,
  expire: async () => {},
  hSet: async (k: string, fields: Record<string, string>) => {
    for (const [f, v] of Object.entries(fields)) hash(k).set(f, v);
  },
  hGet: async (k: string, f: string) => hashes.get(k)?.get(f),
  hGetAll: async (k: string) => Object.fromEntries(hashes.get(k) ?? []),
  hKeys: async (k: string) => [...(hashes.get(k)?.keys() ?? [])],
  hDel: async (k: string, fields: string[]) => fields.forEach((f) => hashes.get(k)?.delete(f)),
  zAdd: async (k: string, ...rows: Array<{ member: string; score: number }>) => {
    if (!zsets.has(k)) zsets.set(k, new Map());
    for (const r of rows) zsets.get(k)?.set(r.member, r.score);
  },
  zRange: async (k: string, min: number, max: number) =>
    [...(zsets.get(k) ?? [])]
      .filter(([, score]) => score >= min && score <= max)
      .map(([member, score]) => ({ member, score })),
  zRemRangeByScore: async (k: string, min: number, max: number) => {
    for (const [m, score] of zsets.get(k) ?? []) {
      if (score >= min && score <= max) zsets.get(k)?.delete(m);
    }
  },
};

/** Reddit's flair in the subreddit, by username. */
const flairs = new Map<string, { text: string; cssClass?: string; backgroundColor?: string }>();
const reddit = {
  setUserFlair: async (o: {
    username: string;
    text: string;
    cssClass?: string;
    backgroundColor?: string;
  }) => void flairs.set(o.username, { text: o.text, cssClass: o.cssClass, ...o }),
  removeUserFlair: async (_sub: string, username: string) => void flairs.delete(username),
  getCurrentSubreddit: async () => ({
    name: 'stonefall',
    getUserFlair: async ({ usernames }: { usernames: string[] }) => ({
      users: usernames.map((u) => ({
        user: u,
        flairText: flairs.get(u)?.text,
        flairCssClass: flairs.get(u)?.cssClass,
      })),
    }),
  }),
};

vi.mock('@devvit/web/server', () => ({ redis, reddit, context: { subredditName: 'stonefall' } }));

const { Awards } = await import('./awards');
const { Flair } = await import('./flair');
const { userKey } = await import('./keys');

const DAY1 = '2026-10-04';
const DAY2 = '2026-10-05';
const DAY3 = '2026-10-06';

const record = (userId: string, fields: Record<string, string>) =>
  redis.hSet(userKey(userId), fields);
const textOf = (username: string) => flairs.get(username)?.text ?? null;

const runAll = async (day: string) => {
  for (let i = 0; i < 20; i++) if ((await Awards.batch(day)).done) return;
  throw new Error('the awards job never finished');
};

const p = (userId: string, username: string, faction: 'cobalt' | 'rose' | 'jade') => ({
  userId,
  username,
  faction,
});

beforeEach(() => {
  hashes.clear();
  strings.clear();
  zsets.clear();
  flairs.clear();
});

const noWinners = {
  ranked: [],
  best: null,
  bestId: null,
  most: null,
  mostId: null,
  players: [],
};

describe('the game’s flair', () => {
  it('goes on at a player’s first game, and taking it off gives theirs back', async () => {
    await record('t2_bob', { faction: 'cobalt', streak: '3', streakDay: DAY1 });
    flairs.set('bob', { text: 'Pixel artist', cssClass: 'art' });

    await Flair.played('t2_bob', 'bob', DAY1);
    expect(textOf('bob')).toBe('Cobalt · 3-day streak');
    expect(Flair.wearing(await redis.hGetAll(userKey('t2_bob')))).toBe(true);

    await Flair.set('t2_bob', 'bob', false, DAY1);
    expect(flairs.get('bob')).toMatchObject({ text: 'Pixel artist', cssClass: 'art' });
    await Flair.played('t2_bob', 'bob', DAY1);
    expect(textOf('bob')).toBe('Pixel artist');

    await Flair.set('t2_bob', 'bob', true, DAY1);
    expect(textOf('bob')).toBe('Cobalt · 3-day streak');
  });

  it('brings an ended streak down, and forgets the player until they play again', async () => {
    await record('t2_bob', { faction: 'cobalt', streak: '3', streakDay: DAY1 });
    await Flair.played('t2_bob', 'bob', DAY1);
    await Awards.fromMap(DAY2, DAY1, noWinners);
    await runAll(DAY2);
    expect(textOf('bob')).toBe('Cobalt · 3-day streak');

    // No game on DAY2, so the streak has ended by DAY3.
    await Awards.fromMap(DAY3, DAY2, noWinners);
    await runAll(DAY3);
    expect(textOf('bob')).toBe('Cobalt');
    expect(await Flair.lapsed(DAY3)).toEqual([]);
  });
});

describe('flair awards', () => {
  it('puts a day’s awards on everyone who won them, and takes them back the next day', async () => {
    // Bob chose his own flair; Carol still has the old version's.
    await record('t2_alice', { faction: 'cobalt' });
    await record('t2_bob', { faction: 'cobalt' });
    await record('t2_carol', { faction: 'rose' });
    await record('t2_dave', { faction: 'jade' });
    flairs.set('bob', { text: 'Pixel artist', cssClass: 'art' });
    flairs.set('carol', { text: 'ELO 1234 | MAX 56' });

    await Awards.fromMap(DAY1, '2026-10-03', {
      ranked: [
        { faction: 'cobalt', cells: 40 },
        { faction: 'rose', cells: 31 },
      ],
      best: { username: 'carol' },
      bestId: 't2_carol',
      most: { username: 'alice' },
      mostId: 't2_alice',
      players: [
        p('t2_alice', 'alice', 'cobalt'),
        p('t2_bob', 'bob', 'cobalt'),
        p('t2_carol', 'carol', 'rose'),
      ],
    });
    await Awards.fromRelay(DAY1, '2026-10-03', { most: { username: 'dave' }, mostId: 't2_dave' });
    await runAll(DAY1);

    expect(textOf('alice')).toBe('Cobalt · Won Sat · Most land');
    expect(textOf('bob')).toBe('Cobalt · Won Sat');
    expect(flairs.get('bob')?.backgroundColor).toBe('#5c8dff');
    expect(textOf('carol')).toBe('Rose · Best tower');
    expect(textOf('dave')).toBe('Jade · Most blocks');

    // The next day is a tie, and only Alice wins anything.
    await Awards.fromMap(DAY2, DAY1, {
      ranked: [
        { faction: 'cobalt', cells: 20 },
        { faction: 'rose', cells: 20 },
      ],
      best: { username: 'alice' },
      bestId: 't2_alice',
      most: null,
      mostId: null,
      players: [p('t2_alice', 'alice', 'cobalt'), p('t2_carol', 'carol', 'rose')],
    });
    await runAll(DAY2);

    expect(textOf('alice')).toBe('Cobalt · Best tower');
    expect(textOf('bob')).toBe('Cobalt');
    expect(textOf('carol')).toBe('Rose');
    expect(textOf('dave')).toBe('Jade');

    // Bob's own flair was kept when the game's first went on; Carol's old one was not.
    await Flair.set('t2_bob', 'bob', false, DAY2);
    expect(flairs.get('bob')).toMatchObject({ text: 'Pixel artist', cssClass: 'art' });
    await Flair.set('t2_carol', 'carol', false, DAY2);
    expect(textOf('carol')).toBeNull();
  });

  it('works through a big winning colour a batch at a time, and only once', async () => {
    const players = Array.from({ length: 60 }, (_, i) => p(`t2_${i}`, `player${i}`, 'rose'));
    for (const x of players) await record(x.userId, { faction: 'rose' });
    await Awards.fromMap(DAY1, '2026-10-03', {
      ranked: [{ faction: 'rose', cells: 90 }],
      best: null,
      bestId: null,
      most: null,
      mostId: null,
      players,
    });
    expect((await Awards.batch(DAY1)).done).toBe(false);
    await runAll(DAY1);
    expect(players.every((x) => textOf(x.username) === 'Rose · Won Sat')).toBe(true);

    flairs.clear();
    expect(await Awards.batch(DAY1)).toEqual({ done: true, players: 0 });
    expect(flairs.size).toBe(0);
  });

  it('leaves a winner who took it off without it, and shows it if they put it back', async () => {
    await record('t2_bob', { faction: 'cobalt', flair: '0' });
    await Awards.fromMap(DAY1, '2026-10-03', {
      ranked: [{ faction: 'cobalt', cells: 5 }],
      best: { username: 'bob' },
      bestId: 't2_bob',
      most: null,
      mostId: null,
      players: [p('t2_bob', 'bob', 'cobalt')],
    });
    await runAll(DAY1);
    expect(textOf('bob')).toBeNull();

    await Flair.set('t2_bob', 'bob', true, DAY1);
    expect(textOf('bob')).toBe('Cobalt · Won Sat · Best tower');
  });
});
