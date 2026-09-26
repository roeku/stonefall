import { context, reddit, redis } from '@devvit/web/server';
import type { MapInfo } from '../../shared/types/api';
import { factionName } from '../../shared/types/factions';
import { LEGACY_MAP, MAP_CURRENT, mapMetaKey, mapOpenLockKey } from './keys';
import { Plots, mapExpiry } from './plots';

/**
 * The daily map.
 *
 * A map opens empty each day, fills with whoever plays that day, and is replaced when the next
 * day's opens. The daily job opens the map and the relay together, so a new pair of posts goes up
 * each day.
 *
 * A daily post carries its day in `postData`, and it shows that day: once the day is over, the
 * board as it ended, its standings and its scores, for as long as the map is stored. Reddit keeps
 * showing a post for days after it goes up, so an older post is also a way in to today's game:
 * whatever builds works on the live map, whichever post it came from (`forRequest`), and the
 * client moves the post over to today's map when the player starts a run there.
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

/**
 * How a daily post sits in the feed before the game has loaded: the game's own night sky, in light
 * and dark mode alike, so the post does not flash white or transparent while it starts.
 */
export const POST_STYLES = {
  backgroundColor: '#000814FF',
  backgroundColorDark: '#000814FF',
} as const;

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

  /**
   * Today's map post, for links from the relay. Falls back to the one map post of old only on an
   * install that has never opened a daily map: a day whose post was deleted has none.
   */
  async todayPostId(): Promise<string | null> {
    const current = await this.current();
    return current ? current.postId : ((await redis.get(LEGACY_MAP.MAP_POST)) ?? null);
  },

  /** A deleted post stops being today's map, so the moderator menu can open another. */
  async forgetPost(postId: string): Promise<void> {
    const current = await this.current();
    if (current?.postId === postId) {
      await redis.set(MAP_CURRENT, JSON.stringify({ ...current, postId: null }));
    }
  },

  /** The live map, from whichever post the request was made in: what every write works on. */
  async forRequest(): Promise<MapInfo> {
    return this.forView('live');
  },

  /**
   * Which map a post shows.
   *
   * `live` is today's. `post` is the post's own day: an older daily post shows the board its day
   * ended on while that map is still stored, and today's once it has expired, as a post from
   * before daily maps always does. Only what is shown differs; nothing is ever built on a day
   * that is over.
   */
  async forView(view: 'post' | 'live'): Promise<MapInfo> {
    const current = await this.current();
    const live = current?.day ?? dayOf(Date.now());
    const data = context.postData as { kind?: unknown; day?: unknown } | undefined;
    const postDay = data?.kind === 'map' && isDay(data.day) ? data.day : null;
    const past =
      view === 'post' &&
      postDay !== null &&
      postDay < live &&
      (await redis.exists(mapMetaKey(postDay))) > 0;
    return {
      day: past ? postDay : live,
      live: !past,
      todayPostId: current ? current.postId : ((await redis.get(LEGACY_MAP.MAP_POST)) ?? null),
      postDay,
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
      styles: POST_STYLES,
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
   * The map itself needs no closing: a day that is no longer the live one is only ever read. So
   * this is the announcement, and a failure to post it changes nothing.
   */
  async close(map: CurrentMap): Promise<void> {
    await redis.hSet(mapMetaKey(map.day), { closedAt: String(Date.now()) });
    if (!map.postId) return;
    try {
      const { ranked, builders, towers } = await Plots.standings(map.day);
      const [first, ...rest] = ranked;
      const text = !first
        ? "Nobody raised anything on this map. Today's starts from nothing, and Build here plays it."
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
          "This post keeps the map as it ended; Build here plays today's.";
      await reddit.submitComment({ id: map.postId as `t3_${string}`, text, runAs: 'APP' });
    } catch (err) {
      console.error('map close: final comment failed', err);
    }
  },
};
