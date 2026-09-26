import { redis } from '@devvit/web/server';
import { defaultFactionFor, isFactionId, type FactionId } from '../../shared/types/factions';
import { USER_DATA_TTL_SECONDS, userKey } from './keys';

/**
 * The per-player record: one hash per user.
 *
 * Fields: username, runs, best, bestRun, lastSeen, faction, chosen. Everything a player is
 * across posts lives here; everything about where they build lives in Plots.
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
