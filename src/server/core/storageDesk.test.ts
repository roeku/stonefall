import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The storage dashboard against an in-memory stand-in for Devvit's Redis that can be made to
 * refuse writes the way Reddit's quota block does: the probe, what the overview infers from a
 * block, reading keys, the listings, and the changes with their confirmations.
 */

const strings = new Map<string, string>();
const hashes = new Map<string, Map<string, string>>();
const zsets = new Map<string, Map<string, number>>();
const ttl = new Map<string, number>();

/** What Redis refuses: nothing, every write, or every write but deletes. */
let refuse: 'none' | 'writes' | 'all' = 'none';
const QUOTA = new Error(
  '8 RESOURCE_EXHAUSTED: this app has exceeded its redis quota and all writes will be blocked going forward'
);
const write = () => {
  if (refuse !== 'none') throw QUOTA;
};

const has = (k: string) => strings.has(k) || hashes.has(k) || zsets.has(k);
const hash = (k: string) => {
  let h = hashes.get(k);
  if (!h) hashes.set(k, (h = new Map()));
  return h;
};
const ranked = (k: string) =>
  [...(zsets.get(k) ?? new Map<string, number>())].sort((a, b) => a[1] - b[1]);
const drop = (k: string) => {
  strings.delete(k);
  hashes.delete(k);
  zsets.delete(k);
  ttl.delete(k);
};

const redis = {
  get: async (k: string) => strings.get(k),
  set: async (k: string, v: string, o?: { nx?: boolean; expiration?: Date }) => {
    write();
    if (o?.nx && has(k)) return;
    strings.set(k, v);
    if (o?.expiration) ttl.set(k, o.expiration.getTime());
  },
  mGet: async (keys: string[]) => keys.map((k) => strings.get(k) ?? null),
  strLen: async (k: string) => strings.get(k)?.length ?? 0,
  getRange: async (k: string, start: number, end: number) =>
    (strings.get(k) ?? '').slice(start, end + 1),
  del: async (...keys: string[]) => {
    if (refuse === 'all') throw QUOTA;
    keys.forEach(drop);
  },
  exists: async (...keys: string[]) => keys.filter(has).length,
  type: async (k: string) =>
    strings.has(k) ? 'string' : hashes.has(k) ? 'hash' : zsets.has(k) ? 'zset' : 'none',
  expire: async (k: string, seconds: number) => {
    write();
    if (has(k)) ttl.set(k, Date.now() + seconds * 1000);
  },
  expireTime: async (k: string) => (!has(k) ? -2 : ttl.has(k) ? ttl.get(k)! / 1000 : -1),
  hSet: async (k: string, fields: Record<string, string>) => {
    write();
    for (const [f, v] of Object.entries(fields)) hash(k).set(f, v);
  },
  hGetAll: async (k: string) => Object.fromEntries(hashes.get(k) ?? []),
  hIncrBy: async (k: string, f: string, by: number) => {
    write();
    const n = Number(hash(k).get(f) ?? 0) + by;
    hash(k).set(f, String(n));
    return n;
  },
  hLen: async (k: string) => hashes.get(k)?.size ?? 0,
  hKeys: async (k: string) => [...(hashes.get(k)?.keys() ?? [])],
  hScan: async (k: string, _cursor: number, _pattern?: string, count = 10) => ({
    cursor: 0,
    fieldValues: [...(hashes.get(k) ?? [])]
      .slice(0, count)
      .map(([field, value]) => ({ field, value })),
  }),
  hDel: async (k: string, fields: string[]) => {
    write();
    for (const f of fields) hashes.get(k)?.delete(f);
  },
  zAdd: async (k: string, ...rows: Array<{ member: string; score: number }>) => {
    const z = zsets.get(k) ?? new Map<string, number>();
    for (const r of rows) z.set(r.member, r.score);
    zsets.set(k, z);
  },
  zCard: async (k: string) => zsets.get(k)?.size ?? 0,
  zRange: async (k: string, start: number, stop: number) =>
    ranked(k)
      .slice(start, stop + 1)
      .map(([member, score]) => ({ member, score })),
};

const context = { subredditName: 'stonefall' as string | undefined };
const moderators = new Set(['a_mod']);
const getModerators = vi.fn(({ username }: { username: string }) => ({
  all: async () => (moderators.has(username) ? [{ username }] : []),
}));

vi.mock('@devvit/web/server', () => ({ redis, context, reddit: { getModerators } }));

const { StorageDesk } = await import('./storageDesk');
const { STORAGE_LIMIT_BYTES } = await import('./storage');
const keys = await import('./keys');

const DAY = 86_400_000;
const NOW = Date.parse('2026-11-04T12:00:00Z');
const day = (back: number) => new Date(NOW - back * DAY).toISOString().slice(0, 10);

/** A map day with players who each have a plot of one placed run, a keep, a region and a cell. */
const seedMap = async (map: string, players: number) => {
  for (let i = 0; i < players; i++) {
    const u = `t2_p${i}`;
    const session = `${map}-run${i}`;
    await redis.zAdd(keys.plotIndexKey(map), { member: u, score: i });
    strings.set(
      keys.plotKey(map, u),
      JSON.stringify({ userId: u, placements: [{ sessionId: session, gridX: i, gridZ: 0 }] })
    );
    strings.set(keys.keepKey(map, u), 'k'.repeat(100));
    strings.set(keys.regionKey(map, u), String(i));
    strings.set(keys.regionOwnerKey(map, ...regionOf(i)), u);
    await redis.zAdd(keys.landIndexKey(map), { member: `${i},0`, score: i });
    strings.set(keys.cellKey(map, i, 0), 'c'.repeat(200));
    strings.set(keys.runKey(session), 'r'.repeat(4000));
    strings.set(keys.runSavedKey(session), '1');
    strings.set(keys.tookKey(map, session), '{}');
    hash(keys.userKey(u)).set('username', `player${i}`);
  }
  hash(keys.mapMetaKey(map)).set('postId', `t3_${map.replaceAll('-', '')}`);
  hash(keys.boardMetaKey(map)).set('pages', '2').set('gen', 'g1');
  strings.set(keys.boardPageKey(map, 0, 'g1'), 'b'.repeat(9000));
  strings.set(keys.boardPageKey(map, 1, 'g1'), 'b'.repeat(3000));
};

const { regionCoordForIndex } = await import('../../shared/types/worldGrid');
const regionOf = (i: number): [number, number] => {
  const { rx, rz } = regionCoordForIndex(i);
  return [rx, rz];
};

beforeEach(() => {
  strings.clear();
  hashes.clear();
  zsets.clear();
  ttl.clear();
  refuse = 'none';
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('probe', () => {
  it('sets a value for a minute and deletes it', async () => {
    const w = await StorageDesk.probe();
    expect(w).toMatchObject({ set: true, del: true, error: null, quota: false });
    expect(strings.has(keys.STORAGE_PROBE)).toBe(false);
  });

  it('tells a quota block apart, and whether deletes still go through', async () => {
    refuse = 'all';
    expect(await StorageDesk.probe()).toMatchObject({ set: false, del: false, quota: true });
    refuse = 'writes';
    expect(await StorageDesk.probe()).toMatchObject({ set: false, del: true, quota: true });
  });
});

describe('overview', () => {
  it('while blocked: writes nothing, and puts a floor on what it cannot see', async () => {
    strings.set(keys.MAP_CURRENT, JSON.stringify({ day: day(0) }));
    await seedMap(day(0), 5);
    refuse = 'all';
    const o = await StorageDesk.overview();
    expect(o.writes.quota).toBe(true);
    expect(hashes.has(keys.STORAGE_HISTORY)).toBe(false);
    expect(o.unseen?.atLeast).toBe(STORAGE_LIMIT_BYTES - o.bytes);
    // The board copies leaked up to 2 Nov go with that day's map, a fortnight on.
    expect(o.unseen?.goneBy).toBe('2026-11-16');
    expect(o.unseen?.note).toMatch(/board copies/);
    expect(o.subreddit).toBe('stonefall');
  });

  it('when writes go through: keeps the day in the history and infers nothing', async () => {
    const o = await StorageDesk.overview();
    expect(o.unseen).toBeNull();
    expect(o.writes.set).toBe(true);
    expect([...(hashes.get(keys.STORAGE_HISTORY)?.keys() ?? [])]).toEqual([day(0)]);
  });

  it('stops naming the leaked boards once their maps have expired', async () => {
    vi.setSystemTime(Date.parse('2026-11-20T00:00:00Z'));
    refuse = 'all';
    const o = await StorageDesk.overview();
    expect(o.unseen?.goneBy).toBeNull();
    expect(o.unseen?.note).toMatch(/no index points at/);
  });
});

describe('moderators', () => {
  it('asks Reddit once and remembers the answer for a while', async () => {
    getModerators.mockClear();
    expect(await StorageDesk.isModerator('a_mod')).toBe(true);
    expect(await StorageDesk.isModerator('a_mod')).toBe(true);
    expect(await StorageDesk.isModerator('a_player')).toBe(false);
    expect(getModerators).toHaveBeenCalledTimes(2);
    vi.setSystemTime(NOW + 10 * 60_000);
    await StorageDesk.isModerator('a_mod');
    expect(getModerators).toHaveBeenCalledTimes(3);
  });
});

describe('inspect', () => {
  it('reads a key whole: type, size, expiry, what it is and how it starts', async () => {
    strings.set(keys.MAP_CURRENT, JSON.stringify({ day: day(0) }));
    const pointer = await StorageDesk.inspect(keys.MAP_CURRENT);
    expect(pointer).toMatchObject({ type: 'string', exists: true, expiresAt: null });
    expect(pointer.meaning).toMatchObject({ family: 'Pointers', vital: true });
    expect(pointer.preview).toEqual({ kind: 'string', text: strings.get(keys.MAP_CURRENT) });

    hash(keys.userKey('t2_x')).set('username', 'x').set('best', '40');
    ttl.set(keys.userKey('t2_x'), NOW + 3 * DAY);
    const user = await StorageDesk.inspect(keys.userKey('t2_x'));
    expect(user).toMatchObject({ type: 'hash', length: 2, expiresAt: NOW + 3 * DAY });
    expect(user.meaning?.family).toBe('Player records');

    await redis.zAdd(keys.plotIndexKey(day(0)), { member: 't2_x', score: 1 });
    const index = await StorageDesk.inspect(keys.plotIndexKey(day(0)));
    expect(index.preview).toEqual({ kind: 'zset', members: [{ member: 't2_x', score: 1 }] });
    expect(index.meaning?.what).toMatch(/Everyone who built/);

    const gone = await StorageDesk.inspect('map:2026-11-01:plot:t2_nobody');
    expect(gone).toMatchObject({ exists: false, type: 'none' });
    expect(gone.meaning?.family).toBe('Plots, keeps and land');
  });

  it('shows only the start of a long value', async () => {
    strings.set(keys.runKey('s1'), 'r'.repeat(10_000));
    const run = await StorageDesk.inspect(keys.runKey('s1'));
    expect(run.truncated).toBe(true);
    expect(run.preview).toEqual({ kind: 'string', text: 'r'.repeat(4000) });
    expect(run.length).toBe(10_000);
  });
});

describe('listing', () => {
  it("finds every key a day's map holds, by kind, the biggest first", async () => {
    await seedMap(day(3), 4);
    const l = await StorageDesk.listing({ kind: 'map', day: day(3) });
    const labels = l.groups.map((g) => g.label);
    expect(labels[0]).toBe('Board');
    expect(labels).toEqual(
      expect.arrayContaining(['Plots', 'Keeps', 'Regions', 'Held land', 'Take and comment records'])
    );
    expect(l.rows[0]!.key).toBe(keys.boardPageKey(day(3), 0, 'g1'));
    expect(l.rows.every((r, i) => i === 0 || l.rows[i - 1]!.bytes >= r.bytes)).toBe(true);
    // Four players: plot, keep, region, region owner, cell, take record each; two pages; meta
    // twice; two indexes.
    expect(l.total).toBe(4 * 6 + 2 + 2 + 2);
    expect(l.note).toMatch(/4 runs stand on this map/);
  });
});

describe('act', () => {
  it('deletes and expires a key only when it is named again', async () => {
    strings.set('run:s1', 'x');
    expect(
      await StorageDesk.act({ kind: 'delete', key: 'run:s1', confirm: 'run:s2' }, 'a_mod')
    ).toMatchObject({ ok: false });
    expect(strings.has('run:s1')).toBe(true);

    const expiring = await StorageDesk.act(
      { kind: 'expire', key: 'run:s1', seconds: 3600, confirm: 'run:s1' },
      'a_mod'
    );
    expect(expiring).toMatchObject({ ok: true, message: 'run:s1 goes in 1 hour.' });
    expect(ttl.get('run:s1')).toBe(NOW + 3600_000);
    expect(
      await StorageDesk.act(
        { kind: 'expire', key: 'run:s1', seconds: 90 * 86_400, confirm: 'run:s1' },
        'a_mod'
      )
    ).toMatchObject({ ok: false });

    expect(
      await StorageDesk.act({ kind: 'delete', key: 'run:s1', confirm: 'run:s1' }, 'a_mod')
    ).toMatchObject({ ok: true, message: 'Deleted run:s1.' });
    expect(strings.has('run:s1')).toBe(false);
    expect(
      await StorageDesk.act({ kind: 'delete', key: 'run:s1', confirm: 'run:s1' }, 'a_mod')
    ).toMatchObject({ ok: true, message: 'It was already gone.' });
  });

  it('drops a closed day whole, its runs with it, and leaves player records', async () => {
    strings.set(keys.MAP_CURRENT, JSON.stringify({ day: day(0) }));
    await seedMap(day(0), 2);
    await seedMap(day(5), 3);

    expect(
      await StorageDesk.act({ kind: 'drop-map', day: day(5), confirm: 'not-it' }, 'a_mod')
    ).toMatchObject({ ok: false });
    expect(
      await StorageDesk.act({ kind: 'drop-map', day: day(0), confirm: 'StoneFall' }, 'a_mod')
    ).toMatchObject({ ok: false, message: expect.stringMatching(/being played/) });

    const r = await StorageDesk.act(
      { kind: 'drop-map', day: day(5), confirm: 'StoneFall' },
      'a_mod'
    );
    expect(r.ok).toBe(true);
    const left = [...strings.keys(), ...hashes.keys(), ...zsets.keys()];
    expect(left.filter((k) => k.includes(day(5)))).toEqual([]);
    expect(left).not.toContain(keys.runKey(`${day(5)}-run0`));
    // Today's map and its runs, and everyone's record, are untouched.
    expect(left).toContain(keys.plotKey(day(0), 't2_p0'));
    expect(left).toContain(keys.runKey(`${day(0)}-run0`));
    expect(left).toContain(keys.userKey('t2_p2'));
  });

  it('says plainly when Redis refuses for the quota', async () => {
    strings.set('run:s1', 'x');
    refuse = 'all';
    const r = await StorageDesk.act({ kind: 'delete', key: 'run:s1', confirm: 'run:s1' }, 'a_mod');
    expect(r).toMatchObject({ ok: false, message: expect.stringMatching(/blocked for the quota/) });
    expect((await StorageDesk.act({ kind: 'probe' }, 'a_mod')).writes?.quota).toBe(true);
  });
});
