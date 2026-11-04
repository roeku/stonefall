/**
 * The moderators' storage dashboard: what `/api/storage/*` answers and accepts.
 *
 * Devvit's Redis answers no INFO, DBSIZE, MEMORY or SCAN, so every size here is the server adding
 * up keys it can name (`Storage.report`). Each family says how it was counted, so the dashboard
 * can show which numbers are read and which are estimates.
 */

/** The families of keys the report adds up, as keys.ts lays them out. */
export type StorageFamilyId =
  | 'runs'
  | 'users'
  | 'maps'
  | 'boards'
  | 'relayTowers'
  | 'relayPlayers'
  | 'feeds'
  | 'records'
  | 'awards'
  | 'notify'
  | 'other';

/**
 * How a family was counted: every key read, a few dozen read and multiplied, or added up as the
 * keys were written because nothing lists them.
 */
export type CountMethod = 'read' | 'sampled' | 'tallied';

export interface StorageFamilyView {
  id: StorageFamilyId;
  label: string;
  keys: number;
  bytes: number;
  /** Grows with players. The rest is held to the game's own caps however many play. */
  scales: boolean;
  method: CountMethod;
  /** How long its keys live, in words. */
  lifetime: string;
  note?: string;
}

/** One day's map, as stored. */
export interface StoredMapDay {
  day: string;
  live: boolean;
  players: number;
  keys: number;
  bytes: number;
  /** When its keys expire, ms. */
  expiresAt: number;
  postId: string | null;
}

/** One relay post, as stored. */
export interface StoredRelay {
  postId: string;
  day: string;
  live: boolean;
  towers: number;
  players: number;
  keys: number;
  bytes: number;
  /** When its keys expire, ms; null when they have none. */
  expiresAt: number | null;
}

/** What expires on a coming UTC day, by family. */
export interface StorageRelease {
  day: string;
  bytes: number;
  byFamily: Partial<Record<StorageFamilyId, number>>;
}

/**
 * Whether Redis takes writes right now, from a probe: a value set for a minute, then deleted.
 * Devvit blocks every write once an install is past its quota, deletes included as far as anyone
 * has seen, and only Reddit lifts it, so this is the first thing the dashboard shows.
 */
export interface WriteHealth {
  checkedAt: number;
  /** A tiny value could be set. */
  set: boolean;
  /** A key could be deleted. */
  del: boolean;
  /** The error Redis gave, when either failed. */
  error: string | null;
  /** The error was the quota one: Reddit has blocked writes for the install. */
  quota: boolean;
}

export interface StorageHistoryPoint {
  day: string;
  bytes: number;
  keys: number;
  players: number;
}

export interface StorageOverview {
  at: number;
  subreddit: string;
  /** What Devvit lets one installation keep, and the most one request may carry. */
  limit: number;
  requestLimit: number;
  /** What the report can name. */
  bytes: number;
  keys: number;
  /**
   * What it cannot. Known only when Reddit has blocked writes for the quota: usage is then at the
   * limit at least, so whatever the report did not see is the difference.
   */
  unseen: { atLeast: number; note: string; goneBy: string | null } | null;
  writes: WriteHealth;
  families: StorageFamilyView[];
  dailyPlayers: number;
  perPlayer: number;
  capacity: number | null;
  largest: { label: string; bytes: number } | null;
  history: StorageHistoryPoint[];
  /** The next 31 days, today first. */
  releases: StorageRelease[];
  maps: StoredMapDay[];
  relays: StoredRelay[];
}

export type RedisType = 'string' | 'hash' | 'zset' | 'none';

/** One key, as a listing shows it. */
export interface StorageKeyRow {
  key: string;
  type: RedisType;
  /** Characters in a string; fields in a hash; members in a sorted set. */
  length: number;
  bytes: number;
  /** ms; null when it never expires, or when it was not read. */
  expiresAt: number | null;
}

/** What a listing is of: a day's map, a relay post, or one of the families nothing groups by day. */
export type StorageScope =
  | { kind: 'map'; day: string }
  | { kind: 'relay'; postId: string }
  | { kind: 'family'; family: 'users' | 'runs' | 'awards' | 'notify' | 'other' };

export interface StorageListing {
  title: string;
  /** Largest first. */
  rows: StorageKeyRow[];
  /** Every key found, by what kind of key it is: largest first. */
  groups: Array<{ label: string; keys: number; bytes: number }>;
  /** Keys the listing knows of, shown or not. */
  total: number;
  /** Their bytes, as far as they were read. */
  bytes: number;
  note: string | null;
}

/** What a key is, from its name: the family it belongs to and what the game uses it for. */
export interface KeyMeaning {
  family: string;
  what: string;
  lifetime: string;
  /** The game needs it to run; deleting it breaks something until a job puts it back. */
  vital: boolean;
}

export interface StorageKeyDetail extends StorageKeyRow {
  exists: boolean;
  meaning: KeyMeaning | null;
  /** The start of the value, or the first fields or members. */
  preview:
    | { kind: 'string'; text: string }
    | { kind: 'hash'; fields: Array<{ field: string; value: string }> }
    | { kind: 'zset'; members: Array<{ member: string; score: number }> }
    | null;
  truncated: boolean;
}

/** The changes the dashboard can make. Each names what it acts on again as `confirm`. */
export type StorageAction =
  | { kind: 'probe' }
  | { kind: 'delete'; key: string; confirm: string }
  | { kind: 'expire'; key: string; seconds: number; confirm: string }
  | { kind: 'drop-map'; day: string; confirm: string }
  | { kind: 'drop-relay'; postId: string; confirm: string };

export interface StorageActionResult {
  ok: boolean;
  message: string;
  writes?: WriteHealth;
}

/** Longest an expiry set from the dashboard may be: nothing naming a player outlives 30 days. */
export const MAX_EXPIRE_SECONDS = 60 * 60 * 24 * 30;
