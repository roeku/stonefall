import type {
  TelemetryClient,
  TelemetryJourneySessionHelper,
} from '@devvit/analytics/client/reddit';

/**
 * What a Devvit Journey is in Stonefall.
 *
 * The SDK is injected, so this file holds the rules and nothing that talks to the network, and a
 * test can drive it with a fake. `telemetry.ts` binds it to the real client and the page.
 *
 * There are two journeys, one per post:
 *
 *   run     starts on Build (or a card's Take it / Beat it, or Again), progresses at tower-height
 *           milestones, and completes when the finished tower is raised onto the grid. A run
 *           that is discarded, replaced by another run, not saved, or left behind with the page
 *           ends as not completed. A stacker has no win state, so completion is the funnel that
 *           matters: how many runs leave a tower behind for somebody else to see.
 *   relay   a sitting. Starts when the player takes a seat, progresses at blocks they have landed,
 *           and ends when the seat does. A fall or the day topping out is the relay's own ending
 *           and completes it; a seat given up by letting turns run out, or a page left, does not.
 *           Topping out still standing is the only win the relay has.
 *
 * Every call is fire-and-forget. Nothing in the game awaits one, and every failure is swallowed:
 * an endpoint that is slow, rate limited, or absent (the local harness) must never make a drop
 * feel late or a button look broken.
 */

type Sdk = Pick<
  TelemetryClient,
  'appReady' | 'startJourney' | 'progress' | 'interaction' | 'endJourney'
>;

export type JourneyKind = 'run' | 'relay';

interface Milestone {
  /** Blocks. */
  at: number;
  progress: number;
}

/** Tower height, scaled so a strong run reaches 1.0. */
export const RUN_MILESTONES: readonly Milestone[] = [
  { at: 10, progress: 0.2 },
  { at: 25, progress: 0.4 },
  { at: 50, progress: 0.6 },
  { at: 80, progress: 0.8 },
  { at: 120, progress: 1 },
];

/**
 * Blocks one player has landed in a sitting. The first is its own milestone because it is the
 * one that says a seat turned into play; fifteen is several minutes of rotations.
 */
export const RELAY_MILESTONES: readonly Milestone[] = [
  { at: 1, progress: 0.2 },
  { at: 3, progress: 0.4 },
  { at: 6, progress: 0.6 },
  { at: 10, progress: 0.8 },
  { at: 15, progress: 1 },
];

/** A call that has not answered in this long stops holding up the ones queued behind it. */
const CALL_TIMEOUT_MS = 8_000;

export interface JourneysOptions {
  sdk: Sdk;
  /** The same journeys over `keepalive`, for the one call made while the page is going away. */
  exitSdk?: Pick<TelemetryClient, 'endJourney'>;
  /** Told once per receipt status that says an event was not recorded. */
  warn?: (message: string) => void;
  timeoutMs?: number;
}

export type Journeys = ReturnType<typeof createJourneys>;

export const createJourneys = ({
  sdk,
  exitSdk = sdk,
  warn = () => undefined,
  timeoutMs = CALL_TIMEOUT_MS,
}: JourneysOptions) => {
  /**
   * Every event waits for the one before it.
   *
   * The SDK attaches an event to whatever journey id it holds when the event is sent, and it only
   * waits 100 ms for a start that is still in flight. Sent side by side, the interaction that
   * follows a start goes out with no journey, and a start that follows an end reuses the id the
   * end is about to clear. One at a time, each lands on the journey it belongs to.
   */
  let queue: Promise<void> = Promise.resolve();
  let open: { kind: JourneyKind; sent: Set<number>; landed: number } | null = null;
  let readySent = false;
  const reported = new Set<string>();

  /**
   * A receipt is the only word on whether an event was recorded; a 200 is not. The first of each
   * kind of refusal (rate limited, duplicate, invalid) is said out loud, so it reaches `devvit logs`.
   */
  const note = (res: unknown): void => {
    const receipt = (res as { receipt?: { status?: unknown; message?: unknown } } | undefined)
      ?.receipt;
    const status = receipt?.status;
    if (typeof status !== 'string' || status === 'JOURNEY_RECEIPT_VALID') return;
    if (reported.has(status)) return;
    reported.add(status);
    warn(`[journeys] ${typeof receipt?.message === 'string' ? receipt.message : status}`);
  };

  const send = (call: () => Promise<unknown>): void => {
    queue = queue.then(
      () =>
        new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, timeoutMs);
          void Promise.resolve()
            .then(call)
            .then(note, () => undefined)
            .finally(() => {
              clearTimeout(timer);
              resolve();
            });
        })
    );
  };

  const begin = (kind: JourneyKind): void => {
    // Whatever is still open never reached an ending of its own: a finished tower abandoned for
    // another run, a sitting whose seat went unnoticed. It ends here, not completed, so this
    // start is recorded as a start rather than quietly folded into the old journey.
    if (open) send(() => sdk.endJourney({ complete: false }));
    open = { kind, sent: new Set(), landed: 0 };
    send(() => sdk.startJourney());
  };

  const reach = (
    kind: JourneyKind,
    blocks: number,
    milestones: readonly Milestone[],
    action: string
  ): void => {
    const journey = open;
    if (!journey || journey.kind !== kind) return;
    for (const m of milestones) {
      if (blocks < m.at || journey.sent.has(m.at)) continue;
      journey.sent.add(m.at);
      send(() => sdk.progress({ progress: m.progress, action, actionDetails: `${m.at}_blocks` }));
    }
  };

  const finish = (kind: JourneyKind, complete: boolean, win: boolean, score: number): void => {
    if (!open || open.kind !== kind) return;
    open = null;
    send(() => sdk.endJourney({ complete, game: { win, score: Math.max(0, Math.round(score)) } }));
  };

  return {
    /** Drawn with real data and touchable. Once per page. */
    appReady(): void {
      if (readySent) return;
      readySent = true;
      send(() => sdk.appReady());
    },

    runStarted(): void {
      begin('run');
    },

    /**
     * The tower's height as it grows. Called on every block, which is why milestones are
     * remembered: a hundred-block run would otherwise say the same thing a hundred times.
     */
    runProgress(blocks: number): void {
      reach('run', blocks, RUN_MILESTONES, 'tower_height');
    },

    /**
     * The run resolved. `placed` is completion: the tower is on the board. `won` is what the
     * player was chasing: beating somebody, taking their land, or beating themselves.
     */
    runEnded(opts: { placed: boolean; won: boolean; score: number }): void {
      finish('run', opts.placed, opts.won, opts.score);
    },

    relayJoined(): void {
      begin('relay');
    },

    /**
     * One of the player's own blocks landed. A seat carried over from an earlier page, where the
     * player sat down before this page existed, starts its journey at the first block they drop.
     */
    relayLanded(): void {
      if (open?.kind !== 'relay') begin('relay');
      const journey = open!;
      journey.landed += 1;
      reach('relay', journey.landed, RELAY_MILESTONES, 'blocks_landed');
    },

    /** The seat is gone: the player fell, the day topped out, or it was given up. */
    relayEnded(opts: { fell: boolean; toppedOut: boolean }): void {
      const landed = open?.kind === 'relay' ? open.landed : 0;
      finish('relay', opts.fell || opts.toppedOut, opts.toppedOut && !opts.fell, landed);
    },

    /**
     * One of the discrete things a person chooses to do. Only committed actions, fired once they
     * have happened: never a view, never the press that has not been released yet. `detail`
     * names a kind of thing, never a person and never a free number.
     */
    did(action: string, detail?: string): void {
      send(() => sdk.interaction(detail ? { action, actionDetails: detail } : { action }));
    },

    /**
     * The page is going away with a journey still open. Sent straight away rather than queued:
     * nothing queued behind a round trip is going to leave a page that is being torn down.
     */
    leave(): void {
      if (!open) return;
      open = null;
      void exitSdk.endJourney({ complete: false }).catch(() => undefined);
    },

    /** Settles once everything sent so far has been answered or given up on. For tests. */
    drained(): Promise<void> {
      return queue;
    },
  };
};

/**
 * The journey id, held in memory.
 *
 * The SDK's default keeps it in localStorage for thirty idle minutes and hands it back to the next
 * page. Nothing a journey stands for here outlives its page: a run in progress and a finished
 * tower waiting to be raised are both page state. And the map and relay posts share one origin
 * and can both be open in a feed at once, so a stored id would stitch a run and a sitting into one
 * journey.
 */
export const memorySession = (): TelemetryJourneySessionHelper => {
  let id: string | undefined;
  return {
    getActiveJourneyId: () => id,
    setJourneyId: (next) => {
      id = next.trim().length > 0 ? next : undefined;
    },
    clearJourneyId: () => {
      id = undefined;
    },
    isPersistent: () => false,
  };
};
