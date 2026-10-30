import { redis } from '@devvit/web/server';
import type { UiResponse } from '@devvit/web/shared';
import {
  AWARDS_LAST,
  FLAIR_PLAYED,
  MAP_CURRENT,
  MAP_TTL_SECONDS,
  PLOT_INDEX_LIMIT,
  RELAY_CURRENT,
  RELAY_TTL_SECONDS,
  RUN_TTL_SECONDS,
  STORAGE_HISTORY,
  STORAGE_TALLY_SINCE,
  STORAGE_TALLY_TTL_SECONDS,
  USER_DATA_TTL_SECONDS,
  awardHoldersKey,
  awardWorkKey,
  awardsKey,
  boardKeepsKey,
  boardMetaKey,
  boardPageKey,
  cellKey,
  feedKey,
  keepKey,
  landIndexKey,
  mapMetaKey,
  nextRegionKey,
  notifyHourKey,
  plotIndexKey,
  plotKey,
  regionKey,
  regionOwnerKey,
  relayCrewKey,
  relayMetaKey,
  relayPlayersKey,
  relaySummaryKey,
  relayTowerCountKey,
  relayTowerKey,
  scoresThreadKey,
  storageTallyKey,
  userKey,
} from './keys';

/**
 * How much of the installation's Redis Stonefall uses, for the moderators' storage report.
 *
 * Devvit's Redis answers no INFO, DBSIZE, MEMORY or SCAN, so nothing can ask it how full it is.
 * The report adds it up instead, family by family, the way keys.ts lays them out:
 *
 * - read whole where a family is a handful of keys: board pages, relay towers, awards, feeds;
 * - sampled where an index lists the keys: plots, keeps, cells, player records, relay players.
 *   A few dozen are read and their average is multiplied by how many there are;
 * - tallied where nothing lists them: runs and the per-run records. Each write adds its size to
 *   the day's tally (`tally`), and the report sums the days those keys live for.
 *
 * A key costs its name, its value, and KEY_OVERHEAD for what Redis keeps beside it. Reddit does
 * not publish how it meters an installation, so the total is an estimate, not a reading.
 */

/** What Devvit lets one installation store (its docs, 0.15): the smaller reading of "5 GB". */
export const STORAGE_LIMIT_BYTES = 5_000_000_000;

/** The most one Redis request may carry, so the largest a value can grow and still be read. */
export const REQUEST_LIMIT_BYTES = 5_000_000;

/** What Redis keeps beside each key (its entry, its expiry), and beside each field or member. */
const KEY_OVERHEAD = 64;
const ITEM_OVERHEAD = 16;

/** Values read to size a family too big to read whole. */
const SAMPLE = 40;

/** A user id, `t2_` and a few characters, where only a count of them is read. */
const ID_LENGTH = 12;

const DAY_MS = 86_400_000;
const MAP_DAYS = Math.ceil(MAP_TTL_SECONDS / 86_400);
const RELAY_DAYS = Math.ceil(RELAY_TTL_SECONDS / 86_400);
const RUN_DAYS = Math.ceil(RUN_TTL_SECONDS / 86_400);
const USER_DAYS = Math.ceil(USER_DATA_TTL_SECONDS / 86_400);

/** Days of report totals kept for the trend. */
const HISTORY_DAYS = 90;

/**
 * Keys nothing indexes, counted as they are written. Runs are the run and its counted-once guard
 * (30 days); comments the one-per-run comment guard (30 days); takes what a take toppled and the
 * comment a run was announced in (the map's life); players a count of who started on a map.
 */
export type TallyFamily = 'runs' | 'comments' | 'takes' | 'players';

/** One line of the report. */
export interface StorageFamily {
  label: string;
  keys: number;
  bytes: number;
  /** Grows with players. The rest is held to the game's own caps however many play. */
  scales: boolean;
  /** How it was counted, when that was not by reading every key. */
  note?: string;
}

export interface StorageReport {
  at: number;
  bytes: number;
  keys: number;
  /** Largest first. */
  families: StorageFamily[];
  /** Players who started on the map, a day, over the last complete days. */
  dailyPlayers: number;
  /** Bytes the growing families keep per daily player. */
  perPlayer: number;
  /** Daily players STORAGE_LIMIT_BYTES holds at this mix; null until anyone has played. */
  capacity: number | null;
  /** The biggest single value, against REQUEST_LIMIT_BYTES. */
  largest: { label: string; bytes: number } | null;
  /** The relay post live when the report ran, kept in the history so later reports find it. */
  relayPost: string | null;
}

/** A day's totals, as the history keeps them. */
export interface StorageHistoryEntry {
  day: string;
  bytes: number;
  keys: number;
  players: number;
  relay: string | null;
}

type Form = NonNullable<UiResponse['showForm']>['form'];
type FormField = Form['fields'][number];

const parse = <T>(raw: string | null | undefined): T | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const dayBefore = (ms: number, back: number): string => utcDay(ms - back * DAY_MS);
const mean = (xs: readonly number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
const count = (row: Record<string, string> | undefined, field: string): number =>
  Number(row?.[field] ?? 0) || 0;

const stringBytes = (key: string, length: number): number => key.length + length + KEY_OVERHEAD;
const hashBytes = (key: string, fields: Record<string, string>): number => {
  const entries = Object.entries(fields);
  if (entries.length === 0) return 0;
  return entries.reduce(
    (n, [f, v]) => n + f.length + v.length + ITEM_OVERHEAD,
    key.length + KEY_OVERHEAD
  );
};
const zsetBytes = (key: string, members: number, memberLength: number): number =>
  members === 0 ? 0 : key.length + KEY_OVERHEAD + members * (memberLength + 8 + ITEM_OVERHEAD);

/** Up to `n` items spread across a list, rather than all from its front. */
const spread = <T>(items: readonly T[], n = SAMPLE): T[] =>
  items.length <= n
    ? [...items]
    : Array.from({ length: n }, (_, i) => items[Math.floor((i * items.length) / n)]!);

/** String values' lengths, read in chunks of a hundred; null where a key is gone. */
const valueLengths = async (keys: readonly string[]): Promise<(number | null)[]> => {
  const out: (number | null)[] = [];
  for (let i = 0; i < keys.length; i += 100) {
    const chunk = keys.slice(i, i + 100);
    const rows = await redis.mGet(chunk);
    for (let j = 0; j < chunk.length; j++) out.push(rows?.[j]?.length ?? null);
  }
  return out;
};

/** `total` string keys, sized from the ones in `sample`: their average footprint, times the total. */
const sampled = async (
  sample: readonly string[],
  total: number
): Promise<{ bytes: number; max: number }> => {
  if (total === 0 || sample.length === 0) return { bytes: 0, max: 0 };
  const lengths = await valueLengths(sample);
  const sizes = sample.flatMap((key, i) => {
    const length = lengths[i];
    return length == null ? [] : [stringBytes(key, length)];
  });
  return { bytes: Math.round(mean(sizes) * total), max: Math.max(0, ...sizes) };
};

/** A hash sized from one page of its fields: their average, times how many it has. */
const sampledHash = async (key: string): Promise<{ fields: number; bytes: number }> => {
  const fields = await redis.hLen(key);
  if (fields === 0) return { fields, bytes: 0 };
  const page = await redis.hScan(key, 0, undefined, SAMPLE);
  const sizes = (page?.fieldValues ?? []).map(
    (fv) => fv.field.length + fv.value.length + ITEM_OVERHEAD
  );
  return { fields, bytes: key.length + KEY_OVERHEAD + Math.round(mean(sizes) * fields) };
};

/** How many members a sorted set holds, and a few dozen of them from across its ranks. */
const sampleIndex = async (key: string): Promise<{ count: number; members: string[] }> => {
  const total = await redis.zCard(key);
  if (total <= SAMPLE) {
    const rows = total > 0 ? await redis.zRange(key, 0, total - 1, { by: 'rank' }) : [];
    return { count: total, members: (rows ?? []).map((r) => r.member) };
  }
  const window = SAMPLE / 4;
  const starts = [0, 1, 2, 3].map((i) => Math.floor((i * (total - window)) / 3));
  const rows = await Promise.all(
    starts.map((s) => redis.zRange(key, s, s + window - 1, { by: 'rank' }))
  );
  return {
    count: total,
    members: [...new Set(rows.flatMap((r) => (r ?? []).map((m) => m.member)))],
  };
};

/** A post's score feed and the id of its pinned comment, read whole: both are capped small. */
const measureFeed = async (postId: string): Promise<{ keys: number; bytes: number }> => {
  const [rows, thread] = await Promise.all([
    redis.zRange(feedKey(postId), 0, 199, { by: 'rank' }),
    redis.strLen(scoresThreadKey(postId)),
  ]);
  const members = (rows ?? []).map((r) => r.member);
  const feed =
    members.length === 0
      ? 0
      : zsetBytes(feedKey(postId), members.length, mean(members.map((m) => m.length)));
  return {
    keys: (members.length > 0 ? 1 : 0) + (thread > 0 ? 1 : 0),
    bytes: feed + (thread > 0 ? stringBytes(scoresThreadKey(postId), thread) : 0),
  };
};

/** "6 hours", "3 days": how long tallying has been running. */
const span = (days: number): string => {
  if (days >= 1.5) return `${Math.round(days)} days`;
  const hours = Math.max(1, Math.round(days * 24));
  return hours === 1 ? 'an hour' : `${hours} hours`;
};

/**
 * A tallied family's keys still alive.
 *
 * Calendar-day families (runs, comments) live `days` days from their write: the last `days` days
 * of tallies, the oldest only for the part of it not yet expired. Map families (takes) go with
 * their map, so they are the last `days` maps' tallies whole. When tallying began inside that
 * window, what it saw is stretched to the whole of it, and the note says so.
 */
const alive = (
  tallies: ReadonlyMap<string, Record<string, string>>,
  family: TallyFamily,
  days: number,
  byMap: boolean,
  at: number,
  since: number | null
): { keys: number; bytes: number; note?: string } => {
  if (since === null) return { keys: 0, bytes: 0, note: 'Counted from this version on: none yet.' };
  const todayDone = (at - Date.parse(`${utcDay(at)}T00:00:00Z`)) / DAY_MS;
  let keys = 0;
  let bytes = 0;
  const last = byMap ? days - 1 : days;
  for (let back = 0; back <= last; back++) {
    const weight = !byMap && back === days ? 1 - todayDone : 1;
    const row = tallies.get(dayBefore(at, back));
    keys += weight * count(row, `${family}:n`);
    bytes += weight * count(row, `${family}:b`);
  }
  const seen = (at - since) / DAY_MS;
  if (seen >= days) return { keys, bytes };
  const stretch = days / Math.max(seen, 1 / 24);
  return {
    keys: keys * stretch,
    bytes: bytes * stretch,
    note: `Counted for ${span(seen)} so far; ${days} days' worth estimated from it.`,
  };
};

const family = (label: string, scales: boolean): StorageFamily => ({
  label,
  keys: 0,
  bytes: 0,
  scales,
});
const add = (f: StorageFamily, keys: number, bytes: number): void => {
  f.keys += keys;
  f.bytes += bytes;
};

/** Every history entry, oldest first. */
const historyFrom = (rows: Record<string, string>): StorageHistoryEntry[] =>
  Object.entries(rows)
    .flatMap(([day, raw]) => {
      const e = parse<Omit<StorageHistoryEntry, 'day'>>(raw);
      return e && Number.isFinite(e.bytes) ? [{ ...e, day }] : [];
    })
    .sort((a, b) => a.day.localeCompare(b.day));

/** "41.2 MB": decimal units, as the limits are given. */
export const bytesText = (bytes: number): string => {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = Math.max(0, bytes);
  let u = 0;
  while (n >= 1000 && u < units.length - 1) {
    n /= 1000;
    u++;
  }
  return `${u === 0 ? Math.round(n) : Number(n.toPrecision(3))} ${units[u]}`;
};

const share = (part: number, whole: number): string => {
  const pct = (100 * part) / whole;
  if (pct === 0) return '0%';
  if (pct < 0.1) return 'under 0.1%';
  return `${Number(pct.toPrecision(pct < 10 ? 2 : 3))}%`;
};

const whole = (n: number): string => Math.round(n).toLocaleString('en-US');

const shortDay = (day: string): string =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

export const Storage = {
  /**
   * Count a write to keys nothing indexes, for the report. Keyed by today's UTC date, or by the
   * map for a map's keys. Never fails the write it counts.
   */
  async tally(family: TallyFamily, keys: number, bytes: number, day?: string): Promise<void> {
    try {
      const key = storageTallyKey(day ?? utcDay(Date.now()));
      const n = await redis.hIncrBy(key, `${family}:n`, keys);
      if (bytes > 0) await redis.hIncrBy(key, `${family}:b`, bytes);
      // The family's first write of the day: start the day's clock, and the install's.
      if (n === keys) {
        await redis.expire(key, STORAGE_TALLY_TTL_SECONDS);
        await redis.set(STORAGE_TALLY_SINCE, String(Date.now()), { nx: true });
      }
    } catch (err) {
      console.error(`storage: could not tally ${family}`, err);
    }
  },

  /** Add up what Stonefall keeps in Redis. A thousand or so reads, most of them in parallel. */
  async report(at = Date.now()): Promise<StorageReport> {
    let largest: StorageReport['largest'] = null;
    const big = (label: string, bytes: number): void => {
      if (bytes > (largest?.bytes ?? 0)) largest = { label, bytes };
    };

    const runs = family('Runs', true);
    const users = family('Player records', true);
    const maps = family('Plots, keeps and land', true);
    const boards = family('Map boards', false);
    const relayTowers = family('Relay towers', false);
    const relayPlayers = family('Relay players', true);
    const feeds = family('Score feeds', false);
    const records = family('Comment and take records', true);
    const awards = family('Awards and flair', true);
    const notify = family('Notifications', true);
    const other = family('Everything else', false);

    const tallyDays = Array.from({ length: RUN_DAYS + 2 }, (_, back) => dayBefore(at, back));
    const [tallyRows, sinceRaw, currentRaw, relayNow, historyRows] = await Promise.all([
      Promise.all(tallyDays.map((d) => redis.hGetAll(storageTallyKey(d)))),
      redis.get(STORAGE_TALLY_SINCE),
      redis.get(MAP_CURRENT),
      redis.get(RELAY_CURRENT),
      redis.hGetAll(STORAGE_HISTORY),
    ]);
    const tallies = new Map(tallyDays.map((d, i) => [d, tallyRows[i] ?? {}]));
    const since = Number(sinceRaw) || null;
    const liveMap = parse<{ day?: string }>(currentRaw)?.day ?? utcDay(at);
    const history = historyFrom(historyRows ?? {});

    // --- Tallied ---
    const r = alive(tallies, 'runs', RUN_DAYS, false, at, since);
    add(runs, r.keys, r.bytes + r.keys * KEY_OVERHEAD);
    if (r.note) runs.note = r.note;
    const c = alive(tallies, 'comments', RUN_DAYS, false, at, since);
    const t = alive(tallies, 'takes', MAP_DAYS, true, at, since);
    add(records, c.keys + t.keys, c.bytes + t.bytes + (c.keys + t.keys) * KEY_OVERHEAD);
    if (c.note) records.note = c.note;

    // --- The maps still stored ---
    const mapDays = Array.from({ length: MAP_DAYS }, (_, back) => dayBefore(at, back)).filter(
      (d) => d <= liveMap
    );
    const measured = await Promise.all(
      mapDays.map(async (day) => {
        const [rows, land, meta, board, regions] = await Promise.all([
          redis.zRange(plotIndexKey(day), 0, PLOT_INDEX_LIMIT - 1, { by: 'rank' }),
          sampleIndex(landIndexKey(day)),
          redis.hGetAll(mapMetaKey(day)),
          redis.hGetAll(boardMetaKey(day)),
          redis.get(nextRegionKey(day)),
        ]);
        const placers = (rows ?? []).map((row) => row.member);
        const players = Math.max(placers.length, count(tallies.get(day), 'players:n'));
        // Past the index's cap, plots go on existing unlisted: count everyone as having one.
        const plotCount = placers.length >= PLOT_INDEX_LIMIT ? players : placers.length;
        const sample = spread(placers);
        const cells = land.members.flatMap((m) => {
          const [x, z] = m.split(',').map(Number);
          return Number.isInteger(x) && Number.isInteger(z) ? [cellKey(day, x!, z!)] : [];
        });
        const pages = Math.max(0, Number(board?.pages ?? 0) || 0);
        const boardKeys = [
          ...Array.from({ length: pages }, (_, i) => boardPageKey(day, i)),
          boardKeepsKey(day),
        ];
        const [plots, keeps, regionRows, held, boardLengths, feed] = await Promise.all([
          sampled(
            sample.map((u) => plotKey(day, u)),
            plotCount
          ),
          sampled(
            sample.map((u) => keepKey(day, u)),
            players
          ),
          sampled(
            sample.map((u) => regionKey(day, u)),
            players
          ),
          sampled(cells, land.count),
          Promise.all(boardKeys.map((k) => redis.strLen(k))),
          meta?.postId ? measureFeed(meta.postId) : Promise.resolve({ keys: 0, bytes: 0 }),
        ]);
        const owners = Math.max(0, Number(regions) || 0);
        return {
          day,
          placers,
          players,
          maps: {
            keys: plotCount + 2 * players + land.count + owners + 4,
            bytes:
              plots.bytes +
              keeps.bytes +
              regionRows.bytes +
              held.bytes +
              owners * stringBytes(regionOwnerKey(day, 0, 0), ID_LENGTH) +
              (owners > 0 ? stringBytes(nextRegionKey(day), 3) : 0) +
              zsetBytes(plotIndexKey(day), placers.length, mean(placers.map((p) => p.length))) +
              zsetBytes(landIndexKey(day), land.count, mean(land.members.map((m) => m.length))) +
              hashBytes(mapMetaKey(day), meta ?? {}),
            maxPlot: plots.max,
          },
          board: {
            keys: boardLengths.filter((n) => n > 0).length + (pages > 0 ? 1 : 0),
            bytes:
              boardKeys.reduce(
                (n, k, i) => n + (boardLengths[i]! > 0 ? stringBytes(k, boardLengths[i]!) : 0),
                0
              ) + hashBytes(boardMetaKey(day), board ?? {}),
            keepsRow: boardLengths[boardLengths.length - 1] ?? 0,
            maxPage: Math.max(0, ...boardLengths.slice(0, -1)),
          },
          feed,
        };
      })
    );
    const ids = new Set<string>();
    let capped = false;
    for (const m of measured) {
      for (const p of m.placers) ids.add(p);
      if (m.placers.length >= PLOT_INDEX_LIMIT) capped = true;
      add(maps, m.maps.keys, m.maps.bytes);
      add(boards, m.board.keys, m.board.bytes);
      add(feeds, m.feed.keys, m.feed.bytes);
      big(`A plot, ${shortDay(m.day)}`, m.maps.maxPlot);
      big(`Board keeps, ${shortDay(m.day)}`, m.board.keepsRow);
      big(`A board page, ${shortDay(m.day)}`, m.board.maxPage);
    }
    maps.note = 'Sampled: a few dozen read per day, times how many there are.';
    const complete = measured.filter((m) => m.day < liveMap && m.players > 0);
    const dailyPlayers = complete.length
      ? mean(complete.map((m) => m.players))
      : (measured.find((m) => m.day === liveMap)?.players ?? 0);

    // --- Relay posts: the live one and those the history recorded ---
    const known = new Set<string>(relayNow ? [relayNow] : []);
    const oldest = dayBefore(at, RELAY_DAYS + 1);
    for (const e of history) if (e.relay && e.day >= oldest) known.add(e.relay);
    const relays = (
      await Promise.all(
        [...known].map(async (postId) => {
          const [metaRaw, towerCount, summary, players, playerIds] = await Promise.all([
            redis.get(relayMetaKey(postId)),
            redis.get(relayTowerCountKey(postId)),
            redis.hGetAll(relaySummaryKey(postId)),
            sampledHash(relayPlayersKey(postId)),
            redis.hKeys(relayPlayersKey(postId)),
          ]);
          if (!metaRaw) return null;
          const meta = parse<{ day?: string; closed?: boolean }>(metaRaw);
          const towers = Array.from(
            { length: Math.max(0, Number(towerCount) || 0) },
            (_, i) => i + 1
          );
          const [lengths, crews, feed] = await Promise.all([
            Promise.all(towers.map((n) => redis.strLen(relayTowerKey(postId, n)))),
            Promise.all(towers.map((n) => redis.zCard(relayCrewKey(postId, n)))),
            measureFeed(postId),
          ]);
          const towerBytes = towers.reduce(
            (n, id, i) =>
              n + (lengths[i]! > 0 ? stringBytes(relayTowerKey(postId, id), lengths[i]!) : 0),
            0
          );
          const crewBytes = towers.reduce(
            (n, id, i) => n + zsetBytes(relayCrewKey(postId, id), crews[i]!, ID_LENGTH),
            0
          );
          return {
            postId,
            day: meta?.day ?? '',
            live: postId === relayNow,
            towers: {
              keys: lengths.filter((n) => n > 0).length + crews.filter((n) => n > 0).length + 3,
              bytes:
                towerBytes +
                crewBytes +
                stringBytes(relayMetaKey(postId), metaRaw.length) +
                stringBytes(relayTowerCountKey(postId), String(towers.length).length) +
                hashBytes(relaySummaryKey(postId), summary ?? {}),
            },
            players,
            playerIds: playerIds ?? [],
            feed,
            maxTower: Math.max(0, ...lengths),
          };
        })
      )
    ).filter((x) => x !== null);
    for (const relay of relays) {
      add(relayTowers, relay.towers.keys, relay.towers.bytes);
      add(relayPlayers, relay.players.fields > 0 ? 1 : 0, relay.players.bytes);
      add(feeds, relay.feed.keys, relay.feed.bytes);
      for (const id of relay.playerIds) ids.add(id);
      const when = relay.day ? shortDay(relay.day) : 'relay';
      // The day's close reads the whole players hash at once.
      big(`Relay players, ${when}`, relay.players.bytes);
      big(`A relay tower, ${when}`, relay.maxTower);
    }
    // A relay post a day, for as many days as the game has had maps. The ones the history missed
    // (from before it kept them) are taken to be the size of those measured.
    const expected = Math.min(RELAY_DAYS, measured.filter((m) => m.players > 0).length);
    const missing = Math.max(0, expected - relays.length);
    if (missing > 0 && relays.length > 0) {
      const like = relays.some((x) => !x.live) ? relays.filter((x) => !x.live) : relays;
      add(
        relayTowers,
        missing * mean(like.map((x) => x.towers.keys)),
        missing * mean(like.map((x) => x.towers.bytes))
      );
      add(relayPlayers, missing, missing * mean(like.map((x) => x.players.bytes)));
      const note = `Found ${relays.length} of ${expected} days' posts; the rest taken to be their size.`;
      relayTowers.note = note;
      relayPlayers.note = note;
    }

    // --- Player records: everyone the maps and relays still list ---
    const sample = spread([...ids]);
    const records30 = await Promise.all(sample.map((id) => redis.hGetAll(userKey(id))));
    const userSizes = sample.flatMap((id, i) => {
      const bytes = hashBytes(userKey(id), records30[i] ?? {});
      return bytes > 0 ? [bytes] : [];
    });
    add(users, ids.size, Math.round(mean(userSizes) * ids.size));
    users.note =
      `Players seen in the last ${MAP_DAYS} days, sampled; records last ${USER_DAYS}, so this is a floor` +
      (capped ? ', and a day past the map index cap undercounts it.' : '.');

    // --- Awards, flair, notifications ---
    const awardDays = Array.from({ length: USER_DAYS + 1 }, (_, back) => dayBefore(at, back));
    const awardRows = await Promise.all(
      awardDays.map(async (day) => {
        const [won, holders, work] = await Promise.all([
          redis.hGetAll(awardsKey(day)),
          sampledHash(awardHoldersKey(day)),
          sampledHash(awardWorkKey(day)),
        ]);
        return { day, won: hashBytes(awardsKey(day), won ?? {}), holders, work };
      })
    );
    for (const a of awardRows) {
      add(
        awards,
        (a.won > 0 ? 1 : 0) + (a.holders.fields > 0 ? 1 : 0) + (a.work.fields > 0 ? 1 : 0),
        a.won + a.holders.bytes + a.work.bytes
      );
      big(`Awards, ${shortDay(a.day)}`, a.won);
    }
    const [played, hours, lastAward] = await Promise.all([
      redis.zCard(FLAIR_PLAYED),
      Promise.all(Array.from({ length: 24 }, (_, h) => redis.zCard(notifyHourKey(h)))),
      redis.get(AWARDS_LAST),
    ]);
    add(awards, played > 0 ? 1 : 0, zsetBytes(FLAIR_PLAYED, played, ID_LENGTH));
    hours.forEach((n, h) => add(notify, n > 0 ? 1 : 0, zsetBytes(notifyHourKey(h), n, ID_LENGTH)));
    notify.note = 'The 24 hour lists, counted; the two-day push logs beside them are not.';

    // --- Everything else: pointers, and this report's own records ---
    for (const [key, raw] of [
      [MAP_CURRENT, currentRaw],
      [RELAY_CURRENT, relayNow],
      [AWARDS_LAST, lastAward],
      [STORAGE_TALLY_SINCE, sinceRaw],
    ] as const) {
      if (raw) add(other, 1, stringBytes(key, raw.length));
    }
    add(other, history.length > 0 ? 1 : 0, hashBytes(STORAGE_HISTORY, historyRows ?? {}));
    for (const [day, row] of tallies) {
      if (Object.keys(row).length > 0) add(other, 1, hashBytes(storageTallyKey(day), row));
    }

    const families = [
      runs,
      users,
      maps,
      boards,
      relayTowers,
      relayPlayers,
      feeds,
      records,
      awards,
      notify,
      other,
    ]
      .map((f) => ({ ...f, keys: Math.round(f.keys), bytes: Math.round(f.bytes) }))
      .sort((a, b) => b.bytes - a.bytes);
    const bytes = families.reduce((n, f) => n + f.bytes, 0);
    const keys = families.reduce((n, f) => n + f.keys, 0);
    const growing = families.filter((f) => f.scales).reduce((n, f) => n + f.bytes, 0);
    const perPlayer = dailyPlayers > 0 ? growing / dailyPlayers : 0;
    return {
      at,
      bytes,
      keys,
      families,
      dailyPlayers,
      perPlayer,
      capacity:
        perPlayer > 0
          ? Math.max(0, Math.floor((STORAGE_LIMIT_BYTES - (bytes - growing)) / perPlayer))
          : null,
      largest,
      relayPost: relayNow ?? null,
    };
  },

  /** Keep a report's totals as the day's entry in the history, and let entries past 90 days go. */
  async remember(report: StorageReport): Promise<void> {
    const day = utcDay(report.at);
    const entry: Omit<StorageHistoryEntry, 'day'> = {
      bytes: report.bytes,
      keys: report.keys,
      players: Math.round(report.dailyPlayers),
      relay: report.relayPost,
    };
    await redis.hSet(STORAGE_HISTORY, { [day]: JSON.stringify(entry) });
    const oldest = dayBefore(report.at, HISTORY_DAYS);
    const stale = ((await redis.hKeys(STORAGE_HISTORY)) ?? []).filter((d) => d < oldest);
    if (stale.length > 0) await redis.hDel(STORAGE_HISTORY, stale);
  },

  /** Every day's totals the history holds, oldest first. */
  async history(): Promise<StorageHistoryEntry[]> {
    return historyFrom((await redis.hGetAll(STORAGE_HISTORY)) ?? {});
  },

  /** The report as a read-only form, which is what a menu item can show. */
  form(report: StorageReport, history: readonly StorageHistoryEntry[]): Form {
    const line = (name: string, label: string, value: string, helpText?: string): FormField => ({
      type: 'string',
      name,
      label,
      defaultValue: value,
      disabled: true,
      ...(helpText ? { helpText } : {}),
    });

    const room: FormField[] = [
      line(
        'players',
        'Players a day',
        report.dailyPlayers > 0 ? whole(report.dailyPlayers) : 'None yet',
        "Who started on the map, averaged over the last two weeks' complete days."
      ),
    ];
    if (report.capacity !== null) {
      room.push(line('perPlayer', 'Kept per daily player', bytesText(report.perPlayer)));
      room.push(
        line(
          'capacity',
          `${bytesText(STORAGE_LIMIT_BYTES)} holds`,
          `About ${whole(report.capacity)} players a day`
        )
      );
    }
    if (report.largest) {
      room.push(
        line(
          'largest',
          'Largest single value',
          bytesText(report.largest.bytes),
          `${report.largest.label}: ${share(report.largest.bytes, REQUEST_LIMIT_BYTES)} of the ` +
            `${bytesText(REQUEST_LIMIT_BYTES)} one Redis request can carry.`
        )
      );
    }

    const today = utcDay(report.at);
    const before = history.filter((e) => e.day < today).reverse();
    const ago = (days: number) => before.find((e) => e.day <= dayBefore(report.at, days)) ?? null;
    const yesterday = ago(1);
    const week = ago(7);
    const trend: FormField[] = [];
    if (yesterday)
      trend.push(line('yesterday', shortDay(yesterday.day), bytesText(yesterday.bytes)));
    if (week && week.day !== yesterday?.day) {
      const days = Math.max(
        1,
        Math.round(
          (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${week.day}T00:00:00Z`)) / DAY_MS
        )
      );
      const change = (report.bytes - week.bytes) / days;
      trend.push(
        line(
          'week',
          shortDay(week.day),
          bytesText(week.bytes),
          `${change >= 0 ? '+' : '−'}${bytesText(Math.abs(change))} a day since.`
        )
      );
    }

    const fields: FormField[] = [
      {
        type: 'group',
        label: 'Room',
        helpText:
          'If the next weeks look like the last two. Maps and relays are kept 14 days, runs and player records 30.',
        fields: room,
      },
    ];
    if (trend.length > 0) fields.push({ type: 'group', label: 'Before', fields: trend });
    fields.push({
      type: 'group',
      label: 'What uses it',
      fields: report.families
        .filter((f) => f.bytes > 0 || f.note)
        .map((f, i) =>
          line(`family${i}`, f.label, `${bytesText(f.bytes)} in ${whole(f.keys)} keys`, f.note)
        ),
    });

    return {
      title: 'Redis storage',
      description:
        `About ${bytesText(report.bytes)} of the ${bytesText(STORAGE_LIMIT_BYTES)} Devvit lets this install keep ` +
        `(${share(report.bytes, STORAGE_LIMIT_BYTES)}). Past it, writes can fail, and Reddit says it will get in touch.`,
      fields,
      acceptLabel: 'Done',
    };
  },
};
