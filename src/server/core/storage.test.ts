import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The storage report against an in-memory stand-in for Devvit's Redis: what it counts exactly,
 * what it samples and multiplies, what it reads from the tallies and stretches while they are
 * young, and the form a moderator sees.
 */

const strings = new Map<string, string>();
const hashes = new Map<string, Map<string, string>>();
const zsets = new Map<string, Map<string, number>>();
const ttl = new Map<string, number>();

const has = (k: string) => strings.has(k) || hashes.has(k) || zsets.has(k);
const hash = (k: string) => {
  let h = hashes.get(k);
  if (!h) hashes.set(k, (h = new Map()));
  return h;
};
const ranked = (k: string) =>
  [...(zsets.get(k) ?? new Map<string, number>())].sort((a, b) => a[1] - b[1]);

const redis = {
  get: async (k: string) => strings.get(k),
  set: async (k: string, v: string, o?: { nx?: boolean }) => {
    if (o?.nx && has(k)) return;
    strings.set(k, v);
  },
  mGet: async (keys: string[]) => keys.map((k) => strings.get(k) ?? null),
  strLen: async (k: string) => strings.get(k)?.length ?? 0,
  expire: async (k: string, seconds: number) => {
    if (has(k)) ttl.set(k, Date.now() + seconds * 1000);
  },
  hSet: async (k: string, fields: Record<string, string>) => {
    for (const [f, v] of Object.entries(fields)) hash(k).set(f, v);
  },
  hGetAll: async (k: string) => Object.fromEntries(hashes.get(k) ?? []),
  hIncrBy: async (k: string, f: string, by: number) => {
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

vi.mock('@devvit/web/server', () => ({ redis }));

const { Storage, STORAGE_LIMIT_BYTES } = await import('./storage');
const keys = await import('./keys');

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-28T12:00:00Z');
const day = (back: number) => new Date(NOW - back * DAY).toISOString().slice(0, 10);

/** A map day with `players` players, each with a plot, keep and region, and one cell each. */
const seedMap = async (map: string, players: number, plotLength = 500) => {
  for (let i = 0; i < players; i++) {
    const u = `t2_p${i}`;
    await redis.zAdd(keys.plotIndexKey(map), { member: u, score: i });
    strings.set(keys.plotKey(map, u), 'p'.repeat(plotLength));
    strings.set(keys.keepKey(map, u), 'k'.repeat(100));
    strings.set(keys.regionKey(map, u), String(i));
    await redis.zAdd(keys.landIndexKey(map), { member: `${i},0`, score: i });
    strings.set(keys.cellKey(map, i, 0), 'c'.repeat(200));
    await redis.hSet(keys.userKey(u), { username: `player${i}`, runs: '3' });
  }
  await redis.hSet(keys.mapMetaKey(map), { postId: `t3_${map}` });
};

const family = (report: Awaited<ReturnType<typeof Storage.report>>, label: string) =>
  report.families.find((f) => f.label === label)!;

beforeEach(() => {
  strings.clear();
  hashes.clear();
  zsets.clear();
  ttl.clear();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('tally', () => {
  it('adds up keys and bytes per family and day, and starts the clocks once', async () => {
    await Storage.tally('runs', 2, 3000);
    await Storage.tally('runs', 2, 1000);
    await Storage.tally('players', 1, 0, day(1));
    vi.setSystemTime(NOW + 60_000);
    await Storage.tally('comments', 1, 40);

    expect(await redis.hGetAll(keys.storageTallyKey(day(0)))).toEqual({
      'runs:n': '4',
      'runs:b': '4000',
      'comments:n': '1',
      'comments:b': '40',
    });
    expect(await redis.hGetAll(keys.storageTallyKey(day(1)))).toEqual({ 'players:n': '1' });
    expect(ttl.get(keys.storageTallyKey(day(0)))).toBe(
      NOW + 60_000 + keys.STORAGE_TALLY_TTL_SECONDS * 1000
    );
    // The first tally on the install marks when counting began, and later ones leave it.
    expect(strings.get(keys.STORAGE_TALLY_SINCE)).toBe(String(NOW));
  });

  it('never fails the write it counts', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const original = redis.hIncrBy;
    redis.hIncrBy = async () => {
      throw new Error('quota');
    };
    await expect(Storage.tally('runs', 1, 10)).resolves.toBeUndefined();
    redis.hIncrBy = original;
    spy.mockRestore();
  });
});

describe('report', () => {
  it('reports an empty install without inventing room', async () => {
    const report = await Storage.report(NOW);
    expect(report.dailyPlayers).toBe(0);
    expect(report.capacity).toBeNull();
    expect(family(report, 'Runs').note).toMatch(/none yet/);
    const form = Storage.form(report, []);
    expect(JSON.stringify(form)).toContain('None yet');
  });

  it('sums the runs alive from the tallies, the oldest day only in part', async () => {
    strings.set(keys.STORAGE_TALLY_SINCE, String(NOW - 40 * DAY));
    for (let back = 0; back <= 31; back++) {
      await redis.hSet(keys.storageTallyKey(day(back)), { 'runs:n': '10', 'runs:b': '30000' });
    }
    const runs = family(await Storage.report(NOW), 'Runs');
    // Days 0 to 29 whole, day 30 for the half of it not yet expired, day 31 gone.
    expect(runs.keys).toBe(305);
    expect(runs.bytes).toBe(30.5 * 30000 + 305 * 64);
    expect(runs.note).toBeUndefined();
  });

  it('stretches a young tally to the whole of the keys’ life, and says so', async () => {
    strings.set(keys.STORAGE_TALLY_SINCE, String(NOW - DAY / 4));
    await redis.hSet(keys.storageTallyKey(day(0)), { 'runs:n': '2', 'runs:b': '6000' });
    const runs = family(await Storage.report(NOW), 'Runs');
    expect(runs.keys).toBe(240);
    expect(runs.note).toMatch(/6 hours/);
  });

  it('samples the big families and multiplies, and works out the room', async () => {
    strings.set(keys.MAP_CURRENT, JSON.stringify({ day: day(0) }));
    strings.set(keys.STORAGE_TALLY_SINCE, String(NOW - 40 * DAY));
    await seedMap(day(0), 50);
    await seedMap(day(1), 100);
    await seedMap(day(2), 60);

    const report = await Storage.report(NOW);
    const maps = family(report, 'Plots, keeps and land');
    // Every plot is 500 long, so a sample of forty sizes all 210 of them.
    const plots = 210 * (keys.plotKey(day(1), 't2_p0').length + 500 + 64);
    expect(maps.bytes).toBeGreaterThan(plots);
    expect(family(report, 'Player records').keys).toBe(100);
    // The two complete days, not the live one.
    expect(report.dailyPlayers).toBe(80);
    expect(report.capacity).toBe(
      Math.floor(
        (STORAGE_LIMIT_BYTES -
          report.families.filter((f) => !f.scales).reduce((n, f) => n + f.bytes, 0)) /
          report.perPlayer
      )
    );
    expect(report.largest?.label).toBe('A plot, Oct 28');
  });

  it('takes the player count past the plot index cap from the tally', async () => {
    strings.set(keys.MAP_CURRENT, JSON.stringify({ day: day(0) }));
    await seedMap(day(1), 30);
    await redis.hSet(keys.storageTallyKey(day(1)), { 'players:n': '45' });
    expect((await Storage.report(NOW)).dailyPlayers).toBe(45);
  });

  it('measures the relay posts the history found, and sizes the ones it missed alike', async () => {
    strings.set(keys.MAP_CURRENT, JSON.stringify({ day: day(0) }));
    for (let back = 0; back < 4; back++) await seedMap(day(back), 5);
    const relay = (postId: string, d: string) => {
      strings.set(keys.relayMetaKey(postId), JSON.stringify({ postId, day: d, closed: false }));
      strings.set(keys.relayTowerCountKey(postId), '2');
      strings.set(keys.relayTowerKey(postId, 1), 't'.repeat(1000));
      strings.set(keys.relayTowerKey(postId, 2), 't'.repeat(3000));
      hash(keys.relayPlayersKey(postId)).set('t2_r1', 'r'.repeat(200));
    };
    relay('t3_today', day(0));
    relay('t3_before', day(1));
    strings.set(keys.RELAY_CURRENT, 't3_today');
    await redis.hSet(keys.STORAGE_HISTORY, {
      [day(1)]: JSON.stringify({ bytes: 1, keys: 1, players: 5, relay: 't3_before' }),
    });

    const report = await Storage.report(NOW);
    const towers = family(report, 'Relay towers');
    expect(towers.note).toMatch(/Found 2 of 4/);
    expect(towers.bytes).toBeGreaterThan(4 * 4000);
    expect(family(report, 'Player records').keys).toBe(6);
  });
});

describe('history and form', () => {
  it('keeps one entry a day for ninety days and shows the trend from it', async () => {
    await redis.hSet(keys.STORAGE_HISTORY, {
      [day(120)]: JSON.stringify({ bytes: 1, keys: 1, players: 1, relay: null }),
      [day(7)]: JSON.stringify({ bytes: 1_000_000, keys: 10, players: 5, relay: null }),
      [day(1)]: JSON.stringify({ bytes: 7_000_000, keys: 70, players: 5, relay: null }),
    });
    const report = { ...(await Storage.report(NOW)), bytes: 8_000_000 };
    const history = await Storage.history();
    await Storage.remember(report);

    expect(await redis.hKeys(keys.STORAGE_HISTORY)).toEqual([day(7), day(1), day(0)]);
    const form = JSON.stringify(Storage.form(report, history));
    expect(form).toContain('7 MB');
    expect(form).toContain('+1 MB a day since');
    expect(form).toContain('8 MB of the 5 GB');
  });
});
