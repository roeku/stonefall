import { context, reddit, redis } from '@devvit/web/server';
import { flairFor, isOldFlair, parseAwards, type AwardsHeld } from '../../shared/social/flair';
import { streakOn } from '../../shared/social/streaks';
import { FLAIR_PLAYED } from './keys';
import { Users } from './users';

/** Pages of the subreddit's flair list one batch of `retireOld` reads, a thousand flairs each. */
const OLD_FLAIR_PAGES = 10;

/** Reddit's limit on flairs set in one call. */
const FLAIR_BATCH = 100;

/** Where `retireOld` got to in the subreddit's flair list, between batches. */
const OLD_FLAIR_CURSOR = 'migrations:old-flair:cursor';

/** Set once `retireOld` has read the whole flair list on this install. */
const OLD_FLAIR_DONE = 'migrations:old-flair:2026-10';

/** A flair someone chose for themselves, kept while the game's is worn, to give back after. */
interface OwnFlair {
  text: string;
  cssClass: string;
}

const parseOwn = (raw: string | undefined): OwnFlair | null => {
  if (!raw) return null;
  try {
    const f = JSON.parse(raw) as Partial<OwnFlair>;
    return typeof f.text === 'string' && f.text
      ? { text: f.text, cssClass: typeof f.cssClass === 'string' ? f.cssClass : '' }
      : null;
  } catch {
    return null;
  }
};

/** A map day as a whole number of days, for the played index's scores. */
const dayNumber = (day: string): number => Math.floor(Date.parse(`${day}T00:00:00Z`) / 86_400_000);

/**
 * The player's flair in the subreddit: every player wears it, from their first game, until they
 * take it off in the game (`shared/social/flair.ts` says what it reads, `Awards` hands out the
 * awards in it).
 *
 * The record keeps whether they took it off (`flair` '0'), the awards held (`awards`), the text
 * last set (`flairText`) and the flair they had before the game's (`flairBefore`), so keeping it
 * current costs a Reddit call only when something it says has changed, and taking it off gives
 * theirs back. None of these is the player doing anything, so writing them never resets the
 * record's expiry (`Users.note`). The app sets it as the subreddit's moderator, which it already
 * is for the pinned comments.
 */
export const Flair = {
  isOn(record: Record<string, string>): boolean {
    return record.flair !== '0';
  },

  /** Whether the game's flair is on the player now: not taken off, and set at least once. */
  wearing(record: Record<string, string>): boolean {
    return this.isOn(record) && !!record.flairText;
  },

  /** What the record's flair should say on this map day. */
  lookOf(record: Record<string, string>, userId: string, day: string) {
    return flairFor({
      faction: Users.factionFrom(record, userId),
      stone: Users.stoneFrom(record),
      streak: streakOn(Users.streakOf(record), day),
      awards: parseAwards(record.awards),
    });
  },

  /**
   * Set it on Reddit, and remember what it says. The first time, the flair the player had is kept,
   * to give back if they take the game's off.
   */
  async put(userId: string, username: string, record: Record<string, string>, day: string) {
    const subredditName = context.subredditName;
    if (!subredditName) throw new Error('subredditName is required');
    const before = record.flairText ? null : await this.ownFlair(username);
    const look = this.lookOf(record, userId, day);
    await reddit.setUserFlair({ subredditName, username, ...look });
    await Users.note(userId, {
      flairText: look.text,
      ...(before !== null ? { flairBefore: before } : {}),
    });
    return look;
  },

  /**
   * The flair the player has now, before the game's goes on, as `flairBefore` keeps it: empty for
   * none, and for the old version's, which nobody chose. Only the text and class come back from
   * Reddit, so a flair from a template is given back as its words.
   */
  async ownFlair(username: string): Promise<string> {
    const subreddit = await reddit.getCurrentSubreddit();
    const { users } = await subreddit.getUserFlair({ usernames: [username] });
    const text = users[0]?.flairText ?? '';
    if (!text || isOldFlair(text)) return '';
    return JSON.stringify({ text, cssClass: users[0]?.flairCssClass ?? '' } satisfies OwnFlair);
  },

  /** Take the game's flair off: give back the one the player had before, or leave none. */
  async takeOff(userId: string, username: string, record: Record<string, string>): Promise<void> {
    const subredditName = context.subredditName;
    if (!subredditName) throw new Error('subredditName is required');
    const own = parseOwn(record.flairBefore);
    if (own) {
      await reddit.setUserFlair({
        subredditName,
        username,
        text: own.text,
        ...(own.cssClass ? { cssClass: own.cssClass } : {}),
      });
    } else {
      await reddit.removeUserFlair(subredditName, username);
    }
    await Users.note(userId, { flair: '0', flairText: '', flairBefore: '' });
  },

  /** Set it if what it should say has changed. Nothing for a player who took it off. */
  async refresh(userId: string, username: string, record: Record<string, string>, day: string) {
    if (!this.isOn(record) || this.lookOf(record, userId, day).text === record.flairText) return;
    await this.put(userId, username, record, day);
  },

  /**
   * Bring a player's flair up to date after something it shows changed: a stone earned or worn,
   * a colour. Never fails the thing that called it.
   */
  async sync(userId: string, username: string, day: string): Promise<void> {
    try {
      const record = await Users.read(userId);
      if (Object.keys(record).length > 0) await this.refresh(userId, username, record, day);
    } catch (err) {
      console.warn('flair: could not bring it up to date', err);
    }
  },

  /**
   * A day played: the flair goes on, or says the longer streak, and the player is listed by the
   * day so the awards job can bring the streak down once it ends (`lapsed`).
   */
  async played(userId: string, username: string, day: string): Promise<void> {
    await Users.write(userId, { username });
    await redis.zAdd(FLAIR_PLAYED, { member: userId, score: dayNumber(day) });
    await this.sync(userId, username, day);
  },

  /** Players whose streak has ended by `day`: their last game was two days before it or more. */
  async lapsed(day: string): Promise<string[]> {
    const rows = await redis.zRange(FLAIR_PLAYED, 0, dayNumber(day) - 2, { by: 'score' });
    return (rows ?? []).map((r) => r.member);
  },

  /** Take `lapsed`'s players off the list once their flairs are queued to come down. */
  async forgetLapsed(day: string): Promise<void> {
    await redis.zRemRangeByScore(FLAIR_PLAYED, 0, dayNumber(day) - 2);
  },

  /** Turn it on or off, from the player's tap. Off gives back the flair they had. */
  async set(
    userId: string,
    username: string,
    on: boolean,
    day: string
  ): Promise<{ ok: true; text: string | null } | { ok: false; reason: string }> {
    if (!context.subredditName) return { ok: false, reason: 'No subreddit here.' };
    try {
      const record = await Users.read(userId);
      if (!on) {
        await this.takeOff(userId, username, record);
        return { ok: true, text: null };
      }
      await Users.write(userId, { username, flair: '1' });
      const look = await this.put(userId, username, { ...record, flair: '1' }, day);
      return { ok: true, text: look.text };
    } catch (err) {
      console.error('flair: Reddit refused', err);
      return { ok: false, reason: 'Reddit would not set the flair.' };
    }
  },

  /**
   * What the awards job does to one player: the awards they hold from today (none to take the day
   * before's back) and their flair brought up to date with them. A player who took the flair off
   * holds them without wearing them, so turning it back on shows them.
   */
  async hold(
    userId: string,
    username: string | undefined,
    held: AwardsHeld | null,
    day: string
  ): Promise<void> {
    const record = await Users.read(userId);
    const name = username || record.username;
    if (!name || Object.keys(record).length === 0) return;
    const awards = held ? JSON.stringify(held) : '';
    if ((record.awards ?? '') !== awards) await Users.note(userId, { awards });
    await this.refresh(userId, name, { ...record, awards }, day);
  },

  /** Whether the old version's flairs have all been taken off on this install. */
  async oldRetired(): Promise<boolean> {
    return (await redis.exists(OLD_FLAIR_DONE)) > 0;
  },

  /**
   * One batch of taking off the flair the version before the rewrite set on everyone who played,
   * unasked ("ELO 1234 | MAX 56", `isOldFlair`). Archiving that code stopped new ones but left
   * the ones on Reddit. Reads the subreddit's flair list a page at a time and clears those, a
   * hundred to a call; a flair a player chose, or the game's own, is left alone.
   *
   * Resumable: `done` is false when the batch stopped with pages left. Throws when Reddit
   * refuses, so a failure waits for the next scheduling instead of retrying at once.
   */
  async retireOld(): Promise<{ done: boolean; cleared: number }> {
    if (await this.oldRetired()) return { done: true, cleared: 0 };
    const subreddit = await reddit.getCurrentSubreddit();
    let after = (await redis.get(OLD_FLAIR_CURSOR)) ?? undefined;
    let cleared = 0;
    for (let page = 0; page < OLD_FLAIR_PAGES; page++) {
      const { users, next } = await subreddit.getUserFlair({
        limit: 1000,
        ...(after ? { after } : {}),
      });
      const old = users.flatMap((u) => (u.user && isOldFlair(u.flairText) ? [u.user] : []));
      for (let i = 0; i < old.length; i += FLAIR_BATCH) {
        // No text and no class clears a flair.
        const rows = old.slice(i, i + FLAIR_BATCH).map((username) => ({ username }));
        const results = await reddit.setUserFlairBatch(subreddit.name, rows);
        cleared += results.filter((r) => r.ok).length;
      }
      // A cursor that does not move would read the same page forever.
      if (!next || next === after) {
        await redis.del(OLD_FLAIR_CURSOR);
        await redis.set(OLD_FLAIR_DONE, String(Date.now()));
        return { done: true, cleared };
      }
      after = next;
      await redis.set(OLD_FLAIR_CURSOR, next);
    }
    return { done: false, cleared };
  },
};
