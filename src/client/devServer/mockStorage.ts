import type {
  StorageAction,
  StorageActionResult,
  StorageFamilyView,
  StorageHistoryPoint,
  StorageKeyDetail,
  StorageKeyRow,
  StorageListing,
  StorageOverview,
  StorageRelease,
  StoredMapDay,
  StoredRelay,
  WriteHealth,
} from '../../shared/types/storage';

/**
 * The storage dashboard's answers for the harness, shaped on r/stonefall as it stood when Reddit
 * blocked its writes (2 Nov 2026): about 2 GB the report can see, runs most of it, and the rest of
 * the 5 GB hidden in board copies nothing lists. Numbers are made up to that shape, not read.
 *
 * Harness controls: `/api/mock/storage?writes=blocked|deletes|ok` (blocked for the quota, blocked
 * but deletes go through, or healthy) and `?mod=0|1` (whether the viewer moderates).
 */

export interface MockStorageState {
  writes: 'blocked' | 'deletes' | 'ok';
  moderator: boolean;
  dropped: Set<string>;
}

export const mockStorageState = (): MockStorageState => ({
  writes: 'blocked',
  moderator: true,
  dropped: new Set(),
});

const DAY_MS = 86_400_000;
const LIMIT = 5_000_000_000;
const QUOTA_ERROR =
  '8 RESOURCE_EXHAUSTED: this app has exceeded its redis quota and all writes will be blocked going forward, if you are the developer please contact Reddit Dev Platform Support';

const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const dayStart = (ms: number): number => Date.parse(`${utcDay(ms)}T00:00:00Z`);

/** A steady pseudo-random number in [0, 1) per seed, so the harness looks the same each load. */
const noise = (seed: number): number => {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

const writesOf = (s: MockStorageState): WriteHealth => ({
  checkedAt: Date.now(),
  set: s.writes === 'ok',
  del: s.writes !== 'blocked',
  error: s.writes === 'ok' ? null : QUOTA_ERROR,
  quota: s.writes !== 'ok',
});

const FAMILIES: StorageFamilyView[] = [
  {
    id: 'runs',
    label: 'Runs',
    keys: 287_400,
    bytes: 1_384_000_000,
    scales: true,
    method: 'tallied',
    lifetime: '30 days after they are played',
    note: "Counted for 7 days so far; 30 days' worth estimated from it.",
  },
  {
    id: 'maps',
    label: 'Plots, keeps and land',
    keys: 61_820,
    bytes: 212_000_000,
    scales: true,
    method: 'sampled',
    lifetime: '14 days after their map opened',
    note: 'Sampled: a few dozen read per day, times how many there are.',
  },
  {
    id: 'records',
    label: 'Comment and take records',
    keys: 154_000,
    bytes: 118_000_000,
    scales: true,
    method: 'tallied',
    lifetime: '30 days, or with their map',
  },
  {
    id: 'users',
    label: 'Player records',
    keys: 9_840,
    bytes: 96_100_000,
    scales: true,
    method: 'sampled',
    lifetime: "30 days after the player's last write",
    note: 'Players seen in the last 14 days, sampled; records last 30, so this is a floor.',
  },
  {
    id: 'relayTowers',
    label: 'Relay towers',
    keys: 2_210,
    bytes: 41_800_000,
    scales: false,
    method: 'read',
    lifetime: '14 days after their last turn',
  },
  {
    id: 'relayPlayers',
    label: 'Relay players',
    keys: 13,
    bytes: 23_900_000,
    scales: true,
    method: 'sampled',
    lifetime: "14 days after their post's last turn",
  },
  {
    id: 'boards',
    label: 'Map boards',
    keys: 212,
    bytes: 18_300_000,
    scales: false,
    method: 'read',
    lifetime: 'Rebuilt hourly; go with their map',
  },
  {
    id: 'awards',
    label: 'Awards and flair',
    keys: 64,
    bytes: 6_100_000,
    scales: true,
    method: 'sampled',
    lifetime: '30 days',
  },
  {
    id: 'feeds',
    label: 'Score feeds',
    keys: 52,
    bytes: 3_200_000,
    scales: false,
    method: 'read',
    lifetime: '14 days after the last score',
  },
  {
    id: 'notify',
    label: 'Notifications',
    keys: 24,
    bytes: 1_900_000,
    scales: true,
    method: 'read',
    lifetime: 'Trimmed of anyone gone 30 days',
    note: 'The 24 hour lists, counted; the two-day push logs beside them are not.',
  },
  {
    id: 'other',
    label: 'Everything else',
    keys: 41,
    bytes: 410_000,
    scales: false,
    method: 'read',
    lifetime: 'Pointers and this report',
  },
];

const mapsOf = (now: number, dropped: Set<string>): StoredMapDay[] =>
  Array.from({ length: 14 }, (_, back) => {
    const day = utcDay(now - back * DAY_MS);
    const players = Math.round(back === 0 ? 120 : 600 + 1500 * noise(back) * (back < 4 ? 1.4 : 1));
    return {
      day,
      live: back === 0,
      players,
      keys: Math.round(players * 4.6),
      bytes: Math.round(players * 9_800 * (0.8 + 0.4 * noise(back + 40))),
      expiresAt: Date.parse(`${day}T00:00:00Z`) + 14 * DAY_MS,
      postId: `t3_mock${back}`,
    };
  }).filter((m) => !dropped.has(`map:${m.day}`));

const relaysOf = (now: number, dropped: Set<string>): StoredRelay[] =>
  Array.from({ length: 13 }, (_, back) => {
    const day = utcDay(now - back * DAY_MS);
    const players = Math.round(200 + 900 * noise(back + 7));
    return {
      postId: `t3_relay${back}`,
      day,
      live: back === 0,
      towers: Math.round(players / 8),
      players,
      keys: Math.round(players / 4) + 5,
      bytes: Math.round(players * 4_900),
      expiresAt: dayStart(now) + (15 - back) * DAY_MS + 3 * 3600_000,
    };
  }).filter((r) => !dropped.has(`relay:${r.postId}`));

const historyOf = (now: number): StorageHistoryPoint[] => {
  // Daily snapshots until writes stopped two days ago: the trend climbs, then has nothing.
  const days = 28;
  return Array.from({ length: days }, (_, i) => {
    const back = days + 1 - i;
    const t = i / (days - 1);
    return {
      day: utcDay(now - back * DAY_MS),
      bytes: Math.round(260_000_000 + 1_690_000_000 * t ** 1.35 * (0.97 + 0.06 * noise(i))),
      keys: Math.round(60_000 + 450_000 * t),
      players: Math.round(800 + 1100 * t),
    };
  });
};

const releasesOf = (now: number, maps: StoredMapDay[], relays: StoredRelay[]): StorageRelease[] =>
  Array.from({ length: 31 }, (_, ahead) => {
    const day = utcDay(now + ahead * DAY_MS);
    const byFamily: StorageRelease['byFamily'] = {};
    const add = (k: keyof typeof byFamily, b: number) => (byFamily[k] = (byFamily[k] ?? 0) + b);
    for (const m of maps) if (utcDay(m.expiresAt) === day) add('maps', m.bytes);
    for (const r of relays)
      if (r.expiresAt && utcDay(r.expiresAt) === day) add('relayTowers', r.bytes);
    // Runs written in the 28 days before the block go 30 days after; none since.
    if (ahead <= 28)
      add(
        'runs',
        Math.round(30_000_000 + 50_000_000 * ((28 - ahead) / 28) * (0.8 + 0.4 * noise(ahead)))
      );
    if (ahead <= 28) add('records', Math.round(4_100_000 * (0.8 + 0.4 * noise(ahead + 3))));
    add('users', Math.round(3_200_000 * (0.6 + 0.8 * noise(ahead + 9))));
    return { day, bytes: Object.values(byFamily).reduce((n, b) => n + (b ?? 0), 0), byFamily };
  });

export const mockOverview = (s: MockStorageState): StorageOverview => {
  const now = Date.now();
  const maps = mapsOf(now, s.dropped);
  const relays = relaysOf(now, s.dropped);
  const bytes = FAMILIES.reduce((n, f) => n + f.bytes, 0);
  const writes = writesOf(s);
  return {
    at: now,
    subreddit: 'stonefall',
    limit: LIMIT,
    requestLimit: 5_000_000,
    bytes,
    keys: FAMILIES.reduce((n, f) => n + f.keys, 0),
    unseen: writes.quota
      ? {
          atLeast: LIMIT - bytes,
          goneBy: utcDay(now + 12 * DAY_MS),
          note: 'Most likely the board copies that rebuilds left behind between 31 Oct and 2 Nov. Nothing lists them, so they cannot be deleted from here; they expire with their maps.',
        }
      : null,
    writes,
    families: FAMILIES,
    dailyPlayers: 1_420,
    perPlayer: 1_290_000,
    capacity: 3_850,
    largest: {
      label: `A board page, ${new Date(now).toLocaleDateString('en-US', { day: 'numeric', month: 'short', timeZone: 'UTC' })}`,
      bytes: 412_000,
    },
    history: historyOf(now),
    releases: releasesOf(now, maps, relays),
    maps,
    relays,
  };
};

const row = (
  key: string,
  type: StorageKeyRow['type'],
  length: number,
  expiresAt: number | null
): StorageKeyRow => ({
  key,
  type,
  length,
  bytes: key.length + 64 + (type === 'string' ? length : length * 48),
  expiresAt,
});

export const mockListing = (q: URLSearchParams): StorageListing => {
  const now = Date.now();
  const kind = q.get('kind');
  if (kind === 'map') {
    const day = q.get('day') ?? utcDay(now);
    const goes = Date.parse(`${day}T00:00:00Z`) + 14 * DAY_MS;
    const rows: StorageKeyRow[] = [];
    for (let i = 0; i < 16; i++)
      rows.push(
        row(
          `map:${day}:board:page:mhx3k2${i}:${i}`,
          'string',
          Math.round(380_000 * (0.6 + 0.4 * noise(i))),
          now + 2.6 * 3600_000
        )
      );
    for (let i = 0; i < 160; i++)
      rows.push(
        row(
          `map:${day}:plot:t2_${(1e6 + i * 7919).toString(36)}`,
          'string',
          Math.round(2_400 + 9_000 * noise(i + 1)),
          goes
        )
      );
    for (let i = 0; i < 40; i++)
      rows.push(
        row(
          `map:${day}:cell:${Math.round(noise(i) * 80) - 40},${Math.round(noise(i + 2) * 80) - 40}`,
          'string',
          Math.round(600 + 2600 * noise(i + 5)),
          goes
        )
      );
    rows.push(
      row(`map:${day}:index:land`, 'zset', 3_912, goes),
      row(`map:${day}:index:plots`, 'zset', 1_840, goes),
      row(`map:${day}:board:keeps`, 'string', 96_000, goes)
    );
    rows.sort((a, b) => b.bytes - a.bytes);
    return {
      title: `Map, ${day}`,
      rows: rows.slice(0, 200),
      groups: [
        { label: 'Plots', keys: 1_840, bytes: 13_100_000 },
        { label: 'Board', keys: 18, bytes: 5_200_000 },
        { label: 'Held land', keys: 3_912, bytes: 4_800_000 },
        { label: 'Take and comment records', keys: 2_270, bytes: 1_900_000 },
        { label: 'Keeps', keys: 1_840, bytes: 610_000 },
        { label: 'Regions', keys: 3_690, bytes: 330_000 },
        { label: 'Indexes', keys: 2, bytes: 290_000 },
        { label: 'Score feed', keys: 2, bytes: 31_000 },
        { label: 'Map record', keys: 1, bytes: 300 },
      ],
      total: 13_575,
      bytes: 26_261_300,
      note: '6,412 runs stand on this map. They are counted under Runs, and a drop deletes them with it.',
    };
  }
  if (kind === 'relay') {
    const postId = q.get('postId') ?? 't3_relay0';
    const rows = [
      row(`relay:${postId}:players`, 'hash', 812, now + 13 * DAY_MS),
      ...Array.from({ length: 30 }, (_, i) =>
        row(
          `relay:${postId}:tower:${i + 1}`,
          'string',
          Math.round(8_000 + 30_000 * noise(i)),
          now + 13 * DAY_MS
        )
      ),
      row(`relay:${postId}:towers`, 'hash', 101, now + 13 * DAY_MS),
      row(`relay:${postId}:meta`, 'string', 48, now + 13 * DAY_MS),
    ].sort((a, b) => b.bytes - a.bytes);
    return {
      title: `Relay post ${postId}`,
      rows,
      groups: [
        { label: 'Towers', keys: 101, bytes: 2_300_000 },
        { label: 'Players', keys: 1, bytes: 1_900_000 },
        { label: 'Tower summaries', keys: 1, bytes: 41_000 },
        { label: 'Crews', keys: 12, bytes: 4_100 },
        { label: 'Relay record', keys: 2, bytes: 250 },
      ],
      total: 117,
      bytes: 4_245_350,
      note: null,
    };
  }
  const family = q.get('family');
  if (family === 'runs') {
    const rows = Array.from({ length: 120 }, (_, i) =>
      row(
        `run:${(now - i * 997_331).toString(36)}-${(i * 7717).toString(36)}`,
        'string',
        Math.round(2_100 + 11_000 * noise(i)),
        now + (29 - (i % 29)) * DAY_MS
      )
    ).sort((a, b) => b.bytes - a.bytes);
    return {
      title: 'Runs',
      rows,
      groups: [
        { label: 'Runs', keys: 120, bytes: rows.reduce((n, r) => n + r.bytes, 0) },
        { label: 'Count-once guards', keys: 120, bytes: 120 * 90 },
      ],
      total: 240,
      bytes: rows.reduce((n, r) => n + r.bytes, 0) + 120 * 90,
      note: "Only runs standing on today's map can be found, so these are a sample. Every other run is listed nowhere: the report counts them as they are written, and each goes 30 days after it was played.",
    };
  }
  const rows = Array.from({ length: 60 }, (_, i) =>
    row(
      `user:t2_${(1e6 + i * 104_729).toString(36)}`,
      'hash',
      14 + Math.round(10 * noise(i)),
      now + (30 - (i % 30)) * DAY_MS
    )
  ).sort((a, b) => b.bytes - a.bytes);
  return {
    title: family === 'users' ? 'Player records' : (family ?? 'Keys'),
    rows,
    groups: [{ label: 'Player records', keys: 60, bytes: rows.reduce((n, r) => n + r.bytes, 0) }],
    total: 60,
    bytes: rows.reduce((n, r) => n + r.bytes, 0),
    note: "1,203 players are on today's map and relay; 60 of them, spread across, are read. Records of anyone else are listed nowhere and go 30 days after their last write.",
  };
};

export const mockKey = (name: string): StorageKeyDetail => {
  const now = Date.now();
  if (name === 'map:current') {
    const text = JSON.stringify({
      day: utcDay(now),
      postId: 't3_mock0',
      openedAt: dayStart(now) + 12 * 3600_000,
    });
    return {
      key: name,
      type: 'string',
      exists: true,
      length: text.length,
      bytes: name.length + text.length + 64,
      expiresAt: null,
      meaning: {
        family: 'Pointers',
        what: "Which day's map is live. The game reads it on every request; without it nothing finds today's map until the daily job",
        lifetime: 'Never expires',
        vital: true,
      },
      preview: { kind: 'string', text },
      truncated: false,
    };
  }
  if (name.startsWith('user:')) {
    const fields = [
      { field: 'username', value: 'stonefall_player' },
      { field: 'best', value: '84' },
      { field: 'runs', value: '212' },
      { field: 'faction', value: 'amber' },
      { field: 'xp', value: '18450' },
      { field: 'settings', value: '{"sound":true,"shake":true,"quality":"high","start":2}' },
      { field: 'bestRun', value: 'mh2k1x-9fj2ka' },
    ];
    return {
      key: name,
      type: 'hash',
      exists: true,
      length: fields.length,
      bytes: 820,
      expiresAt: now + 22 * DAY_MS,
      meaning: {
        family: 'Player records',
        what: "A player's record: name, best, XP, colour, settings",
        lifetime: "30 days after the player's last write",
        vital: false,
      },
      preview: { kind: 'hash', fields },
      truncated: false,
    };
  }
  if (name.includes(':plot:') || name.includes(':board:page:') || name.startsWith('run:')) {
    const text = JSON.stringify({
      userId: 't2_abc123',
      username: 'stonefall_player',
      placements: Array.from({ length: 6 }, (_, i) => ({
        sessionId: `mh2k1x-${i}`,
        gridX: i * 3 - 7,
        gridZ: 4 - i,
        stack: 0,
        score: 40 + i * 7,
      })),
      updatedAt: now - 3_600_000,
    }).repeat(name.includes('board') ? 40 : 1);
    return {
      key: name,
      type: 'string',
      exists: true,
      length: text.length,
      bytes: name.length + text.length + 64,
      expiresAt: now + 9 * DAY_MS,
      meaning: name.startsWith('run:')
        ? {
            family: 'Runs',
            what: 'A verified run: its blocks, score and who built it',
            lifetime: '30 days after it was played',
            vital: false,
          }
        : name.includes('board')
          ? {
              family: 'Map boards',
              what: 'A page of the shared board, as served',
              lifetime: '2 minutes until the board points at it, then 3 hours',
              vital: false,
            }
          : {
              family: 'Plots, keeps and land',
              what: "A player's placements on the map",
              lifetime: '14 days after its map opened',
              vital: false,
            },
      preview: { kind: 'string', text: text.slice(0, 4000) },
      truncated: text.length > 4000,
    };
  }
  return {
    key: name,
    type: 'none',
    exists: false,
    length: 0,
    bytes: 0,
    expiresAt: null,
    meaning: null,
    preview: null,
    truncated: false,
  };
};

export const mockAction = (s: MockStorageState, a: StorageAction): StorageActionResult => {
  if (a.kind === 'probe') {
    const writes = writesOf(s);
    return {
      ok: writes.set,
      message: writes.set ? 'Writes go through.' : 'Writes are blocked for the quota.',
      writes,
    };
  }
  if (s.writes === 'blocked') {
    return {
      ok: false,
      message: 'Redis refused: writes are blocked for the quota, and deletes with them.',
    };
  }
  if (a.kind === 'drop-map' || a.kind === 'drop-relay') {
    if (a.confirm.toLowerCase() !== 'stonefall')
      return { ok: false, message: 'The confirmation did not match. Nothing was changed.' };
    s.dropped.add(a.kind === 'drop-map' ? `map:${a.day}` : `relay:${a.postId}`);
    return {
      ok: true,
      message:
        a.kind === 'drop-map'
          ? `Dropped the ${a.day} map: 13,575 keys, 6,412 runs among them.`
          : `Dropped relay post ${a.postId}: 117 keys.`,
    };
  }
  if (a.confirm !== a.key)
    return { ok: false, message: 'The confirmation did not match. Nothing was changed.' };
  return {
    ok: true,
    message:
      a.kind === 'delete'
        ? `Deleted ${a.key}.`
        : `${a.key} goes in ${Math.round(a.seconds / 3600)} hours.`,
  };
};
