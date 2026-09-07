/**
 * Every Redis key Stonefall uses, in one place.
 *
 * The old server spread key construction across two services and roughly a dozen inline
 * template strings. Three of them were written and never read, two indexes grew without bound
 * because nothing trimmed them and the cleanup job had no schedule, and one leaderboard was
 * still being cleared by a purge routine years after the feature that wrote it was removed.
 * None of that is visible when the keys are built where they are used.
 *
 * The rules this file exists to keep:
 *
 * - Every key is declared here, with what it holds and how it is bounded.
 * - Nothing unbounded. A key either has a TTL, or a trim, or is one value per player.
 * - Devvit Redis has strings, hashes and sorted sets. No lists, no SCAN, no KEYS. Anything that
 *   needs enumerating needs an explicit index, which is why `plotIndex` exists at all.
 */

/** A verified run: who built it, what it scored, and the geometry the server derived. */
export const runKey = (sessionId: string): string => `run:${sessionId}`;

/** Runs are kept this long. Long enough to outlive any post that references one. */
export const RUN_TTL_SECONDS = 60 * 60 * 24 * 90;

/** Per-player record: username, best score, run count, colour. One hash per player. */
export const userKey = (userId: string): string => `user:${userId}`;

/** The region index a player builds in. Allocated once, never reassigned, so never expires. */
export const regionKey = (userId: string): string => `user:${userId}:region`;

/** Monotonic region allocator. Its value is the next unclaimed index. */
export const NEXT_REGION = 'counters:next_region';

/** A player's placements, as JSON. Bounded by MAX_PLACEMENTS_PER_PLAYER. */
export const plotKey = (userId: string): string => `plot:${userId}`;

/**
 * Every player who has placed something, scored by when they last did.
 *
 * Read newest-first and trimmed. The old index was read oldest-first by mistake, so once the
 * game passed four hundred players the board showed the four hundred stalest plots and nobody
 * new ever appeared on it.
 */
export const PLOT_INDEX = 'index:plots';

/** How many plots the index keeps. Older plots fall out of the community view, not out of Redis. */
export const PLOT_INDEX_LIMIT = 2000;

/**
 * The community board, pre-aggregated and paged.
 *
 * The board used to be assembled per request by resolving every player's plot and then reading
 * every placement inside it one at a time: up to twenty thousand sequential Redis calls for one
 * viewer opening a post, repeated for every viewer. It is now built when it changes and read as
 * a handful of pages, so a viewer costs a fixed number of reads no matter how many players there
 * are.
 */
export const boardPageKey = (page: number): string => `board:page:${page}`;
export const BOARD_META = 'board:meta';

/** Towers per page. Small enough that one page is never near a response limit. */
export const BOARD_PAGE_SIZE = 24;

/** Hard caps on what the board will serve. The client's own budget is larger than both. */
export const BOARD_MAX_TOWERS = 480;
export const BOARD_MAX_BLOCKS = 40000;

/** Best score per player. Trimmed to the top of the table. */
export const SCORE_BOARD = 'lb:score';
export const SCORE_BOARD_LIMIT = 500;

/**
 * Running totals of the colour each placed tower was built in, for the floor tint.
 *
 * A hash of counters kept in step with placement. The old implementation read five hundred
 * leaderboard members and then issued a `hGet` per member on every request, for two numbers.
 */
export const COLOR_TOTALS = 'stats:colors';

/** Guard so one run is only ever counted once, however many times its save is retried. */
export const runSavedKey = (sessionId: string): string => `run:${sessionId}:counted`;

/** Community feed of announced runs, per post. Owned by socialService. */
export const feedKey = (postId: string): string => `post:${postId}:brags`;
export const bragGuardKey = (sessionId: string): string => `brag:session:${sessionId}`;
