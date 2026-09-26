import { canRunAsUser, getWebViewMode, showLoginPrompt } from '@devvit/web/client';

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

/**
 * Reddit's own check that the player has let the app post as them, asking them if they have not.
 * Called from the tap that confirms a comment, which must be a trusted event. Resolves false if
 * they said no, or if nothing answered within a minute, so a comment is never sent without it.
 */
export const mayPostAsUser = async (event: Event): Promise<boolean> => {
  if (!onReddit()) return true;
  try {
    return await Promise.race([
      canRunAsUser(event),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 60_000)),
    ]);
  } catch (err) {
    // It throws for an untrusted event, which a real tap never is. Nothing is posted without a
    // clear yes.
    console.warn('[comment] consent check failed', err);
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
