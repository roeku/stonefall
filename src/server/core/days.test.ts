import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Which day a post shows, against an in-memory stand-in for Devvit's Redis: an older post opens on
 * its own day as it ended while that day is stored, and everything that plays is today's.
 */

const strings = new Map<string, string>();
const hashes = new Map<string, Map<string, string>>();
const has = (k: string) => strings.has(k) || hashes.has(k);

const redis = {
  get: async (k: string) => strings.get(k),
  set: async (k: string, v: string, o?: { nx?: boolean }) => {
    if (o?.nx && has(k)) return;
    strings.set(k, v);
  },
  exists: async (...keys: string[]) => keys.filter(has).length,
  expire: async () => {},
  hSet: async (k: string, fields: Record<string, string>) => {
    const h = hashes.get(k) ?? new Map<string, string>();
    for (const [f, v] of Object.entries(fields)) h.set(f, v);
    hashes.set(k, h);
  },
  hGetAll: async (k: string) => Object.fromEntries(hashes.get(k) ?? []),
};

/** The post the request came from, as Devvit hands it over. Set per test. */
const context: { postId?: string; postData?: Record<string, unknown> } = {};

vi.mock('@devvit/web/server', () => ({ redis, context, reddit: {}, realtime: {} }));

const { Maps } = await import('./maps');
const { Relay } = await import('./relay');
const { MAP_CURRENT, RELAY_CURRENT, mapMetaKey, relayMetaKey } = await import('./keys');

const TODAY = '2026-09-26';
const TUESDAY = '2026-09-22';

beforeEach(() => {
  strings.clear();
  hashes.clear();
  strings.set(MAP_CURRENT, JSON.stringify({ day: TODAY, postId: 't3_today', openedAt: 1 }));
  delete context.postId;
  delete context.postData;
});

const mapPost = (day: string) => {
  context.postId = `t3_${day}`;
  context.postData = { kind: 'map', day };
};

describe('a map post', () => {
  it('opens on its own day once that day is over, and builds on today', async () => {
    await redis.hSet(mapMetaKey(TUESDAY), { postId: `t3_${TUESDAY}`, openedAt: '1' });
    mapPost(TUESDAY);
    expect(await Maps.forView('post')).toMatchObject({
      day: TUESDAY,
      live: false,
      postDay: TUESDAY,
      todayPostId: 't3_today',
    });
    expect(await Maps.forView('live')).toMatchObject({ day: TODAY, live: true });
    expect(await Maps.forRequest()).toMatchObject({ day: TODAY, live: true });
  });

  it("is today's map when it is today's post", async () => {
    await redis.hSet(mapMetaKey(TODAY), { postId: 't3_today', openedAt: '1' });
    mapPost(TODAY);
    expect(await Maps.forView('post')).toMatchObject({ day: TODAY, live: true });
  });

  it("shows today's once its own day has expired, and still knows when it went up", async () => {
    mapPost(TUESDAY);
    expect(await Maps.forView('post')).toMatchObject({ day: TODAY, live: true, postDay: TUESDAY });
  });

  it("shows today's when it carries no day, as posts from before daily maps do", async () => {
    context.postId = 't3_old';
    expect(await Maps.forView('post')).toMatchObject({ day: TODAY, live: true, postDay: null });
  });
});

describe('a relay post', () => {
  const relay = (postId: string, day: string, closed: boolean) =>
    redis.set(
      relayMetaKey(postId),
      JSON.stringify({ postId, day, towers: 1, closed, createdAt: 1 })
    );

  beforeEach(async () => {
    strings.set(RELAY_CURRENT, 't3_relay_today');
    await relay('t3_relay_today', TODAY, false);
  });

  it('opens on its own towers once its day has topped out', async () => {
    await relay('t3_relay_tue', TUESDAY, true);
    expect(await Relay.shownFor('t3_relay_tue')).toBe('t3_relay_tue');
  });

  it("is today's relay when it is today's post", async () => {
    expect(await Relay.shownFor('t3_relay_today')).toBe('t3_relay_today');
  });

  it("shows today's once its own towers have expired", async () => {
    expect(await Relay.shownFor('t3_relay_tue')).toBe('t3_relay_today');
  });
});
