import { redis } from '@devvit/web/server';
import {
  allDone,
  capstoneFor,
  countEvent,
  dayProgressOf,
  levelOf,
  ordersCapstone,
  ordersNews,
  raiseXp,
  relayXp,
  type ProgressEvent,
  type ProgressNews,
  type RaiseXpInput,
  type XpGain,
} from '../../shared/social/progress';
import { dayBefore, streakOn } from '../../shared/social/streaks';
import { isFactionId, type FactionId } from '../../shared/types/factions';
import { awardsKey } from './keys';
import { Plots, towersOn } from './plots';
import { Users } from './users';

/**
 * A player's progress (shared/social/progress.ts): their XP, today's orders, and whether today's
 * capstone has fallen.
 *
 * It lives on the player's record (`xp`, and the day's progress as JSON in `prog`), so it lasts
 * as long as the record does: thirty days past their last game, like everything else that names
 * them. Every write is the player doing something, so it resets that clock.
 */
export const Progress = {
  xpOf(record: Record<string, string>): number {
    return Math.max(0, Math.floor(Number(record.xp) || 0));
  },

  /** Where a record stands on a map day, with what was just earned. */
  newsFrom(
    record: Record<string, string>,
    userId: string,
    day: string,
    gains: XpGain[] = []
  ): ProgressNews {
    const p = dayProgressOf(record.prog, day, Users.factionFrom(record, userId));
    return { xp: this.xpOf(record), orders: ordersNews(p), capstone: p.capstone, gains };
  },

  /**
   * Cells the player held when a map closed: every land cell with a tower of theirs in its stack.
   * Keeps are left out, since nobody can lose one and so nobody earned it by holding it.
   */
  async heldOn(map: string, userId: string): Promise<number> {
    try {
      const holds = await Plots.landHolds(map);
      return holds.filter((h) => towersOn(h).some((t) => t.userId === userId)).length;
    } catch {
      return 0;
    }
  },

  /** The colour that held the most ground on the day before `today`, from today's awards. */
  async wonBefore(today: string): Promise<FactionId | null> {
    const won = await redis.hGet(awardsKey(today), 'won');
    return isFactionId(won) ? won : null;
  },

  /**
   * Count something the player did, pay what it earned, and drop today's capstone if it has not
   * fallen yet. `xp` is what the thing itself earned (a raise, relay blocks); orders it finished
   * pay on top. Only a raise brings the day's capstone down, because it falls onto the tower.
   */
  async earn(
    userId: string,
    username: string,
    day: string,
    first: XpGain | null,
    event: ProgressEvent,
    capstone: boolean
  ): Promise<{ news: ProgressNews; levelled: boolean }> {
    const record = await Users.read(userId);
    const faction = Users.factionFrom(record, userId);
    const p = dayProgressOf(record.prog, day, faction);
    const gains: XpGain[] = first && first.xp > 0 ? [first] : [];

    if (capstone && !p.capstone) {
      const [held, won] = await Promise.all([
        this.heldOn(dayBefore(day), userId),
        this.wonBefore(day),
      ]);
      const cap = capstoneFor(userId, day, {
        streak: streakOn(Users.streakOf(record), day),
        held,
        won: won === faction,
      });
      p.capstone = true;
      gains.push({
        kind: 'capstone',
        xp: cap.xp,
        golden: cap.golden,
        streak: cap.streak,
        held: cap.held,
        won: cap.won,
      });
    }

    const orders = ordersNews(p);
    for (const i of countEvent(p, event)) {
      gains.push({ kind: 'order', xp: orders[i]?.xp ?? 0, order: i });
    }
    if (!p.bonus && allDone(p)) {
      p.bonus = true;
      gains.push({ kind: 'capstone', orders: true, ...ordersCapstone(userId, day) });
    }

    const before = this.xpOf(record);
    const xp = before + gains.reduce((n, g) => n + g.xp, 0);
    const fields = { username, xp: String(xp), prog: JSON.stringify(p) };
    await Users.write(userId, fields);
    return {
      news: this.newsFrom({ ...record, ...fields }, userId, day, gains),
      levelled: levelOf(xp).level > levelOf(before).level,
    };
  },

  /** A tower raised on today's map. */
  async raised(
    userId: string,
    username: string,
    day: string,
    raise: RaiseXpInput & { ahead: boolean }
  ) {
    const xp = raiseXp(raise);
    return this.earn(
      userId,
      username,
      day,
      { kind: 'raise', xp: xp.xp, base: xp.base, mult: xp.mult, why: xp.why },
      {
        type: 'raise',
        kind: raise.kind,
        own: raise.own === true,
        ahead: raise.ahead,
        fell: raise.fell ?? 0,
        perfects: raise.perfects,
      },
      true
    );
  },

  /** Blocks landed on today's relay. */
  async relayed(userId: string, username: string, day: string, blocks: number, perfects: number) {
    return this.earn(
      userId,
      username,
      day,
      { kind: 'relay', xp: relayXp(blocks, perfects), blocks },
      { type: 'relay', blocks },
      false
    );
  },
};
