import { redis } from '@devvit/web/server';
import { defaultFactionFor, isFactionId, type FactionId } from '../../shared/types/factions';
import { nextStreak, streakOn, type Streak } from '../../shared/social/streaks';
import {
  DEFAULT_STONE,
  isStoneId,
  isUnlocked,
  newlyUnlocked,
  stoneOf,
  type StoneId,
  type StoneProgress,
} from '../../shared/social/stones';
import type { StoneNews } from '../../shared/types/api';
import { USER_DATA_TTL_SECONDS, userKey } from './keys';

/**
 * The per-player record: one hash per user.
 *
 * Fields: username, runs, best, bestRun, lastSeen, faction, chosen, and for stones
 * (shared/social/stones.ts) streak, streakDay, bestStreak, postedDay, postedDays and stone.
 * Everything a player is across posts lives here; everything about where they build lives in
 * Plots.
 *
 * Every write resets the record's expiry, so it lasts USER_DATA_TTL_SECONDS past the player's
 * last run or colour change: the way a deleted account's name and id leave the app.
 */
export const Users = {
  async write(userId: string, fields: Record<string, string>): Promise<void> {
    const key = userKey(userId);
    await redis.hSet(key, fields);
    await redis.expire(key, USER_DATA_TTL_SECONDS);
  },

  async read(userId: string): Promise<Record<string, string>> {
    return (await redis.hGetAll(userKey(userId))) ?? {};
  },

  /**
   * The colour a player builds under.
   *
   * A stored choice wins; otherwise a stable default hashed from the id, so a player has a flag
   * from their first tap and a swatch row is never in the way of playing.
   */
  factionFrom(record: Record<string, string>, userId: string): FactionId {
    return isFactionId(record.faction) ? record.faction : defaultFactionFor(userId);
  },

  /** The days-in-a-row a record holds, and the last day that counted towards it. */
  streakOf(record: Record<string, string>): Streak {
    const day = record.streakDay;
    return {
      streak: Math.max(0, Number(record.streak) || 0),
      day: typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null,
    };
  },

  /** What a record has earned stones with. */
  progressOf(record: Record<string, string>): StoneProgress {
    return {
      bestStreak: Math.max(0, Number(record.bestStreak) || 0, this.streakOf(record).streak),
      postedDays: Math.max(0, Number(record.postedDays) || 0),
    };
  },

  /** The stone a player builds in: the one they chose, if they have earned it. */
  stoneFrom(record: Record<string, string>): StoneId {
    const chosen = record.stone;
    return isStoneId(chosen) && isUnlocked(stoneOf(chosen), this.progressOf(record))
      ? chosen
      : DEFAULT_STONE;
  },

  /** Where a player stands with stones on a map day, as the client is told. */
  newsFrom(record: Record<string, string>, day: string, unlocked: StoneId[] = []): StoneNews {
    return {
      stone: this.stoneFrom(record),
      unlocked,
      streak: streakOn(this.streakOf(record), day),
      postedToday: record.postedDay === day,
      ...this.progressOf(record),
    };
  },

  /**
   * Write what a day did to a record, and wear the newest stone it earned: a reward is seen on
   * the next block, not found later in a menu. The player can always choose another.
   */
  async advance(
    userId: string,
    record: Record<string, string>,
    fields: Record<string, string>,
    day: string
  ): Promise<StoneNews> {
    const next = { ...record, ...fields };
    const unlocked = newlyUnlocked(this.progressOf(record), this.progressOf(next));
    const newest = unlocked[unlocked.length - 1];
    if (newest) next.stone = fields.stone = newest;
    await this.write(userId, fields);
    return this.newsFrom(next, day, unlocked);
  },

  /** They played on this map day: the streak grows by one, once a day. */
  async markPlayed(userId: string, day: string): Promise<StoneNews> {
    const record = await this.read(userId);
    const prev = this.streakOf(record);
    if (prev.day === day) return this.newsFrom(record, day);
    const streak = nextStreak(prev, day);
    return this.advance(
      userId,
      record,
      {
        streak: String(streak),
        streakDay: day,
        bestStreak: String(Math.max(streak, this.progressOf(record).bestStreak)),
      },
      day
    );
  },

  /** They posted about a run on this map day: one more day posted, however many comments. */
  async markPosted(userId: string, day: string): Promise<StoneNews> {
    const record = await this.read(userId);
    if (record.postedDay === day) return this.newsFrom(record, day);
    return this.advance(
      userId,
      record,
      { postedDay: day, postedDays: String(this.progressOf(record).postedDays + 1) },
      day
    );
  },

  /** Wear a stone the player has earned. False for one they have not. */
  async setStone(userId: string, stone: StoneId): Promise<boolean> {
    if (!isUnlocked(stoneOf(stone), this.progressOf(await this.read(userId)))) return false;
    await this.write(userId, { stone });
    return true;
  },

  async faction(userId: string): Promise<FactionId> {
    return this.factionFrom(await this.read(userId), userId);
  },

  /**
   * Change colour. Only the player's record: what that costs on the map is Plots.raze, and the
   * keep's new flag is Plots.recolourKeep, because both are about one day's map and this is not.
   */
  async setFaction(userId: string, username: string, faction: FactionId): Promise<void> {
    await this.write(userId, { username, faction, chosen: '1' });
  },
};
