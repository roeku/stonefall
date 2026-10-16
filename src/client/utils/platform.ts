import {
  canRunAsUser,
  getShareData,
  getWebViewMode,
  requestExpandedMode,
  showLoginPrompt,
} from '@devvit/web/client';
import { parseCellLink } from '../../shared/social/comments';

/**
 * The few things the game asks of Reddit itself, each safe to call from the local harness, where
 * there is no Reddit around the page (`npm run play`) and `devvit` is not defined.
 */

const onReddit = (): boolean => typeof (globalThis as { devvit?: unknown }).devvit !== 'undefined';

/**
 * Whether the game is inside a post in the feed or on the post page, rather than expanded or in
 * the harness. Devvit allows only taps and clicks there: the feed scrolls under a swipe, a wheel
 * or the space bar, and the game must never take those for itself.
 */
export const isInlineOnReddit = (): boolean => {
  if (!onReddit()) return false;
  try {
    return getWebViewMode() === 'inline';
  } catch {
    return true;
  }
};

const GRAB_KEY = 'stonefall:grab';
/** How long a request for full screen is remembered across the reload it may cause, ms. */
const GRAB_MEMORY_MS = 30_000;

/**
 * Open the post full screen with the grab tool on: in the feed a drag is the feed's, so turning
 * the view by hand happens where gestures are the game's. Reddit may reload the page to expand
 * it, so the ask is remembered for a moment (`openedToGrab`). Must be called from a trusted
 * click. True if Reddit took the request.
 */
export const openToGrab = (event: MouseEvent, entry: string): boolean => {
  if (!onReddit()) return false;
  try {
    localStorage.setItem(GRAB_KEY, String(Date.now()));
  } catch {
    // Without storage, a reload just opens with the tool off.
  }
  try {
    requestExpandedMode(event, entry);
    return true;
  } catch (err) {
    console.warn('[grab] could not open full screen', err);
    return false;
  }
};

/** Whether this page was opened full screen by the grab tool a moment ago. Read once. */
export const openedToGrab = (): boolean => {
  try {
    const at = Number(localStorage.getItem(GRAB_KEY) ?? 0);
    localStorage.removeItem(GRAB_KEY);
    return Date.now() - at < GRAB_MEMORY_MS && !isInlineOnReddit();
  } catch {
    return false;
  }
};

/**
 * Reddit's own check that the player has let the app act as them, to comment or to subscribe,
 * asking them if they have not. Called from the tap that confirms the action, which must be a
 * trusted event. Resolves false if they said no, or if nothing answered within a minute, so
 * nothing is done as them without it.
 */
export const mayActAsUser = async (event: Event): Promise<boolean> => {
  if (!onReddit()) return true;
  try {
    return await Promise.race([
      canRunAsUser(event),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 60_000)),
    ]);
  } catch (err) {
    // It throws for an untrusted event, which a real tap never is. Nothing is done without a
    // clear yes.
    console.warn('[as user] consent check failed', err);
    return false;
  }
};

/** Reddit's sign-in and sign-up sheet. The page reloads once the player has signed in. */
export const askToSignIn = (): void => {
  if (!onReddit()) return;
  try {
    showLoginPrompt();
  } catch (err) {
    console.warn('[login] prompt failed', err);
  }
};

/**
 * The cell a link opened the post on: a score comment's cell name links to it (`cellLink`).
 * Reddit hands the link's data over as share data; the harness reads the same `devvitshare`
 * parameter off its own URL, so a link can be tried locally.
 */
export const linkedCell = (): { x: number; z: number } | null => {
  try {
    if (onReddit()) {
      const data = getShareData();
      // Whether Reddit handed a link's data over at all: the only way to tell from `devvit logs`.
      if (data !== undefined) console.log('[link] share data', JSON.stringify(data));
      return parseCellLink(data);
    }
    const raw = new URLSearchParams(window.location.search).get('devvitshare');
    return raw ? parseCellLink((JSON.parse(raw) as { userData?: unknown }).userData) : null;
  } catch {
    return null;
  }
};
