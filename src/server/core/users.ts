import { redis } from '@devvit/web/server';
import { defaultFactionFor, isFactionId, type FactionId } from '../../shared/types/factions';
import { userKey } from './keys';

/**
 * The per-player record: one hash per user.
 *
 * Fields: username, runs, best, bestRun, lastSeen, faction, chosen. Everything a player is
 * across posts lives here; everything about where they build lives in Plots.
 */
export const Users = {
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
    await redis.hSet(userKey(userId), { username, faction, chosen: '1' });
  },
};
