import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Raising towers on a `factions` map, against an in-memory stand-in for Devvit's Redis: the first
 * player of a colour founds its keep, everyone after builds from it, allies stack on each other's
 * land and on the keep, and a rival who beats the best tower in a stack brings all of it down.
 * A map that stored no rules plays as it always did.
 */

const strings = new Map<string, string>();
const hashes = new Map<string, Map<string, string>>();
const zsets = new Map<string, Map<string, number>>();
/** Seconds each key has left, as it was last set; a key without one is kept forever. */
const ttls = new Map<string, number>();
const has = (k: string) => strings.has(k) || hashes.has(k) || zsets.has(k);
const drop = (k: string) => {
  strings.delete(k);
  hashes.delete(k);
  zsets.delete(k);
  ttls.delete(k);
};
const zset = (k: string) => {
  let z = zsets.get(k);
  if (!z) zsets.set(k, (z = new Map()));
  return z;
};
const ranked = (k: string) =>
  [...(zsets.get(k) ?? new Map<string, number>())].sort((a, b) => a[1] - b[1]);

const redis = {
  get: async (k: string) => strings.get(k),
  set: async (k: string, v: string, o?: { nx?: boolean; expiration?: Date }) => {
    if (o?.nx && has(k)) return;
    strings.set(k, v);
    if (o?.expiration) ttls.set(k, Math.round((o.expiration.getTime() - Date.now()) / 1000));
    else ttls.delete(k);
  },
  del: async (...keys: string[]) => keys.forEach(drop),
  exists: async (...keys: string[]) => keys.filter(has).length,
  expire: async (k: string, seconds: number) => {
    if (has(k)) ttls.set(k, seconds);
  },
  incrBy: async (k: string, n: number) => {
    const v = Number(strings.get(k) ?? 0) + n;
    strings.set(k, String(v));
    return v;
  },
  mGet: async (keys: string[]) => keys.map((k) => strings.get(k) ?? null),
  hSet: async (k: string, fields: Record<string, string>) => {
    const h = hashes.get(k) ?? new Map<string, string>();
    for (const [f, v] of Object.entries(fields)) h.set(f, v);
    hashes.set(k, h);
  },
  hGet: async (k: string, f: string) => hashes.get(k)?.get(f),
  hIncrBy: async (k: string, f: string, n: number) => {
    const h = hashes.get(k) ?? new Map<string, string>();
    const v = Number(h.get(f) ?? 0) + n;
    h.set(f, String(v));
    hashes.set(k, h);
    return v;
  },
  hGetAll: async (k: string) => Object.fromEntries(hashes.get(k) ?? []),
  zAdd: async (k: string, ...rows: Array<{ member: string; score: number }>) => {
    for (const r of rows) zset(k).set(r.member, r.score);
  },
  zRange: async (k: string, start: number, stop: number, o?: { reverse?: boolean }) => {
    const rows = ranked(k);
    if (o?.reverse) rows.reverse();
    return rows.slice(start, stop + 1).map(([member, score]) => ({ member, score }));
  },
  zRem: async (k: string, members: string[]) => {
    for (const m of members) zsets.get(k)?.delete(m);
  },
  zRemRangeByRank: async () => {},
  /** No other writer here, so a transaction is just its commands, run at exec. */
  watch: async () => {
    const queued: Array<() => Promise<unknown>> = [];
    const tx = {
      multi: async () => {},
      unwatch: async () => {},
      exec: async () => {
        for (const run of queued) await run();
      },
      set: async (k: string, v: string) => void queued.push(() => redis.set(k, v)),
      del: async (k: string) => void queued.push(() => redis.del(k)),
      zAdd: async (k: string, row: { member: string; score: number }) =>
        void queued.push(() => redis.zAdd(k, row)),
      zRem: async (k: string, members: string[]) => void queued.push(() => redis.zRem(k, members)),
    };
    return tx;
  },
};

vi.mock('@devvit/web/server', () => ({ redis, context: {}, reddit: {}, realtime: {} }));

/** Runs as the server stored them: who built each, its score, its colour. */
const runs = new Map<string, Record<string, unknown>>();
vi.mock('./runs', () => ({
  Runs: {
    get: async (id: string) => runs.get(id) ?? null,
    getMany: async (ids: readonly string[]) => ids.map((id) => runs.get(id) ?? null),
  },
}));

/** The board's tower cap, lowered by a test to see what lies past it. */
let towerCap: number | null = null;
vi.mock('./keys', async (original) => {
  const keys = await original<typeof import('./keys')>();
  return {
    ...keys,
    get BOARD_MAX_TOWERS() {
      return towerCap ?? keys.BOARD_MAX_TOWERS;
    },
  };
});

const { Plots, towersOn } = await import('./plots');
const { mapMetaKey, userKey } = await import('./keys');
const { regionCenterCell } = await import('../../shared/types/worldGrid');

const DAY = '2026-10-12';

const player = (userId: string, faction: string) =>
  redis.hSet(userKey(userId), { faction, chosen: '1' });

let serial = 0;
const runBy = (userId: string, score: number, faction: string): string => {
  const sessionId = `run-${++serial}`;
  runs.set(sessionId, {
    sessionId,
    userId,
    username: userId,
    score,
    blockCount: 10,
    perfectCount: 0,
    maxCombo: 0,
    seed: 1,
    gameMode: 'rotating_block',
    faction,
    towerBlocks: [],
    height: 1000,
    createdAt: serial,
  });
  return sessionId;
};

const raise = (userId: string, faction: string, score: number, x: number, z: number) =>
  Plots.raise(DAY, userId, userId, runBy(userId, score, faction), x, z);

beforeEach(async () => {
  strings.clear();
  hashes.clear();
  zsets.clear();
  ttls.clear();
  runs.clear();
  towerCap = null;
  await redis.hSet(mapMetaKey(DAY), { keepRadius: '0', rules: 'factions' });
});

describe('a factions map', () => {
  it("founds one keep per colour and builds every newcomer from their colour's", async () => {
    await player('ann', 'cyan');
    await player('bob', 'rose');
    await player('cat', 'cyan');
    const cyan = await Plots.getOrAssignRegion(DAY, 'ann', 'ann');
    const rose = await Plots.getOrAssignRegion(DAY, 'bob', 'bob');
    const mate = await Plots.getOrAssignRegion(DAY, 'cat', 'cat');
    expect(cyan).toEqual({ rx: 0, rz: 0 });
    expect(rose).not.toEqual(cyan);
    expect(mate).toEqual(cyan);
    expect(await Plots.getRegion(DAY, 'cat')).toEqual(cyan);
  });

  it("stacks allies on the colour's keep, whoever founded it", async () => {
    await player('ann', 'cyan');
    await player('cat', 'cyan');
    const keep = regionCenterCell(await Plots.getOrAssignRegion(DAY, 'ann', 'ann'));
    expect(await raise('ann', 'cyan', 100, keep.x, keep.z)).toMatchObject({
      ok: true,
      kind: 'keep',
    });
    const second = await raise('cat', 'cyan', 50, keep.x, keep.z);
    expect(second).toMatchObject({ ok: true, kind: 'keep' });
    if (second.ok) expect(second.grid.placements[0]!.stackIndex).toBe(1);
    const { towers } = await Plots.rebuildBoard(DAY);
    const bases = towers.map((t) => [t.userId, t.stackBaseY ?? 0]);
    expect(bases).toEqual([
      ['ann', 0],
      ['cat', 1000],
    ]);
  });

  it("refuses another colour's keep", async () => {
    await player('ann', 'cyan');
    await player('bob', 'rose');
    const keep = regionCenterCell(await Plots.getOrAssignRegion(DAY, 'ann', 'ann'));
    await raise('ann', 'cyan', 100, keep.x, keep.z);
    expect(await raise('bob', 'rose', 900, keep.x, keep.z)).toMatchObject({ ok: false });
  });

  it("stacks on an ally's land instead of toppling it, and the best tower sets the bar", async () => {
    await player('ann', 'cyan');
    await player('cat', 'cyan');
    await Plots.getOrAssignRegion(DAY, 'ann', 'ann');
    expect(await raise('ann', 'cyan', 300, 2, 0)).toMatchObject({ ok: true, kind: 'claim' });
    // A lower score still stacks: a colour's ground never comes down from inside.
    expect(await raise('cat', 'cyan', 100, 2, 0)).toMatchObject({ ok: true, kind: 'stack' });
    expect(await raise('cat', 'cyan', 800, 2, 0)).toMatchObject({ ok: true, kind: 'stack' });
    const hold = await Plots.getHold(DAY, 2, 0);
    expect(hold).toMatchObject({ userId: 'cat', score: 800, stack: 3 });
    expect(towersOn(hold!).map((t) => t.score)).toEqual([300, 100, 800]);
    const { towers } = await Plots.rebuildBoard(DAY);
    expect(towers.map((t) => t.stackBaseY ?? 0)).toEqual([0, 1000, 2000]);
  });

  it('brings a whole stack down when a rival beats its best tower', async () => {
    await player('ann', 'cyan');
    await player('cat', 'cyan');
    await player('bob', 'rose');
    await Plots.getOrAssignRegion(DAY, 'ann', 'ann');
    await raise('ann', 'cyan', 300, 2, 0);
    await raise('cat', 'cyan', 800, 2, 0);
    // Bob's colour reaches the cell from its own claim next door.
    await Plots.getOrAssignRegion(DAY, 'bob', 'bob');
    const ground = { x: 3, z: 0 };
    await redis.set(
      `map:${DAY}:cell:${ground.x},${ground.z}`,
      JSON.stringify({
        ...ground,
        userId: 'bob',
        username: 'bob',
        faction: 'rose',
        score: 1,
        sessionId: runBy('bob', 1, 'rose'),
        placedAt: 1,
      })
    );
    await redis.zAdd(`map:${DAY}:index:land`, { member: '3,0', score: 1 });

    expect(await raise('bob', 'rose', 800, 2, 0)).toMatchObject({ ok: false, bar: 800 });
    const take = await raise('bob', 'rose', 801, 2, 0);
    expect(take).toMatchObject({
      ok: true,
      kind: 'take',
      took: { userId: 'cat', score: 800 },
      toppled: ['ann', 'cat'],
    });
    expect(towersOn((await Plots.getHold(DAY, 2, 0))!).map((t) => t.userId)).toEqual(['bob']);
    expect((await Plots.getPlot(DAY, 'ann'))!.placements).toHaveLength(0);
    expect((await Plots.getPlot(DAY, 'cat'))!.placements).toHaveLength(0);
  });

  it('hands the cell to the best of the rest when a tower is taken off a stack', async () => {
    await player('ann', 'cyan');
    await player('cat', 'cyan');
    await Plots.getOrAssignRegion(DAY, 'ann', 'ann');
    await raise('ann', 'cyan', 300, 2, 0);
    const top = await raise('cat', 'cyan', 800, 2, 0);
    if (!top.ok) throw new Error('stack refused');
    await Plots.remove(DAY, 'cat', top.grid.placements[0]!.sessionId);
    expect(await Plots.getHold(DAY, 2, 0)).toMatchObject({ userId: 'ann', score: 300 });
    expect((await Plots.getHold(DAY, 2, 0))!.stack).toBeUndefined();
    // Switching colour takes the last one down, and the cell is open again.
    await Plots.raze(DAY, 'ann');
    expect(await Plots.getHold(DAY, 2, 0)).toBeNull();
  });

  it('builds on where the road ran and on the centre of a plot nobody keeps', async () => {
    await player('ann', 'cyan');
    await Plots.getOrAssignRegion(DAY, 'ann', 'ann');
    for (const x of [2, 4, 6]) {
      expect(await raise('ann', 'cyan', 100, x, 0)).toMatchObject({ ok: true, kind: 'claim' });
    }
    const next = regionCenterCell({ rx: 1, rz: 0 });
    expect(await raise('ann', 'cyan', 100, next.x, next.z)).toMatchObject({
      ok: true,
      kind: 'claim',
    });
  });

  it("founds a late colour's keep past plots already built on", async () => {
    await player('ann', 'cyan');
    await player('bob', 'rose');
    await Plots.getOrAssignRegion(DAY, 'ann', 'ann');
    // Cyan's ground reaches the next plot's centre before rose arrives.
    for (const x of [2, 4, 6]) await raise('ann', 'cyan', 100, x, 0);
    const rose = await Plots.getOrAssignRegion(DAY, 'bob', 'bob');
    expect(rose).not.toEqual({ rx: 1, rz: 0 });
    expect(await Plots.isClear(DAY, rose, 2)).toBe(true);
  });

  it('keeps a founded keep from a rival before anybody of its colour has built', async () => {
    await player('ann', 'cyan');
    await player('bob', 'rose');
    await Plots.getOrAssignRegion(DAY, 'ann', 'ann');
    // Bob's run is under way: rose's keep is founded and nothing stands on the map for it.
    const keep = regionCenterCell(await Plots.getOrAssignRegion(DAY, 'bob', 'bob'));
    expect(keep).toEqual(regionCenterCell({ rx: 1, rz: 0 }));
    for (const x of [2, 4, 6]) await raise('ann', 'cyan', 100, x, 0);
    expect(await raise('ann', 'cyan', 900, keep.x, keep.z)).toMatchObject({
      ok: false,
      reason: "That is Rose's keep.",
    });
    expect(await raise('bob', 'rose', 50, keep.x, keep.z)).toMatchObject({
      ok: true,
      kind: 'keep',
    });
  });

  it("moves a player who switches colour to the new colour's keep", async () => {
    await player('ann', 'cyan');
    await player('bob', 'rose');
    const cyan = await Plots.getOrAssignRegion(DAY, 'ann', 'ann');
    const rose = await Plots.getOrAssignRegion(DAY, 'bob', 'bob');
    await player('ann', 'rose');
    await Plots.recolourKeep(DAY, 'ann', 'ann', 'rose');
    expect(await Plots.getRegion(DAY, 'ann')).toEqual(rose);
    expect(await Plots.colourKeep(DAY, 'cyan')).toEqual(cyan);
  });
});

describe('a board past its caps', () => {
  it('draws what fits and counts everything that stands', async () => {
    await player('ann', 'cyan');
    await player('bob', 'rose');
    await player('cat', 'cyan');
    const cyan = regionCenterCell(await Plots.getOrAssignRegion(DAY, 'ann', 'ann'));
    const rose = regionCenterCell(await Plots.getOrAssignRegion(DAY, 'bob', 'bob'));
    await Plots.getOrAssignRegion(DAY, 'cat', 'cat');
    await raise('ann', 'cyan', 100, cyan.x, cyan.z);
    await raise('cat', 'cyan', 200, cyan.x, cyan.z);
    await raise('bob', 'rose', 300, rose.x, rose.z);
    await raise('ann', 'cyan', 400, cyan.x + 2, cyan.z);
    await raise('cat', 'cyan', 500, cyan.x + 2, cyan.z);
    towerCap = 2;
    await Plots.invalidateBoard(DAY);
    const board = await Plots.board(DAY);
    expect(board.towers).toHaveLength(2);
    expect(board).toMatchObject({ total: 5, builders: 3 });
    // Served again from its pages, the board keeps its counts.
    expect(await Plots.board(DAY)).toMatchObject({ total: 5, builders: 3 });
    expect(await Plots.standings(DAY)).toMatchObject({ towers: 5, builders: 3 });
  });
});

describe('rebuilding the board', () => {
  it('stays stale when a tower goes up during a rebuild', async () => {
    await player('ann', 'cyan');
    const keep = regionCenterCell(await Plots.getOrAssignRegion(DAY, 'ann', 'ann'));
    await raise('ann', 'cyan', 100, keep.x, keep.z);
    const rebuilding = Plots.rebuildBoard(DAY);
    // The placement lands after the rebuild has read the version, before it has written.
    await Plots.invalidateBoard(DAY);
    await rebuilding;
    expect(await Plots.isBoardFresh(DAY)).toBe(false);
    await Plots.board(DAY);
    expect(await Plots.isBoardFresh(DAY)).toBe(true);
  });

  it("waits for another request's rebuild and takes it, rather than running its own", async () => {
    await player('ann', 'cyan');
    const keep = regionCenterCell(await Plots.getOrAssignRegion(DAY, 'ann', 'ann'));
    await raise('ann', 'cyan', 100, keep.x, keep.z);
    const lock = `map:${DAY}:board:building`;
    await redis.set(lock, 'someone else');
    const reading = Plots.board(DAY);
    // The other request finishes its rebuild and lets go.
    const built = await Plots.rebuildBoard(DAY);
    await redis.del(lock);
    const rebuild = vi.spyOn(Plots, 'rebuildBoard');
    const board = await reading;
    expect(rebuild).not.toHaveBeenCalled();
    expect(board.towers).toEqual(built.towers);
    rebuild.mockRestore();
  });

  it('pages a large board and leaves no old pages behind for long', async () => {
    await player('ann', 'cyan');
    const keep = regionCenterCell(await Plots.getOrAssignRegion(DAY, 'ann', 'ann'));
    await raise('ann', 'cyan', 100, keep.x, keep.z);
    await Plots.board(DAY);
    const first = hashes.get(`map:${DAY}:board:meta`)!.get('gen');
    await raise('ann', 'cyan', 200, keep.x, keep.z);
    const { towers } = await Plots.board(DAY);
    const meta = hashes.get(`map:${DAY}:board:meta`)!;
    expect(meta.get('gen')).not.toBe(first);
    expect(meta.get('pages')).toBe('1');
    expect(towers.map((t) => t.score)).toEqual([100, 200]);
  });

  /**
   * Board pages the board does not point at that will still be stored in a few minutes. Their
   * names carry a random generation and nothing lists keys, so these could never be deleted.
   */
  const lingering = () => {
    const gen = hashes.get(`map:${DAY}:board:meta`)?.get('gen');
    return [...strings.keys()].filter(
      (k) =>
        k.startsWith(`map:${DAY}:board:page:`) &&
        !k.startsWith(`map:${DAY}:board:page:${gen}:`) &&
        (ttls.get(k) ?? Infinity) > 300
    );
  };
  const pageKeys = () => [...strings.keys()].filter((k) => k.includes(':board:page:'));

  it('leaves no pages to outlive a rebuild that dies before the board points at them', async () => {
    await player('ann', 'cyan');
    const keep = regionCenterCell(await Plots.getOrAssignRegion(DAY, 'ann', 'ann'));
    await raise('ann', 'cyan', 100, keep.x, keep.z);
    await Plots.board(DAY);
    await raise('ann', 'cyan', 200, keep.x, keep.z);
    const meta = `map:${DAY}:board:meta`;
    const hSet = redis.hSet;
    const dying = vi.spyOn(redis, 'hSet').mockImplementation(async (k, fields) => {
      if (k === meta && 'gen' in fields) throw new Error('request timed out');
      return hSet(k, fields);
    });
    await expect(Plots.board(DAY)).rejects.toThrow('request timed out');
    dying.mockRestore();
    expect(lingering()).toEqual([]);
    // The next look builds it again.
    expect((await Plots.board(DAY)).towers.map((t) => t.score)).toEqual([100, 200]);
    expect(lingering()).toEqual([]);
  });

  it('builds the board for itself after waiting too long on a rebuild, and stores none of it', async () => {
    await player('ann', 'cyan');
    const keep = regionCenterCell(await Plots.getOrAssignRegion(DAY, 'ann', 'ann'));
    await raise('ann', 'cyan', 100, keep.x, keep.z);
    await redis.set(`map:${DAY}:board:building`, 'a rebuild that hung');
    vi.useFakeTimers();
    try {
      const reading = Plots.board(DAY);
      await vi.advanceTimersByTimeAsync(13_000);
      expect((await reading).towers.map((t) => t.score)).toEqual([100]);
    } finally {
      vi.useRealTimers();
    }
    // Only the request holding the rebuild writes the board, so two never race to point at theirs.
    expect(pageKeys()).toEqual([]);
  });

  it('leaves the hourly rebuild to a request that is already rebuilding', async () => {
    await player('ann', 'cyan');
    const keep = regionCenterCell(await Plots.getOrAssignRegion(DAY, 'ann', 'ann'));
    await raise('ann', 'cyan', 100, keep.x, keep.z);
    const lock = `map:${DAY}:board:building`;
    await redis.set(lock, 'a request');
    expect(await Plots.refreshBoard(DAY)).toBeNull();
    expect(pageKeys()).toEqual([]);
    await redis.del(lock);
    expect((await Plots.refreshBoard(DAY))?.towers.map((t) => t.score)).toEqual([100]);
    expect(strings.has(lock)).toBe(false);
    expect(lingering()).toEqual([]);
  });
});

describe('a map that stored no rules', () => {
  it('hands every player a plot of their own, and lets an ally take land by beating it', async () => {
    await redis.hSet(mapMetaKey(DAY), { rules: '' });
    hashes.get(mapMetaKey(DAY))!.delete('rules');
    await player('ann', 'cyan');
    await player('cat', 'cyan');
    const mine = await Plots.getOrAssignRegion(DAY, 'ann', 'ann');
    const theirs = await Plots.getOrAssignRegion(DAY, 'cat', 'cat');
    expect(theirs).not.toEqual(mine);
    await raise('ann', 'cyan', 300, 2, 0);
    expect(await raise('cat', 'cyan', 200, 2, 0)).toMatchObject({ ok: false, bar: 300 });
    expect(await raise('cat', 'cyan', 400, 2, 0)).toMatchObject({ ok: true, kind: 'take' });
  });
});
