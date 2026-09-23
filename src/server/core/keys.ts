/**
 * Every Redis key Stonefall uses, in one place.
 *
 * The rules this file exists to keep:
 *
 * - Every key is declared here, with what it holds and how it is bounded.
 * - Nothing unbounded. A key either has a TTL, or a trim, or is one value per player or cell.
 * - Devvit Redis has strings, hashes and sorted sets. No lists, no SCAN, no KEYS. Anything that
 *   needs enumerating needs an explicit index, which is why the `index:*` keys exist at all.
 */

/** A verified run: who built it, what it scored, and the geometry the server derived. */
export const runKey = (sessionId: string): string => `run:${sessionId}`;

/** Runs are kept this long. Long enough to outlive any post that references one. */
export const RUN_TTL_SECONDS = 60 * 60 * 24 * 90;

/** Per-player record: username, best score, run count, faction. One hash per player. */
export const userKey = (userId: string): string => `user:${userId}`;

// --- The map: one board per day ---------------------------------------------------------------
//
// The map resets every day. Everything about where people build is scoped to a map, and a map's
// id is the day it opened (YYYY-MM-DD, UTC), so yesterday's post keeps showing yesterday's board
// while today's fills up from nothing. Every map key expires MAP_TTL after its day, which is what
// bounds the storage: a closed map is never written again, so nothing refreshes its clock.

/** How long a day's map is kept after it opens. Long enough to look back at last week's. */
export const MAP_TTL_SECONDS = 60 * 60 * 24 * 14;

const mapKey = (map: string, rest: string): string => `map:${map}:${rest}`;

/** Today's map: `{ day, postId, openedAt }` as JSON. The daily job moves it on. */
export const MAP_CURRENT = 'map:current';

/** One map's own record: which post shows it, when it opened and closed. A hash. */
export const mapMetaKey = (map: string): string => mapKey(map, 'meta');

/** Held for a minute while a day's post is being created, so two callers cannot make two. */
export const mapOpenLockKey = (day: string): string => `map:${day}:opening`;

/** The region index a player builds in on this map. Allocated on their first run of the day. */
export const regionKey = (map: string, userId: string): string =>
  mapKey(map, `user:${userId}:region`);

/** Reverse of `regionKey`: which player a region was handed to. One value per region. */
export const regionOwnerKey = (map: string, rx: number, rz: number): string =>
  mapKey(map, `region:${rx},${rz}:owner`);

/** Monotonic region allocator. Its value is the next unclaimed index, so each day packs from 0. */
export const nextRegionKey = (map: string): string => mapKey(map, 'next_region');

/** A player's placements on this map, as JSON. Bounded by MAX_PLACEMENTS_PER_PLAYER. */
export const plotKey = (map: string, userId: string): string => mapKey(map, `plot:${userId}`);

/**
 * Every player who has raised something on this map, scored by when they last did.
 *
 * Read newest-first and trimmed. Also the enumeration path for keeps: a keep is on the map from
 * the moment its owner has raised anything, anywhere.
 */
export const plotIndexKey = (map: string): string => mapKey(map, 'index:plots');

/** How many plots the index keeps. Older plots fall out of the shared view, not out of Redis. */
export const PLOT_INDEX_LIMIT = 2000;

/**
 * A keep on the map: owner, colour and centre, as JSON. Written when the region is assigned and
 * rewritten when the owner changes colour, so the board rebuild reads it with one mGet instead
 * of a region lookup and a user hash per player.
 */
export const keepKey = (map: string, userId: string): string => mapKey(map, `keep:${userId}`);

/**
 * Who holds a land cell: the tower standing there, as JSON (a `LandHold`). One per cell, deleted
 * when the tower topples or is removed. The take is done under WATCH on this key, so two players
 * beating the same bar in the same instant cannot both stand on it.
 */
export const cellKey = (map: string, x: number, z: number): string => mapKey(map, `cell:${x},${z}`);

/** Every held land cell, as "x,z", scored by when it was last claimed. */
export const landIndexKey = (map: string): string => mapKey(map, 'index:land');
export const LAND_INDEX_LIMIT = 4000;

/**
 * The shared board, pre-aggregated and paged, plus the keeps as one row.
 *
 * Built when it changes and read as a handful of pages, so a viewer costs a fixed number of
 * reads no matter how many players there are.
 */
export const boardPageKey = (map: string, page: number): string =>
  mapKey(map, `board:page:${page}`);
export const boardKeepsKey = (map: string): string => mapKey(map, 'board:keeps');
export const boardMetaKey = (map: string): string => mapKey(map, 'board:meta');

/** Towers per page. Small enough that one page is never near a response limit. */
export const BOARD_PAGE_SIZE = 24;

/** Hard caps on what the board will serve. The client's own budget is larger than both. */
export const BOARD_MAX_TOWERS = 640;
export const BOARD_MAX_BLOCKS = 40000;

/** Best score per player, across every day. Trimmed to the top of the table. */
export const SCORE_BOARD = 'lb:score';
export const SCORE_BOARD_LIMIT = 500;

/** Guard so one run is only ever counted once, however many times its save is retried. */
export const runSavedKey = (sessionId: string): string => `run:${sessionId}:counted`;

/** Community feed of announced runs, per post. Owned by socialService. */
export const feedKey = (postId: string): string => `post:${postId}:brags`;
export const bragGuardKey = (sessionId: string): string => `brag:session:${sessionId}`;

/**
 * The keyspace before maps were daily: one board forever. Kept only so the purge tool can still
 * find and clear it; nothing reads or writes these any more.
 */
export const LEGACY_MAP = {
  PLOT_INDEX: 'index:plots',
  LAND_INDEX: 'index:land',
  BOARD_KEEPS: 'board:keeps',
  BOARD_META: 'board:meta',
  NEXT_REGION: 'counters:next_region',
  MAP_POST: 'post:map',
  boardPage: (page: number): string => `board:page:${page}`,
  plot: (userId: string): string => `plot:${userId}`,
  keep: (userId: string): string => `keep:${userId}`,
  region: (userId: string): string => `user:${userId}:region`,
  regionOwner: (rx: number, rz: number): string => `region:${rx},${rz}:owner`,
  cell: (member: string): string => `cell:${member}`,
} as const;

// --- Relay: the shared daily towers ---------------------------------------------------------

/** The post: day and whether it is closed. One JSON row per relay post. */
export const relayMetaKey = (postId: string): string => `relay:${postId}:meta`;

/** How many towers the post has. A counter, so two new towers at once are two, not one. */
export const relayTowerCountKey = (postId: string): string => `relay:${postId}:tower_count`;

/** One tower: blocks, turn, tally, events. One JSON row per tower. */
export const relayTowerKey = (postId: string, tower: number): string =>
  `relay:${postId}:tower:${tower}`;

/** Every tower's summary, for the neighbours and the pager: a hash of tower id to JSON. */
export const relaySummaryKey = (postId: string): string => `relay:${postId}:towers`;

/** One tower's seated crew, scored by last heartbeat. Trimmed by time on every heartbeat. */
export const relayCrewKey = (postId: string, tower: number): string =>
  `relay:${postId}:crew:${tower}`;

/** Who was in the one lobby of a post from before crews. Only the purge tool still names it. */
export const relayLegacyLobbyKey = (postId: string): string => `relay:${postId}:lobby`;

/** Everyone who has been seen today, as a hash of userId to a `RelayPlayer` JSON. */
export const relayPlayersKey = (postId: string): string => `relay:${postId}:players`;

/** The single tower of a relay post from before towers had crews. Read once, to migrate it. */
export const relayLegacyStateKey = (postId: string): string => `relay:${postId}:state`;

/** Today's relay post id, so the map post can link to it and the daily job can close it. */
export const RELAY_CURRENT = 'relay:current';

/** Relay rows live a week: long enough to read yesterday's towers, short enough to be bounded. */
export const RELAY_TTL_SECONDS = 60 * 60 * 24 * 7;
