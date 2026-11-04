import { context, reddit, redis } from '@devvit/web/server';
import type { PlayerGrid } from '../../shared/types/api';
import { FACTION_IDS } from '../../shared/types/factions';
import {
  MAX_EXPIRE_SECONDS,
  type KeyMeaning,
  type RedisType,
  type StorageAction,
  type StorageActionResult,
  type StorageKeyDetail,
  type StorageKeyRow,
  type StorageListing,
  type StorageOverview,
  type StorageScope,
  type WriteHealth,
} from '../../shared/types/storage';
import { regionCoordForIndex } from '../../shared/types/worldGrid';
import {
  AWARDS_LAST,
  FLAIR_PLAYED,
  LAND_INDEX_LIMIT,
  LEGACY_MAP,
  MAP_CURRENT,
  PLOT_INDEX_LIMIT,
  POST_FLAIR_DONE,
  RELAY_CURRENT,
  SCORE_BOARD,
  STORAGE_HISTORY,
  STORAGE_PROBE,
  STORAGE_TALLY_SINCE,
  USER_DATA_TTL_SECONDS,
  awardHoldersKey,
  awardWorkKey,
  awardsKey,
  boardBuildLockKey,
  boardKeepsKey,
  boardMetaKey,
  boardPageKey,
  cellKey,
  factionHomeKey,
  feedKey,
  keepKey,
  landIndexKey,
  mapMetaKey,
  mapOpenLockKey,
  nextRegionKey,
  notifyHourKey,
  plotIndexKey,
  plotKey,
  postFlairTemplateKey,
  regionKey,
  regionOwnerKey,
  relayCrewKey,
  relayLegacyLobbyKey,
  relayLegacyStateKey,
  relayMetaKey,
  relayPlayersKey,
  relaySummaryKey,
  relayTowerCountKey,
  relayTowerKey,
  runKey,
  runSavedKey,
  saidKey,
  scoresThreadKey,
  scoresThreadLockKey,
  storageTallyKey,
  tookKey,
  userKey,
} from './keys';
import {
  ITEM_OVERHEAD,
  KEY_OVERHEAD,
  REQUEST_LIMIT_BYTES,
  STORAGE_LIMIT_BYTES,
  Storage,
  mapGoes,
} from './storage';

/**
 * The moderators' storage dashboard (`/api/storage/*`, the `storage` web view).
 *
 * The menu's report is a form, which is all a menu item can show; this is the same report with
 * room to show it, and the means to act on it. Three things it adds:
 *
 * - Whether Redis is taking writes at all, from a probe rather than a guess. Past its quota Devvit
 *   blocks every write for the install until Reddit lifts it, and nothing else says so.
 * - What the report cannot see. Nothing lists keys, so a key no index points at is invisible; but
 *   while writes are blocked for the quota, usage is the quota at least, and the difference is a
 *   floor on what is hidden.
 * - Every key a day's map or a relay post holds, sized and with its expiry, any key by name, and
 *   the changes a moderator may make: delete or expire a key, drop a closed day whole.
 *
 * Every read here is safe while writes are blocked. Nothing on the way to a page writes, except
 * the probe and the history entry, and both are allowed to fail.
 */

/** Listing rows sent: the biggest, the rest summed. */
const LISTING_ROWS = 200;

/** Reads in flight at once while measuring a listing. */
const MEASURE_BATCH = 200;

/** Keys a drop deletes per DEL, and DELs in flight at once. */
const DROP_BATCH = 50;
const DROP_PARALLEL = 10;

/** How long a moderator check holds, ms: a dashboard makes a request a tap. */
const MOD_CHECK_MS = 5 * 60_000;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const POST_RE = /^t3_[a-z0-9]{1,16}$/;

/**
 * Keys the app wrote and can no longer name, and when they go. On 2 Nov 2026 Reddit blocked
 * writes for r/stonefall: since 31 Oct every board rebuild had written its pages under a random
 * generation kept for the map's fortnight, and those that died or overlapped left whole boards
 * behind (fixed in 25f36bd). They expire with their maps; the last of them with 2 Nov's.
 */
const KNOWN_LEAKS: ReadonlyArray<{ lastMap: string; what: string }> = [
  {
    lastMap: '2026-11-02',
    what: 'board copies that rebuilds left behind between 31 Oct and 2 Nov',
  },
];

const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const dayBefore = (ms: number, back: number): string => utcDay(ms - back * 86_400_000);
const mean = (xs: readonly number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

const parse = <T>(raw: string | null | undefined): T | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));
const isQuota = (text: string): boolean => /RESOURCE_EXHAUSTED|quota/i.test(text);

/** Up to `n` items spread across a list, rather than all from its front. */
const spread = <T>(items: readonly T[], n: number): T[] =>
  items.length <= n
    ? [...items]
    : Array.from({ length: n }, (_, i) => items[Math.floor((i * items.length) / n)]!);

const inBatches = async <T, R>(
  items: readonly T[],
  size: number,
  each: (item: T) => Promise<R>
): Promise<R[]> => {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(each))));
  }
  return out;
};

/** A key to measure, the type it is known to be, and what to call its kind in a listing. */
interface Probe {
  key: string;
  type: Exclude<RedisType, 'none'>;
  group: string;
}

/** A key's length and footprint as the report counts them; null where it is gone. */
const measureOne = async (p: Probe): Promise<(StorageKeyRow & { group: string }) | null> => {
  if (p.type === 'string') {
    const n = await redis.strLen(p.key);
    if (!(n > 0)) return null;
    return { ...rowOf(p, n, p.key.length + n + KEY_OVERHEAD) };
  }
  if (p.type === 'hash') {
    const n = await redis.hLen(p.key);
    if (!(n > 0)) return null;
    const page = await redis.hScan(p.key, 0, undefined, 20);
    const sizes = (page?.fieldValues ?? []).map(
      (fv) => fv.field.length + fv.value.length + ITEM_OVERHEAD
    );
    return rowOf(p, n, p.key.length + KEY_OVERHEAD + Math.round(mean(sizes) * n));
  }
  const n = await redis.zCard(p.key);
  if (!(n > 0)) return null;
  const rows = await redis.zRange(p.key, 0, 19, { by: 'rank' });
  const len = mean((rows ?? []).map((r) => r.member.length));
  return rowOf(p, n, p.key.length + KEY_OVERHEAD + Math.round(n * (len + 8 + ITEM_OVERHEAD)));
};

const rowOf = (p: Probe, length: number, bytes: number): StorageKeyRow & { group: string } => ({
  key: p.key,
  type: p.type,
  length,
  bytes,
  expiresAt: null,
  group: p.group,
});

/** When a key expires, ms; null for never or gone. */
const expiresAt = async (key: string): Promise<number | null> => {
  const s = await redis.expireTime(key);
  return s > 0 ? s * 1000 : null;
};

/** Every probe measured, the biggest first, the top ones with their expiry. */
const listingOf = async (
  title: string,
  probes: readonly Probe[],
  note: string | null
): Promise<StorageListing> => {
  const unique = [...new Map(probes.map((p) => [p.key, p])).values()];
  const measured = (await inBatches(unique, MEASURE_BATCH, measureOne)).filter(
    (r): r is StorageKeyRow & { group: string } => r !== null
  );
  measured.sort((a, b) => b.bytes - a.bytes);
  const shown = measured.slice(0, LISTING_ROWS);
  const expiries = await inBatches(shown, MEASURE_BATCH, (r) => expiresAt(r.key));
  const groups = new Map<string, { label: string; keys: number; bytes: number }>();
  for (const r of measured) {
    const g = groups.get(r.group) ?? { label: r.group, keys: 0, bytes: 0 };
    g.keys++;
    g.bytes += r.bytes;
    groups.set(r.group, g);
  }
  return {
    title,
    rows: shown.map(({ group: _group, ...r }, i) => ({ ...r, expiresAt: expiries[i] ?? null })),
    groups: [...groups.values()].sort((a, b) => b.bytes - a.bytes),
    total: measured.length,
    bytes: measured.reduce((n, r) => n + r.bytes, 0),
    note,
  };
};

/** Everything a day's map holds that can be found from its indexes, and the runs standing on it. */
const mapProbes = async (day: string): Promise<{ probes: Probe[]; sessions: string[] }> => {
  const [meta, board, placers, land] = await Promise.all([
    redis.hGetAll(mapMetaKey(day)),
    redis.hGetAll(boardMetaKey(day)),
    redis.zRange(plotIndexKey(day), 0, PLOT_INDEX_LIMIT - 1, { by: 'rank' }),
    redis.zRange(landIndexKey(day), 0, LAND_INDEX_LIMIT - 1, { by: 'rank' }),
  ]);
  const players = (placers ?? []).map((r) => r.member);
  const probes: Probe[] = [
    { key: mapMetaKey(day), type: 'hash', group: 'Map record' },
    { key: mapOpenLockKey(day), type: 'string', group: 'Locks' },
    { key: plotIndexKey(day), type: 'zset', group: 'Indexes' },
    { key: landIndexKey(day), type: 'zset', group: 'Indexes' },
    { key: nextRegionKey(day), type: 'string', group: 'Regions' },
    { key: boardMetaKey(day), type: 'hash', group: 'Board' },
    { key: boardKeepsKey(day), type: 'string', group: 'Board' },
    { key: boardBuildLockKey(day), type: 'string', group: 'Locks' },
    ...FACTION_IDS.map((f) => ({
      key: factionHomeKey(day, f),
      type: 'string' as const,
      group: 'Regions',
    })),
  ];
  const pages = Math.max(0, Number(board?.pages ?? 0) || 0);
  for (let i = 0; i < pages; i++) {
    probes.push({ key: boardPageKey(day, i, board?.gen), type: 'string', group: 'Board' });
  }
  for (const u of players) {
    probes.push(
      { key: plotKey(day, u), type: 'string', group: 'Plots' },
      { key: keepKey(day, u), type: 'string', group: 'Keeps' },
      { key: regionKey(day, u), type: 'string', group: 'Regions' }
    );
  }
  for (const row of land ?? []) {
    const [x, z] = row.member.split(',').map(Number);
    if (Number.isInteger(x) && Number.isInteger(z)) {
      probes.push({ key: cellKey(day, x!, z!), type: 'string', group: 'Held land' });
    }
  }
  const [regions, plots] = await Promise.all([
    inBatches(chunk(players, 100), 10, (ids) => redis.mGet(ids.map((u) => regionKey(day, u)))),
    inBatches(chunk(players, 100), 10, (ids) => redis.mGet(ids.map((u) => plotKey(day, u)))),
  ]);
  for (const raw of regions.flat()) {
    const index = Number(raw);
    if (!raw || !Number.isInteger(index) || index < 0) continue;
    const { rx, rz } = regionCoordForIndex(index);
    probes.push({ key: regionOwnerKey(day, rx, rz), type: 'string', group: 'Regions' });
  }
  const sessions = new Set<string>();
  for (const raw of plots.flat()) {
    for (const p of parse<PlayerGrid>(raw)?.placements ?? []) {
      if (typeof p.sessionId === 'string' && p.sessionId) sessions.add(p.sessionId);
    }
  }
  for (const s of sessions) {
    probes.push(
      { key: tookKey(day, s), type: 'string', group: 'Take and comment records' },
      { key: saidKey(day, s), type: 'string', group: 'Take and comment records' }
    );
  }
  if (meta?.postId) probes.push(...postProbes(meta.postId));
  return { probes, sessions: [...sessions] };
};

const postProbes = (postId: string): Probe[] => [
  { key: feedKey(postId), type: 'zset', group: 'Score feed' },
  { key: scoresThreadKey(postId), type: 'string', group: 'Score feed' },
  { key: scoresThreadLockKey(postId), type: 'string', group: 'Locks' },
];

const relayProbes = async (postId: string): Promise<Probe[]> => {
  const towers = Math.max(1, Number(await redis.get(relayTowerCountKey(postId))) || 1);
  const probes: Probe[] = [
    { key: relayMetaKey(postId), type: 'string', group: 'Relay record' },
    { key: relayTowerCountKey(postId), type: 'string', group: 'Relay record' },
    { key: relaySummaryKey(postId), type: 'hash', group: 'Tower summaries' },
    { key: relayPlayersKey(postId), type: 'hash', group: 'Players' },
    { key: relayLegacyStateKey(postId), type: 'string', group: 'From before crews' },
    { key: relayLegacyLobbyKey(postId), type: 'zset', group: 'From before crews' },
    ...postProbes(postId),
  ];
  for (let n = 1; n <= towers; n++) {
    probes.push(
      { key: relayTowerKey(postId, n), type: 'string', group: 'Towers' },
      { key: relayCrewKey(postId, n), type: 'zset', group: 'Crews' }
    );
  }
  return probes;
};

const chunk = <T>(items: readonly T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / n) }, (_, i) => items.slice(i * n, i * n + n));

/** The live map's day, from its pointer. */
const liveMap = async (): Promise<string | null> =>
  parse<{ day?: string }>(await redis.get(MAP_CURRENT))?.day ?? null;

/**
 * What a key is for, from its name, as keys.ts declares it. `D` stands for a day, so one pattern
 * covers every day's map.
 */
const MEANINGS: ReadonlyArray<[RegExp, Omit<KeyMeaning, 'vital'> & { vital?: boolean }]> = (() => {
  const D = '\\d{4}-\\d{2}-\\d{2}';
  const map = (rest: string) => new RegExp(`^map:${D}:${rest}$`);
  const mapLife = '14 days after its map opened';
  return [
    [
      /^run:[^:]+:counted$/,
      { family: 'Runs', what: 'Guard so a run is counted once', lifetime: '30 days' },
    ],
    [
      /^run:[^:]+$/,
      {
        family: 'Runs',
        what: 'A verified run: its blocks, score and who built it',
        lifetime: '30 days after it was played',
      },
    ],
    [
      /^user:[^:]+$/,
      {
        family: 'Player records',
        what: "A player's record: name, best, XP, colour, settings",
        lifetime: "30 days after the player's last write",
      },
    ],
    [
      /^map:current$/,
      {
        family: 'Pointers',
        what: "Which day's map is live. The game reads it on every request; without it nothing finds today's map until the daily job",
        lifetime: 'Never expires',
        vital: true,
      },
    ],
    [
      map('meta'),
      {
        family: 'Plots, keeps and land',
        what: "A map's record: its post, when it opened and closed",
        lifetime: mapLife,
      },
    ],
    [
      map('opening'),
      {
        family: 'Locks',
        what: "Held for a minute while a day's post is made",
        lifetime: 'A minute',
      },
    ],
    [
      map('user:.+:region'),
      { family: 'Plots, keeps and land', what: 'The region a player builds in', lifetime: mapLife },
    ],
    [
      map('home:.+'),
      { family: 'Plots, keeps and land', what: "A colour's keep region", lifetime: mapLife },
    ],
    [
      map('region:.+:owner'),
      { family: 'Plots, keeps and land', what: 'Who a region was handed to', lifetime: mapLife },
    ],
    [
      map('next_region'),
      { family: 'Plots, keeps and land', what: 'The next region to hand out', lifetime: mapLife },
    ],
    [
      map('plot:.+'),
      {
        family: 'Plots, keeps and land',
        what: "A player's placements on the map",
        lifetime: mapLife,
      },
    ],
    [
      map('index:plots'),
      {
        family: 'Plots, keeps and land',
        what: 'Everyone who built on the map: how plots are found',
        lifetime: mapLife,
      },
    ],
    [
      map('keep:.+'),
      {
        family: 'Plots, keeps and land',
        what: "A player's keep: owner, colour, centre",
        lifetime: mapLife,
      },
    ],
    [
      map('cell:.+'),
      { family: 'Plots, keeps and land', what: 'Who holds a land cell', lifetime: mapLife },
    ],
    [
      map('index:land'),
      {
        family: 'Plots, keeps and land',
        what: 'Every held cell: how cells are found',
        lifetime: mapLife,
      },
    ],
    [
      map('board:page:.+'),
      {
        family: 'Map boards',
        what: 'A page of the shared board, as served',
        lifetime: '2 minutes until the board points at it, then 3 hours',
      },
    ],
    [
      map('board:keeps'),
      { family: 'Map boards', what: "The board's keeps, as one row", lifetime: mapLife },
    ],
    [
      map('board:meta'),
      {
        family: 'Map boards',
        what: 'Which board pages are current; deleting it makes the next read rebuild',
        lifetime: mapLife,
      },
    ],
    [
      map('board:building'),
      { family: 'Locks', what: 'Held by the request rebuilding the board', lifetime: '30 seconds' },
    ],
    [
      map('took:.+'),
      { family: 'Comment and take records', what: 'Who a take toppled', lifetime: mapLife },
    ],
    [
      map('said:.+'),
      {
        family: 'Comment and take records',
        what: 'The comment a run was announced in',
        lifetime: mapLife,
      },
    ],
    [
      /^lb:score$/,
      {
        family: 'Retired',
        what: 'The old score table; the retirement job deletes it',
        lifetime: 'Never expires',
      },
    ],
    [
      /^post:[^:]+:brags$/,
      {
        family: 'Score feeds',
        what: "A post's feed of announced runs",
        lifetime: '14 days after its last score',
      },
    ],
    [
      /^post:[^:]+:scores$/,
      {
        family: 'Score feeds',
        what: "The id of the app's pinned scores comment",
        lifetime: '14 days after its last score',
      },
    ],
    [
      /^post:[^:]+:scores:opening$/,
      { family: 'Locks', what: 'Held while the pinned comment is made', lifetime: 'A minute' },
    ],
    [
      /^brag:session:.+$/,
      {
        family: 'Comment and take records',
        what: 'Guard so a run is commented once',
        lifetime: '30 days',
      },
    ],
    [
      /^relay:current$/,
      {
        family: 'Pointers',
        what: "Today's relay post. Without it the relay and the map's link to it are gone until the daily job",
        lifetime: 'Never expires',
        vital: true,
      },
    ],
    [
      /^relay:[^:]+:meta$/,
      {
        family: 'Relay towers',
        what: "A relay post's record: its day, whether it closed",
        lifetime: '14 days after its last turn',
      },
    ],
    [
      /^relay:[^:]+:tower_count$/,
      {
        family: 'Relay towers',
        what: 'How many towers the post has',
        lifetime: '14 days after its last turn',
      },
    ],
    [
      /^relay:[^:]+:tower:\d+$/,
      {
        family: 'Relay towers',
        what: 'One relay tower: blocks, turn, tally',
        lifetime: '14 days after its last turn',
      },
    ],
    [
      /^relay:[^:]+:towers$/,
      {
        family: 'Relay towers',
        what: "Every tower's summary, for the pager",
        lifetime: '14 days after its last turn',
      },
    ],
    [
      /^relay:[^:]+:crew:\d+$/,
      {
        family: 'Relay towers',
        what: "A tower's seated crew",
        lifetime: 'Trimmed on every heartbeat',
      },
    ],
    [
      /^relay:[^:]+:players$/,
      {
        family: 'Relay players',
        what: 'Everyone seen on the post that day',
        lifetime: '14 days after its last turn',
      },
    ],
    [
      /^relay:[^:]+:(lobby|state)$/,
      {
        family: 'Relay towers',
        what: 'From before relay crews; read once to migrate',
        lifetime: '14 days',
      },
    ],
    [
      /^notify:hour:\d+$/,
      {
        family: 'Notifications',
        what: 'Who wants a push at this UTC hour',
        lifetime: 'Trimmed of anyone gone 30 days',
      },
    ],
    [
      /^notify:log:.+$/,
      {
        family: 'Notifications',
        what: "A player's pushes in the last day",
        lifetime: 'Two days after the last',
      },
    ],
    [
      new RegExp(`^notify:${D}:.+$`),
      { family: 'Notifications', what: 'One push of a kind sent that day', lifetime: 'Two days' },
    ],
    [
      /^awards:last$/,
      {
        family: 'Awards and flair',
        what: 'The day whose awards were handed out last',
        lifetime: 'Never expires',
      },
    ],
    [
      new RegExp(`^awards:${D}(:holders|:work)?$`),
      {
        family: 'Awards and flair',
        what: "A day's awards, who holds them, or the flairs still to change",
        lifetime: '30 days',
      },
    ],
    [
      /^flair:played$/,
      {
        family: 'Awards and flair',
        what: 'Players by the last day they played, for streak flair',
        lifetime: 'Trimmed daily',
      },
    ],
    [
      /^post-flair:[^:]+:template$/,
      {
        family: 'Everything else',
        what: "The subreddit's post flair template for a kind of post",
        lifetime: 'Never expires',
      },
    ],
    [
      /^migrations:.+$/,
      {
        family: 'Everything else',
        what: 'A one-time job that has run, or where it got to',
        lifetime: 'Never expires',
      },
    ],
    [
      /^storage:tally:since$/,
      {
        family: 'Everything else',
        what: 'When the storage report began counting writes',
        lifetime: 'Never expires',
      },
    ],
    [
      new RegExp(`^storage:tally:${D}$`),
      {
        family: 'Everything else',
        what: 'What a day wrote to keys nothing lists, for the report',
        lifetime: '32 days',
      },
    ],
    [
      /^storage:history$/,
      {
        family: 'Everything else',
        what: "The report's daily totals, for the trend",
        lifetime: '90 days of entries',
      },
    ],
    [
      /^storage:probe$/,
      { family: 'Everything else', what: "The dashboard's write check", lifetime: 'A minute' },
    ],
    [
      /^(index:(plots|land|grids|towers_by_time)|board:(page:\d+|keeps|meta)|counters:next_region|post:map|plot:.+|keep:.+|cell:.+|region:.+:owner)$/,
      {
        family: 'Retired',
        what: 'From before maps were daily; the purge and retirement tools clear these',
        lifetime: 'Never expires',
      },
    ],
  ];
})();

const meaningOf = (key: string): KeyMeaning | null => {
  for (const [re, m] of MEANINGS) if (re.test(key)) return { vital: false, ...m };
  return null;
};

const modChecks = new Map<string, { ok: boolean; until: number }>();

export const StorageDesk = {
  /** Whether `username` moderates the install's subreddit. Asked of Reddit, held for minutes. */
  async isModerator(username: string): Promise<boolean> {
    const subredditName = context.subredditName;
    if (!subredditName || !username) return false;
    const held = modChecks.get(username);
    if (held && held.until > Date.now()) return held.ok;
    const mods = await reddit.getModerators({ subredditName, username }).all();
    const ok = mods.some((m) => m.username.toLowerCase() === username.toLowerCase());
    modChecks.set(username, { ok, until: Date.now() + MOD_CHECK_MS });
    return ok;
  },

  /** Set a value for a minute, then delete it: whether Redis takes writes, and deletes. */
  async probe(): Promise<WriteHealth> {
    const checkedAt = Date.now();
    let error: string | null = null;
    let set = false;
    let del = false;
    try {
      await redis.set(STORAGE_PROBE, String(checkedAt), {
        expiration: new Date(checkedAt + 60_000),
      });
      set = true;
    } catch (err) {
      error = message(err);
    }
    try {
      await redis.del(STORAGE_PROBE);
      del = true;
    } catch (err) {
      error ??= message(err);
    }
    return { checkedAt, set, del, error, quota: error !== null && isQuota(error) };
  },

  /** The whole page: the report, its history, whether writes go through, and what is unseen. */
  async overview(): Promise<StorageOverview> {
    const [report, history, writes] = await Promise.all([
      Storage.report(),
      Storage.history(),
      this.probe(),
    ]);
    // The trend needs a point a day. It is a write, so it is skipped when writes are failing.
    if (writes.set) {
      await Storage.remember(report).catch((err) =>
        console.error('storage: could not keep the day in the history', err)
      );
    }
    let unseen: StorageOverview['unseen'] = null;
    if (writes.quota) {
      const leaks = KNOWN_LEAKS.filter((l) => mapGoes(l.lastMap) > report.at);
      const goneBy = leaks.length
        ? utcDay(Math.max(...leaks.map((l) => mapGoes(l.lastMap))))
        : null;
      unseen = {
        atLeast: Math.max(0, STORAGE_LIMIT_BYTES - report.bytes),
        goneBy,
        note: leaks.length
          ? `Most likely the ${leaks.map((l) => l.what).join(' and ')}. Nothing lists them, so ` +
            'they cannot be deleted from here; they expire with their maps.'
          : 'Keys no index points at, so the report cannot name them. Usage is at the limit ' +
            'while writes are blocked for the quota, so this much at least is hidden.',
      };
    }
    return {
      at: report.at,
      subreddit: context.subredditName ?? '',
      limit: STORAGE_LIMIT_BYTES,
      requestLimit: REQUEST_LIMIT_BYTES,
      bytes: report.bytes,
      keys: report.keys,
      unseen,
      writes,
      families: report.families,
      dailyPlayers: report.dailyPlayers,
      perPlayer: report.perPlayer,
      capacity: report.capacity,
      largest: report.largest,
      history: history.map(({ day, bytes, keys, players }) => ({ day, bytes, keys, players })),
      releases: report.releases,
      maps: report.maps,
      relays: report.relays,
    };
  },

  /** Every key in a scope that can be found, measured, the biggest first. */
  async listing(scope: StorageScope): Promise<StorageListing> {
    if (scope.kind === 'map') {
      const { probes, sessions } = await mapProbes(scope.day);
      return listingOf(
        `Map, ${scope.day}`,
        probes,
        sessions.length > 0
          ? `${sessions.length.toLocaleString('en-US')} runs stand on this map. They are counted ` +
              'under Runs, and a drop deletes them with it.'
          : null
      );
    }
    if (scope.kind === 'relay') {
      return listingOf(`Relay post ${scope.postId}`, await relayProbes(scope.postId), null);
    }
    const now = Date.now();
    switch (scope.family) {
      case 'users': {
        const ids = await this.knownPlayers();
        const sample = spread(ids, LISTING_ROWS);
        const listing = await listingOf(
          'Player records',
          sample.map((u) => ({ key: userKey(u), type: 'hash' as const, group: 'Player records' })),
          `${ids.length.toLocaleString('en-US')} players are on today's map and relay` +
            (sample.length < ids.length
              ? `; ${sample.length} of them, spread across, are read.`
              : '.') +
            ' Records of anyone else are listed nowhere and go 30 days after their last write.'
        );
        return listing;
      }
      case 'runs': {
        const day = await liveMap();
        const players = day
          ? spread(
              (
                (await redis.zRange(plotIndexKey(day), 0, PLOT_INDEX_LIMIT - 1, { by: 'rank' })) ??
                []
              ).map((r) => r.member),
              LISTING_ROWS
            )
          : [];
        const plots = day ? await redis.mGet(players.map((u) => plotKey(day, u))) : [];
        const sessions = new Set<string>();
        for (const raw of plots ?? []) {
          for (const p of parse<PlayerGrid>(raw)?.placements ?? []) sessions.add(p.sessionId);
        }
        const sample = spread([...sessions], LISTING_ROWS);
        return listingOf(
          'Runs',
          sample.flatMap((s) => [
            { key: runKey(s), type: 'string' as const, group: 'Runs' },
            { key: runSavedKey(s), type: 'string' as const, group: 'Count-once guards' },
          ]),
          "Only runs standing on today's map can be found, so these are a sample. Every other run " +
            'is listed nowhere: the report counts them as they are written, and each goes 30 days ' +
            'after it was played.'
        );
      }
      case 'awards': {
        const days = Array.from({ length: USER_DATA_TTL_SECONDS / 86_400 + 1 }, (_, b) =>
          dayBefore(now, b)
        );
        return listingOf(
          'Awards and flair',
          [
            { key: AWARDS_LAST, type: 'string', group: 'Pointers' },
            { key: FLAIR_PLAYED, type: 'zset', group: 'Streak flair' },
            ...days.flatMap((d) => [
              { key: awardsKey(d), type: 'hash' as const, group: 'Awards won' },
              { key: awardHoldersKey(d), type: 'hash' as const, group: 'Holders' },
              { key: awardWorkKey(d), type: 'hash' as const, group: 'Flairs to change' },
            ]),
          ],
          null
        );
      }
      case 'notify':
        return listingOf(
          'Notifications',
          Array.from({ length: 24 }, (_, h) => ({
            key: notifyHourKey(h),
            type: 'zset' as const,
            group: 'Hour lists',
          })),
          "Each player's push log and sent marks are keyed by player and listed nowhere; they go two days after the last push."
        );
      case 'other':
        return listingOf(
          'Everything else',
          [
            { key: MAP_CURRENT, type: 'string', group: 'Pointers' },
            { key: RELAY_CURRENT, type: 'string', group: 'Pointers' },
            { key: STORAGE_TALLY_SINCE, type: 'string', group: 'Storage report' },
            { key: STORAGE_HISTORY, type: 'hash', group: 'Storage report' },
            { key: STORAGE_PROBE, type: 'string', group: 'Storage report' },
            ...Array.from({ length: 34 }, (_, b) => ({
              key: storageTallyKey(dayBefore(now, b)),
              type: 'hash' as const,
              group: 'Storage report',
            })),
            { key: SCORE_BOARD, type: 'zset', group: 'Retired' },
            { key: POST_FLAIR_DONE, type: 'string', group: 'Jobs' },
            { key: 'migrations:retire:cursor', type: 'string', group: 'Jobs' },
            { key: 'migrations:retired:2026-09', type: 'string', group: 'Jobs' },
            { key: postFlairTemplateKey('map'), type: 'string', group: 'Post flair' },
            { key: postFlairTemplateKey('relay'), type: 'string', group: 'Post flair' },
            { key: LEGACY_MAP.PLOT_INDEX, type: 'zset', group: 'Retired' },
            { key: LEGACY_MAP.LAND_INDEX, type: 'zset', group: 'Retired' },
            { key: LEGACY_MAP.BOARD_META, type: 'hash', group: 'Retired' },
            { key: LEGACY_MAP.BOARD_KEEPS, type: 'string', group: 'Retired' },
            { key: LEGACY_MAP.NEXT_REGION, type: 'string', group: 'Retired' },
            { key: LEGACY_MAP.MAP_POST, type: 'string', group: 'Retired' },
            { key: 'index:grids', type: 'zset', group: 'Retired' },
            { key: 'index:towers_by_time', type: 'zset', group: 'Retired' },
          ],
          null
        );
    }
  },

  /** Who today's map and relay know of: the players whose records can be found. */
  async knownPlayers(): Promise<string[]> {
    const [day, relay] = await Promise.all([liveMap(), redis.get(RELAY_CURRENT)]);
    const [placers, seated] = await Promise.all([
      day ? redis.zRange(plotIndexKey(day), 0, PLOT_INDEX_LIMIT - 1, { by: 'rank' }) : [],
      relay ? redis.hKeys(relayPlayersKey(relay)) : [],
    ]);
    return [...new Set([...(placers ?? []).map((r) => r.member), ...(seated ?? [])])];
  },

  /** One key by name: what it is, how big, when it goes, and the start of what it holds. */
  async inspect(key: string): Promise<StorageKeyDetail> {
    const type = ((await redis.type(key)) ?? 'none') as RedisType;
    const meaning = meaningOf(key);
    const base = { key, type, meaning, expiresAt: null, length: 0, bytes: 0 };
    if (type === 'string') {
      const [length, text, expires] = await Promise.all([
        redis.strLen(key),
        redis.getRange(key, 0, 3999),
        expiresAt(key),
      ]);
      return {
        ...base,
        exists: true,
        length,
        bytes: key.length + length + KEY_OVERHEAD,
        expiresAt: expires,
        preview: { kind: 'string', text: text ?? '' },
        truncated: length > 4000,
      };
    }
    if (type === 'hash') {
      const [length, page, expires] = await Promise.all([
        redis.hLen(key),
        redis.hScan(key, 0, undefined, 50),
        expiresAt(key),
      ]);
      const fields = (page?.fieldValues ?? []).slice(0, 50).map((fv) => ({
        field: fv.field,
        value: fv.value.length > 400 ? `${fv.value.slice(0, 400)}…` : fv.value,
      }));
      const each = mean(
        (page?.fieldValues ?? []).map((fv) => fv.field.length + fv.value.length + ITEM_OVERHEAD)
      );
      return {
        ...base,
        exists: true,
        length,
        bytes: key.length + KEY_OVERHEAD + Math.round(each * length),
        expiresAt: expires,
        preview: { kind: 'hash', fields },
        truncated: length > fields.length,
      };
    }
    if (type === 'zset') {
      const [length, rows, expires] = await Promise.all([
        redis.zCard(key),
        redis.zRange(key, 0, 49, { by: 'rank' }),
        expiresAt(key),
      ]);
      const members = (rows ?? []).map((r) => ({ member: r.member, score: r.score }));
      const each = mean(members.map((m) => m.member.length));
      return {
        ...base,
        exists: true,
        length,
        bytes: key.length + KEY_OVERHEAD + Math.round(length * (each + 8 + ITEM_OVERHEAD)),
        expiresAt: expires,
        preview: { kind: 'zset', members },
        truncated: length > members.length,
      };
    }
    return { ...base, type: 'none', exists: false, preview: null, truncated: false };
  },

  /** A change a moderator asked for. Every one is logged with who asked, for `devvit logs`. */
  async act(action: StorageAction, username: string): Promise<StorageActionResult> {
    const who = `u/${username}`;
    if (action.kind === 'probe') {
      const writes = await this.probe();
      return {
        ok: writes.set && writes.del,
        message: writes.set
          ? 'Writes go through.'
          : writes.del
            ? 'Writes are blocked, but deletes go through.'
            : `Writes are blocked${writes.quota ? ' for the quota' : ''}.`,
        writes,
      };
    }
    const subreddit = (context.subredditName ?? '').toLowerCase();
    try {
      switch (action.kind) {
        case 'delete': {
          if (!validKey(action.key) || action.confirm !== action.key) return refused();
          if ((await redis.exists(action.key)) === 0) {
            return { ok: true, message: 'It was already gone.' };
          }
          await redis.del(action.key);
          console.log(`storage: ${who} deleted ${action.key}`);
          return { ok: true, message: `Deleted ${action.key}.` };
        }
        case 'expire': {
          if (!validKey(action.key) || action.confirm !== action.key) return refused();
          const seconds = Math.floor(Number(action.seconds));
          if (!(seconds >= 60 && seconds <= MAX_EXPIRE_SECONDS)) {
            return { ok: false, message: 'An expiry runs from a minute to 30 days.' };
          }
          if ((await redis.type(action.key)) === 'none') {
            return { ok: false, message: 'There is no such key.' };
          }
          await redis.expire(action.key, seconds);
          console.log(`storage: ${who} set ${action.key} to expire in ${seconds} s`);
          return { ok: true, message: `${action.key} goes in ${duration(seconds)}.` };
        }
        case 'drop-map': {
          if (!DAY_RE.test(action.day) || action.confirm.toLowerCase() !== subreddit) {
            return refused();
          }
          if (action.day === (await liveMap())) {
            return {
              ok: false,
              message: "Today's map is the one being played. It is not dropped from here.",
            };
          }
          const { probes, sessions } = await mapProbes(action.day);
          const keys = [
            ...probes.map((p) => p.key),
            ...sessions.flatMap((s) => [runKey(s), runSavedKey(s)]),
          ];
          const gone = await dropKeys(keys);
          console.log(`storage: ${who} dropped the ${action.day} map, ${keys.length} keys`);
          return {
            ok: true,
            message: `Dropped the ${action.day} map: ${gone.toLocaleString('en-US')} keys, ${sessions.length.toLocaleString('en-US')} runs among them.`,
          };
        }
        case 'drop-relay': {
          if (!POST_RE.test(action.postId) || action.confirm.toLowerCase() !== subreddit) {
            return refused();
          }
          if (action.postId === (await redis.get(RELAY_CURRENT))) {
            return {
              ok: false,
              message: "Today's relay is being played. It is not dropped from here.",
            };
          }
          const keys = (await relayProbes(action.postId)).map((p) => p.key);
          const gone = await dropKeys(keys);
          console.log(`storage: ${who} dropped relay ${action.postId}, ${keys.length} keys`);
          return { ok: true, message: `Dropped relay post ${action.postId}: ${gone} keys.` };
        }
      }
    } catch (err) {
      const text = message(err);
      console.error(`storage: ${who} could not ${action.kind}`, err);
      return {
        ok: false,
        message: isQuota(text)
          ? 'Redis refused: writes are blocked for the quota, and deletes with them.'
          : `Redis refused: ${text}`,
      };
    }
  },
};

const validKey = (key: unknown): key is string =>
  typeof key === 'string' && key.length > 0 && key.length <= 512;

const refused = (): StorageActionResult => ({
  ok: false,
  message: 'The confirmation did not match. Nothing was changed.',
});

const duration = (seconds: number): string => {
  if (seconds % 86_400 === 0) return `${seconds / 86_400} day${seconds === 86_400 ? '' : 's'}`;
  if (seconds % 3600 === 0) return `${seconds / 3600} hour${seconds === 3600 ? '' : 's'}`;
  return `${Math.round(seconds / 60)} minutes`;
};

/**
 * Delete keys DROP_BATCH to a DEL, DROP_PARALLEL DELs at once: a full day is tens of thousands of
 * keys, and one at a time would not finish inside a request. How many of them were there.
 * Throws at the first refusal, with whatever went before it gone.
 */
const dropKeys = async (keys: readonly string[]): Promise<number> => {
  const counts = await inBatches(
    chunk([...new Set(keys)], DROP_BATCH),
    DROP_PARALLEL,
    async (b) => {
      const there = await redis.exists(...b);
      await redis.del(...b);
      return there;
    }
  );
  return counts.reduce((n, c) => n + c, 0);
};
