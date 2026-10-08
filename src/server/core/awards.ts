import { redis } from '@devvit/web/server';
import type { Award, AwardsHeld } from '../../shared/social/flair';
import { isFactionId, type FactionId } from '../../shared/types/factions';
import { Flair } from './flair';
import {
  AWARDS_LAST,
  USER_DATA_TTL_SECONDS,
  awardHoldersKey,
  awardWorkKey,
  awardsKey,
} from './keys';

/**
 * A day's winners, in their flair until the next day's (`shared/social/flair.ts` says how).
 *
 * When a day opens, the map and the relay each write down how the day before ended (`fromMap`,
 * `fromRelay`): the colour with the most ground, whose players all get "Won", and the best
 * tower, the most land and the most relay blocks, one player each. The awards job (`batch`) then
 * puts them in the winners' flair and takes back the day before's from anybody who did not win
 * again. It also brings down the streak in the flair of everyone whose streak has just ended,
 * since nothing else they do would.
 */

interface Player {
  userId: string;
  username: string;
}

interface Holder {
  username: string;
  held: AwardsHeld;
}

/**
 * A flair still to bring up to date: with the awards to put on, or null for none. A player whose
 * streak has ended has no name here; their record has it.
 */
interface Work {
  username?: string;
  held: AwardsHeld | null;
}

/** Players one batch changes the flair of: three Reddit calls each at most, inside thirty seconds. */
const AWARD_BATCH = 15;

const parse = <T>(raw: string | null | undefined): T | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

const write = async (key: string, fields: Record<string, string>): Promise<void> => {
  if (Object.keys(fields).length === 0) return;
  await redis.hSet(key, fields);
  await redis.expire(key, USER_DATA_TTL_SECONDS);
};

const player = (userId: string | null, username: string | undefined): string | null =>
  userId && username ? JSON.stringify({ userId, username } satisfies Player) : null;

/**
 * Everyone the day's record gives an award: each player once, with all they won. "Won" goes to
 * the winning colour's players and names that colour, so a player who has changed colour since
 * says nothing of a win that was not theirs.
 */
const holdersOf = (decided: Record<string, string>): Map<string, Holder> => {
  const out = new Map<string, Holder>();
  const day = decided.day;
  if (!day) return out;
  const won = isFactionId(decided.won) ? decided.won : null;
  const give = (p: Player | null, award: Award) => {
    if (!p?.userId || !p.username) return;
    const row = out.get(p.userId) ?? {
      username: p.username,
      held: { day, faction: null, list: [] },
    };
    row.held.list.push(award);
    if (award === 'won') row.held.faction = won;
    out.set(p.userId, row);
  };
  if (won) for (const p of parse<Player[]>(decided.side) ?? []) give(p, 'won');
  for (const award of ['best', 'land', 'blocks'] as const) {
    give(parse<Player>(decided[award]), award);
  }
  return out;
};

export const Awards = {
  /**
   * How the day before ended on the map, written down when today's opens: the winning colour
   * (none on a tie) with its players, the best tower and the most land.
   */
  async fromMap(
    today: string,
    wonOn: string,
    ended: {
      ranked: ReadonlyArray<{ faction: FactionId; cells: number }>;
      bestId: string | null;
      mostId: string | null;
      best: { username: string } | null;
      most: { username: string } | null;
      players: ReadonlyArray<{ userId: string; username: string; faction: FactionId }>;
    }
  ): Promise<void> {
    const [first, second] = ended.ranked.filter((r) => r.cells > 0);
    const won = first && (!second || second.cells < first.cells) ? first.faction : null;
    const side = won
      ? ended.players
          .filter((p) => p.faction === won)
          .map((p) => ({ userId: p.userId, username: p.username }) satisfies Player)
      : [];
    const best = player(ended.bestId, ended.best?.username);
    const land = player(ended.mostId, ended.most?.username);
    await write(awardsKey(today), {
      day: wonOn,
      ...(won ? { won, side: JSON.stringify(side) } : {}),
      ...(best ? { best } : {}),
      ...(land ? { land } : {}),
    });
  },

  /** How the day before ended in the relay: who landed the most blocks. */
  async fromRelay(
    today: string,
    wonOn: string,
    ended: { mostId: string | null; most: { username: string } | null }
  ): Promise<void> {
    const blocks = player(ended.mostId, ended.most?.username);
    await write(awardsKey(today), { day: wonOn, ...(blocks ? { blocks } : {}) });
  },

  /**
   * One batch of handing out today's awards, and `done` false while there are flairs left to
   * change. The first batch of a day works out who holds what and whose awards come back,
   * then each batch changes a few flairs. A flair Reddit refuses is skipped, not retried, so one
   * deleted account cannot hold up the rest.
   */
  async batch(today: string): Promise<{ done: boolean; players: number }> {
    const decided = (await redis.hGetAll(awardsKey(today))) ?? {};
    if (!decided.day) return { done: true, players: 0 };
    const last = (await redis.get(AWARDS_LAST)) ?? null;
    if (last !== today) await this.start(today, decided, last);

    const work = awardWorkKey(today);
    const userIds = ((await redis.hKeys(work)) ?? []).slice(0, AWARD_BATCH);
    for (const userId of userIds) {
      const row = parse<Work>(await redis.hGet(work, userId));
      try {
        if (row) await Flair.hold(userId, row.username, row.held, today);
      } catch (err) {
        console.error('awards: could not change a flair', err);
      }
      await redis.hDel(work, [userId]);
    }
    const left = ((await redis.hKeys(work)) ?? []).length;
    return { done: left === 0, players: userIds.length };
  },

  /**
   * Work out a day's flair changes: today's holders get theirs, the day before's who won nothing
   * today have theirs taken back, and those whose streak has ended lose it. Whatever the day
   * before had not got round to is dropped, since today's changes cover the same players. Written
   * before the day is marked started, so a batch that dies halfway through this starts it again.
   */
  async start(today: string, decided: Record<string, string>, last: string | null) {
    const holders = holdersOf(decided);
    const before = last ? ((await redis.hGetAll(awardHoldersKey(last))) ?? {}) : {};
    const work: Record<string, string> = {};
    for (const [userId, h] of holders) work[userId] = JSON.stringify(h satisfies Work);
    for (const [userId, raw] of Object.entries(before)) {
      const h = parse<Holder>(raw);
      if (h && !holders.has(userId)) {
        work[userId] = JSON.stringify({ username: h.username, held: null } satisfies Work);
      }
    }
    for (const userId of await Flair.lapsed(today)) {
      work[userId] ??= JSON.stringify({ held: null } satisfies Work);
    }
    await redis.del(awardHoldersKey(today), awardWorkKey(today));
    await write(
      awardHoldersKey(today),
      Object.fromEntries([...holders].map(([id, h]) => [id, JSON.stringify(h)]))
    );
    await write(awardWorkKey(today), work);
    await Flair.forgetLapsed(today);
    if (last) await redis.del(awardWorkKey(last));
    await redis.set(AWARDS_LAST, today);
  },
};
