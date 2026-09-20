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

/** The region index a player builds in. Allocated once, never reassigned, so never expires. */
export const regionKey = (userId: string): string => `user:${userId}:region`;

/** Reverse of `regionKey`: which player a region was handed to. One value per region. */
export const regionOwnerKey = (rx: number, rz: number): string => `region:${rx},${rz}:owner`;

/** Monotonic region allocator. Its value is the next unclaimed index. */
export const NEXT_REGION = 'counters:next_region';

/** A player's placements, as JSON. Bounded by MAX_PLACEMENTS_PER_PLAYER. */
export const plotKey = (userId: string): string => `plot:${userId}`;

/**
 * Every player who has placed something, scored by when they last did.
 *
 * Read newest-first and trimmed. Also the enumeration path for keeps: a keep is on the map from
 * the moment its owner has raised anything, anywhere.
 */
export const PLOT_INDEX = 'index:plots';

/** How many plots the index keeps. Older plots fall out of the shared view, not out of Redis. */
export const PLOT_INDEX_LIMIT = 2000;

/**
 * A keep on the map: owner, colour and centre, as JSON. Written when the region is assigned and
 * rewritten when the owner changes colour, so the board rebuild reads it with one mGet instead
 * of a region lookup and a user hash per player.
 */
export const keepKey = (userId: string): string => `keep:${userId}`;

/**
 * Who holds a land cell: the tower standing there, as JSON (a `LandHold`). One per cell, deleted
 * when the tower topples or is removed. The take is done under WATCH on this key, so two players
 * beating the same bar in the same instant cannot both stand on it.
 */
export const cellKey = (x: number, z: number): string => `cell:${x},${z}`;

/** Every held land cell, scored by when it was last claimed. The enumeration path for holds. */
export const LAND_INDEX = 'index:land';
export const LAND_INDEX_LIMIT = 4000;

/**
 * The shared board, pre-aggregated and paged, plus the keeps as one row.
 *
 * Built when it changes and read as a handful of pages, so a viewer costs a fixed number of
 * reads no matter how many players there are.
 */
export const boardPageKey = (page: number): string => `board:page:${page}`;
export const BOARD_KEEPS = 'board:keeps';
export const BOARD_META = 'board:meta';

/** Towers per page. Small enough that one page is never near a response limit. */
export const BOARD_PAGE_SIZE = 24;

/** Hard caps on what the board will serve. The client's own budget is larger than both. */
export const BOARD_MAX_TOWERS = 640;
export const BOARD_MAX_BLOCKS = 40000;

/** Best score per player. Trimmed to the top of the table. */
export const SCORE_BOARD = 'lb:score';
export const SCORE_BOARD_LIMIT = 500;

/** Guard so one run is only ever counted once, however many times its save is retried. */
export const runSavedKey = (sessionId: string): string => `run:${sessionId}:counted`;

/** Community feed of announced runs, per post. Owned by socialService. */
export const feedKey = (postId: string): string => `post:${postId}:brags`;
export const bragGuardKey = (sessionId: string): string => `brag:session:${sessionId}`;

// --- Relay: the shared daily tower ---------------------------------------------------------

/** The tower, the turn, the day's tally: one JSON row per relay post. Bounded by the day. */
export const relayStateKey = (postId: string): string => `relay:${postId}:state`;

/** Who is in the post right now, scored by last heartbeat. Trimmed by time on every read. */
export const relayLobbyKey = (postId: string): string => `relay:${postId}:lobby`;

/** Everyone who has played today, as a hash of userId to a `RelayPlayer` JSON. */
export const relayPlayersKey = (postId: string): string => `relay:${postId}:players`;

/** Today's relay post id, so the map post can link to it and the scheduler can close it. */
export const RELAY_CURRENT = 'relay:current';

/** The newest map post id, so a relay post can link back to the map. */
export const MAP_POST = 'post:map';

/** Relay rows live a week: long enough to read yesterday's tower, short enough to be bounded. */
export const RELAY_TTL_SECONDS = 60 * 60 * 24 * 7;
