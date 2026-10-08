/*
 * The first screen's reads, started while the game's script is still on its way.
 *
 * The board and the player come from the server, and the game used to ask for them only once its
 * own script, a third of a megabyte, had arrived and run, so the post waited for the two one after
 * the other. This file is tiny and loads async from index.html, so the reads go out with the page
 * and the answers are usually waiting by the time the game asks (utils/early.ts). Async, not
 * defer: a deferred script also waits for the stylesheet.
 *
 * Devvit's own script is the first thing in <head> (the CLI puts it there on upload) and has
 * already wrapped fetch with the post's token, so these are the same requests the game would make.
 * A separate file rather than an inline script, which the web view's policy may refuse.
 *
 * The URLs must be exactly what the game asks for first; early.test.ts holds them to EARLY_READS.
 */
(function () {
  // The game got here first and is reading for itself.
  if (window.__early !== undefined) return;
  var kind;
  try {
    kind = window.devvit.context.postData.kind;
  } catch {
    kind = undefined;
  }
  var relay = kind === 'relay';
  if (kind !== 'relay' && kind !== 'map') {
    try {
      relay = new URLSearchParams(location.search).has('relay');
    } catch {
      relay = false;
    }
  }
  var urls = relay
    ? ['/api/relay/state?view=post', '/api/map/today']
    : ['/api/board?view=post', '/api/me', '/api/social/feed?limit=12', '/api/relay/today'];
  var early = {};
  for (var i = 0; i < urls.length; i++) {
    try {
      early[urls[i]] = fetch(urls[i]);
      // An early read nobody takes must not surface as an unhandled rejection.
      early[urls[i]].catch(function () {});
    } catch {
      // The game asks again for anything missing here.
    }
  }
  window.__early = early;
})();
