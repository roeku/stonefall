import { createTelemetryClient } from '@devvit/analytics/client/reddit';
import { createJourneys, memorySession } from './journeys';

/**
 * Devvit Journeys, bound to this page. What each journey means for the game is in `journeys.ts`.
 *
 * Events go to `/api/telemetry/*`, which the server hands to the SDK's router. The platform takes
 * them because `devvit.json` sets `permissions.journeys`, and says in each response's receipt
 * whether the event was recorded.
 */
const session = memorySession();

export const Telemetry = createJourneys({
  sdk: createTelemetryClient({ journeySession: session }),
  // keepalive lets a request outlive the page that sent it.
  exitSdk: createTelemetryClient({
    journeySession: session,
    fetch: (input, init) => fetch(input, { ...init, keepalive: true }),
  }),
  warn: (message) => console.warn(message),
});

// A post scrolled out of the feed or closed takes its open journey with it, as not completed.
// `pagehide` rather than `visibilitychange`: a hidden page can come back and carry on.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => Telemetry.leave());
}
