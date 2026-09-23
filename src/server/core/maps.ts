import { context, reddit, redis } from '@devvit/web/server';
import type { MapInfo } from '../../shared/types/api';
import { factionName } from '../../shared/types/factions';
import { LEGACY_MAP, MAP_CURRENT, mapMetaKey, mapOpenLockKey } from './keys';
import { Plots, mapExpiry } from './plots';

/**
 * The daily map.
 *
 * One post per day, and each post is its own board: a map opens empty, fills with whoever plays
 * that day, and closes when the next day's post goes up. Yesterday's post stays readable -- the
 * standings it closed on, every tower where it stood -- and sends people to today's. The daily
 * job opens the map and the relay together, so the two posts always come in a pair.
 *
 * The map a request is about comes from the post it was made in: a daily post carries its day
 * in `postData`. Posts from before daily maps carry none and always show today's, so an old
 * link is never a dead end.
 */

export const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** "Wednesday 23 September", the way a post title says a day. */
export const dayLabel = (day: string): string =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });

export interface CurrentMap {
  day: string;
  postId: string | null;
  openedAt: number;
}

export const Maps = {
  async current(): Promise<CurrentMap | null> {
    const raw = await redis.get(MAP_CURRENT);
    if (!raw) return null;
    try {
      const c = JSON.parse(raw) as Partial<CurrentMap>;
      return isDay(c.day)
        ? {
            day: c.day,
            postId: typeof c.postId === 'string' ? c.postId : null,
            openedAt: Number(c.openedAt) || 0,
          }
        : null;
    } catch {
      return null;
    }
  },

  /** The day being played. Before the first daily post exists, that is simply today. */
  async liveDay(): Promise<string> {
    return (await this.current())?.day ?? dayOf(Date.now());
  },

  /** Today's map post, for links from the relay. Falls back to the one map post of old. */
  async todayPostId(): Promise<string | null> {
    return (await this.current())?.postId ?? (await redis.get(LEGACY_MAP.MAP_POST)) ?? null;
  },

  /** Which map this request is about, and whether it is still being played. */
  async forRequest(): Promise<MapInfo> {
    const current = await this.current();
    const live = current?.day ?? dayOf(Date.now());
    const data = context.postData as { kind?: unknown; day?: unknown } | undefined;
    const day = data?.kind === 'map' && isDay(data.day) ? data.day : live;
    return {
      day,
      live: day === live,
      todayPostId: current?.postId ?? (await redis.get(LEGACY_MAP.MAP_POST)) ?? null,
    };
  },

  /**
   * Today's map post, opening it if the day has turned.
   *
   * Idempotent, and safe to call from the daily job, the moderator menu and the install trigger
   * at once: the day's post is created under a short lock, and anybody who finds the lock taken
   * answers with whatever is current. Today's post goes up before yesterday's is closed, so a
   * failure halfway leaves yesterday's map playable rather than no map at all.
   */
  async openToday(): Promise<{ postId: string; day: string; created: boolean }> {
    const now = Date.now();
    const today = dayOf(now);
    const current = await this.current();
    if (current && current.day === today && current.postId) {
      return { postId: current.postId, day: today, created: false };
    }

    const lock = mapOpenLockKey(today);
    const token = `${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    await redis.set(lock, token, { nx: true, expiration: new Date(now + 60_000) });
    if ((await redis.get(lock)) !== token) {
      const again = await this.current();
      if (again?.postId) return { postId: again.postId, day: again.day, created: false };
      throw new Error("Today's map is being opened. Try again in a moment.");
    }

    const { subredditName } = context;
    if (!subredditName) throw new Error('subredditName is required');
    const post = await reddit.submitCustomPost({
      subredditName,
      title: `Stonefall map, ${dayLabel(today)}`,
      entry: 'default',
      postData: { kind: 'map', day: today },
      textFallback: {
        text:
          "Today's map. Stack a tower, raise it on the shared grid, hold your ground for your " +
          'colour. The map starts over every day. Open the post to play.',
      },
    });
    await redis.set(MAP_CURRENT, JSON.stringify({ day: today, postId: post.id, openedAt: now }));
    const meta = mapMetaKey(today);
    await redis.hSet(meta, { postId: post.id, openedAt: String(now) });
    await redis.expire(meta, Math.floor((mapExpiry(today).getTime() - now) / 1000));

    if (current && current.day !== today) await this.close(current);
    return { postId: post.id, day: today, created: true };
  },

  /** Open a map only if there is none at all: what an install or an upgrade does. */
  async ensureOpen(): Promise<{ postId: string; day: string; created: boolean }> {
    const current = await this.current();
    if (current?.postId) return { postId: current.postId, day: current.day, created: false };
    return this.openToday();
  },

  /**
   * The end of a day: the standings it closed on, said once in its own thread.
   *
   * The map itself needs no closing -- a post is live only while its day is the current one --
   * so this is the announcement, and a failure to post it changes nothing.
   */
  async close(map: CurrentMap): Promise<void> {
    await redis.hSet(mapMetaKey(map.day), { closedAt: String(Date.now()) });
    if (!map.postId) return;
    try {
      const { ranked, builders, towers } = await Plots.standings(map.day);
      const [first, ...rest] = ranked;
      const text = !first
        ? "Nobody raised anything on this map. Today's map is up, starting from nothing."
        : `That's the day. **${factionName(first.faction)}** held the most ground: ` +
          `${first.cells.toLocaleString()} cells` +
          (rest.length > 0
            ? `, ahead of ${rest
                .slice(0, 2)
                .map((r) => `${factionName(r.faction)} (${r.cells.toLocaleString()})`)
                .join(' and ')}`
            : '') +
          `. ${builders.toLocaleString()} ${builders === 1 ? 'builder' : 'builders'} raised ` +
          `${towers.toLocaleString()} ${towers === 1 ? 'tower' : 'towers'}. ` +
          "The map starts again from nothing in today's post.";
      await reddit.submitComment({ id: map.postId as `t3_${string}`, text, runAs: 'APP' });
    } catch (err) {
      console.error('map close: final comment failed', err);
    }
  },
};
