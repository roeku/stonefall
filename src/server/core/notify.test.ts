import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Push notifications against an in-memory stand-in for Devvit's Redis and its notifications:
 * Reddit has the say on who opted in, a player is filed under the UTC hour their evening starts
 * in, and nobody gets a third push in 24 hours, which Reddit refuses.
 */

const hashes = new Map<string, Map<string, string>>();
const strings = new Map<string, string>();
const zsets = new Map<string, Map<string, number>>();
const hash = (k: string) => {
  let h = hashes.get(k);
  if (!h) hashes.set(k, (h = new Map()));
  return h;
};
const zset = (k: string) => {
  let z = zsets.get(k);
  if (!z) zsets.set(k, (z = new Map()));
  return z;
};

const redis = {
  get: async (k: string) => strings.get(k),
  set: async (k: string, v: string) => void strings.set(k, v),
  exists: async (...keys: string[]) => keys.filter((k) => hashes.has(k) || strings.has(k)).length,
  expire: async () => {},
  hSet: async (k: string, fields: Record<string, string>) => {
    for (const [f, v] of Object.entries(fields)) hash(k).set(f, v);
  },
  hGetAll: async (k: string) => Object.fromEntries(hashes.get(k) ?? []),
  zAdd: async (k: string, ...rows: Array<{ member: string; score: number }>) => {
    for (const r of rows) zset(k).set(r.member, r.score);
  },
  zRem: async (k: string, members: string[]) => members.forEach((m) => zsets.get(k)?.delete(m)),
  zCard: async (k: string) => zsets.get(k)?.size ?? 0,
  zRange: async (k: string) =>
    [...(zsets.get(k) ?? [])].map(([member, score]) => ({ member, score })),
  zRemRangeByScore: async (k: string, min: number, max: number) => {
    for (const [m, score] of zsets.get(k) ?? []) {
      if (score >= min && score <= max) zsets.get(k)?.delete(m);
    }
  },
};

/** Who Reddit says opted in, and what was sent. */
const opted = new Set<string>();
const sent: Array<{ title: string; to: string[] }> = [];
const notifications = {
  isOptedIn: vi.fn(async (userId: string) => opted.has(userId)),
  optInCurrentUser: async () => (opted.add('t2_me'), { success: true }),
  optOutCurrentUser: async () => (opted.delete('t2_me'), { success: true }),
  enqueue: async (o: { title: string; recipients: Array<{ userId: string }> }) => {
    sent.push({ title: o.title, to: o.recipients.map((r) => r.userId) });
    return { successCount: o.recipients.length, failureCount: 0, errors: [] };
  },
};

vi.mock('@devvit/web/server', () => ({ redis, notifications }));

const { Notify } = await import('./notify');
const { Users } = await import('./users');

/** Every hour set with anyone in it. */
const filed = () =>
  Object.fromEntries(
    [...zsets]
      .filter(([k, z]) => k.startsWith('notify:hour:') && z.size)
      .map(([k, z]) => [k, [...z.keys()]])
  );

const at = (iso: string) => vi.setSystemTime(new Date(iso));

beforeEach(() => {
  hashes.clear();
  strings.clear();
  zsets.clear();
  opted.clear();
  sent.length = 0;
  vi.useFakeTimers({ toFake: ['Date'] });
  at('2026-10-24T08:00:00Z');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Notify.set and Notify.state', () => {
  it('files a player under the UTC hour their evening starts in, and out again', async () => {
    expect(await Notify.set('t2_me', true, -300)).toEqual({ ok: true });
    expect(filed()).toEqual({ 'notify:hour:0': ['t2_me'] });
    expect(await Notify.set('t2_me', false, -300)).toEqual({ ok: true });
    expect(filed()).toEqual({});
    expect((await Users.read('t2_me')).notify).toBe('0');
  });

  it('follows Reddit when the player turned them off in its settings', async () => {
    await Notify.set('t2_me', true, 120);
    opted.delete('t2_me');
    expect(await Notify.state('t2_me', 120)).toBe(false);
    expect((await Users.read('t2_me')).notify).toBe('0');
    expect(filed()).toEqual({});
  });

  it('moves the player when their clock moves, and keeps them without an offset', async () => {
    await Notify.set('t2_me', true, 60);
    expect(filed()).toEqual({ 'notify:hour:18': ['t2_me'] });
    expect(await Notify.state('t2_me', 120)).toBe(true);
    expect(filed()).toEqual({ 'notify:hour:17': ['t2_me'] });
    expect(await Notify.state('t2_me', undefined)).toBe(true);
    expect(filed()).toEqual({ 'notify:hour:17': ['t2_me'] });
  });

  it('files an opted-in player whose record expired, and writes nothing for one who never did', async () => {
    opted.add('t2_me');
    expect(await Notify.state('t2_me', 330)).toBe(true);
    expect(filed()).toEqual({ 'notify:hour:13': ['t2_me'] });
    expect(await Notify.state('t2_new', 0)).toBe(false);
    expect(hashes.has('user:t2_new')).toBe(false);
  });

  it("falls back to the record when Reddit can't be asked", async () => {
    await Notify.set('t2_me', true, 0);
    notifications.isOptedIn.mockRejectedValueOnce(new Error('down'));
    expect(await Notify.state('t2_me', 0)).toBe(true);
  });
});

describe('two pushes in any 24 hours', () => {
  /** UTC+9: evening at 10:00 UTC, quiet from 13:00 UTC. A 3-day streak through the 23rd. */
  const seoul = async () => {
    opted.add('t2_kim');
    await Users.write('t2_kim', {
      notify: '1',
      tz: '540',
      notifyHour: '10',
      streak: '3',
      streakDay: '2026-10-22',
    });
    await redis.zAdd('notify:hour:10', { member: 't2_kim', score: Date.now() });
  };
  const take = (day: string) =>
    Notify.taken({ userId: 't2_kim', taker: 'rival', cell: 'E7', score: 900, day, postId: 't3_p' });
  const to = () => sent.map((s) => (s.title.includes('streak') ? 'streak' : 'take'));

  it("refuses a third across the map's turn at 12:00 UTC, and sends it once one is a day old", async () => {
    await seoul();
    at('2026-10-24T09:00:00Z'); // 18:00 in Seoul, the map of the 23rd
    await take('2026-10-23');
    at('2026-10-24T10:05:00Z'); // 19:05: the streak reminder
    expect(await Notify.streaks(Date.now(), '2026-10-23', 't3_p')).toBe(1);
    at('2026-10-24T12:30:00Z'); // 21:30, the map of the 24th: a third in under four hours
    await take('2026-10-24');
    expect(to()).toEqual(['take', 'streak']);

    at('2026-10-25T09:30:00Z'); // the first push is now a day old, and the 24th's take never went
    await take('2026-10-24');
    expect(to()).toEqual(['take', 'streak', 'take']);
  });

  it('still sends one of each kind a map day at most', async () => {
    await seoul();
    at('2026-10-24T09:00:00Z');
    await take('2026-10-23');
    at('2026-10-24T09:30:00Z');
    await take('2026-10-23');
    expect(to()).toEqual(['take']);
  });
});
