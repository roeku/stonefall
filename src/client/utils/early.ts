/**
 * Reads started before this bundle arrived.
 *
 * `public/boot.js` loads async with the page and asks for what the first screen needs, so that
 * the server's answer and the game's script travel at the same time instead of one after the
 * other. The hooks read through `fetchEarly`, which hands each URL's early answer to the first
 * caller that asks for it.
 */

/** What the first screen of each post reads. */
export const EARLY = {
  board: '/api/board?view=post',
  me: '/api/me',
  feed: '/api/social/feed?limit=12',
  relayToday: '/api/relay/today',
  relayState: '/api/relay/state?view=post',
  mapToday: '/api/map/today',
} as const;

/** What boot.js starts, per post. early.test.ts runs boot.js and holds it to these. */
export const EARLY_READS = {
  map: [EARLY.board, EARLY.me, EARLY.feed, EARLY.relayToday],
  relay: [EARLY.relayState, EARLY.mapToday],
} as const;

declare global {
  interface Window {
    /** Set by boot.js: a pending fetch per URL. An empty object once the game has claimed it. */
    __early?: Record<string, Promise<Response>>;
  }
}

/**
 * `fetch(url)`, answered by boot.js's read of the same URL when there is one.
 *
 * Each early read answers once, to the first caller, and every later read goes to the network,
 * so a refresh is never answered with the page's first look. An early read that failed is asked
 * again. Called before boot.js has run, it claims the slot so a late boot.js does not ask twice.
 */
export const fetchEarly = (url: string): Promise<Response> => {
  if (typeof window === 'undefined') return fetch(url);
  const early = window.__early;
  if (early === undefined) {
    window.__early = {};
    return fetch(url);
  }
  const pending = early[url];
  if (!pending) return fetch(url);
  delete early[url];
  return pending.catch(() => fetch(url));
};
