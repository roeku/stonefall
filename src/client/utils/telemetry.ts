import { telemetry } from '@devvit/analytics/client/reddit';

/**
 * Devvit Journeys, wrapped so gameplay can never be taken down by analytics.
 *
 * Every call here is fire-and-forget and swallows its own errors. A telemetry endpoint that is
 * slow, rate limited, or simply absent (it is absent in the local harness) must not make a drop
 * feel late or a button look broken, so nothing in the game ever awaits one of these.
 *
 * What the journey means for this game, which is the part worth writing down because the
 * dashboard is only as useful as the mapping:
 *
 *   app.ready          the board has drawn with real data and can be touched
 *   journey.start      a run began
 *   journey.progress   milestones of tower height, scaled so a strong run reaches 1.0
 *   journey.interaction the discrete things a person chooses to do
 *   journey.end        the run resolved, complete when the tower actually went onto the grid
 *
 * `complete` is deliberately tied to placement rather than to the run ending. A stacker has no
 * win state, so completion_rate is only interesting if it measures the funnel that matters:
 * how many people who start a run leave a tower behind on the board for someone else to see.
 */

/** Block counts that map to a fraction of a strong run. */
const PROGRESS_STEPS: ReadonlyArray<{ blocks: number; progress: number }> = [
  { blocks: 10, progress: 0.2 },
  { blocks: 25, progress: 0.4 },
  { blocks: 50, progress: 0.6 },
  { blocks: 80, progress: 0.8 },
  { blocks: 120, progress: 1.0 },
];

/** Milestones already sent for the current run, so a re-render cannot double-report. */
let sentSteps = new Set<number>();
let appReadySent = false;

const swallow = (p: Promise<unknown>) => {
  void p.catch(() => {
    // Analytics is never load-bearing.
  });
};

export const Telemetry = {
  /** The app is drawn and interactive. Sent once per page load. */
  appReady(): void {
    if (appReadySent) return;
    appReadySent = true;
    swallow(telemetry.appReady());
  },

  /** A run began. Resets the milestone set so the next run reports its own progress. */
  runStarted(): void {
    sentSteps = new Set();
    swallow(telemetry.startJourney());
  },

  /**
   * Report height milestones as the tower grows.
   *
   * Called on every placement, which is why the guard matters: without it a hundred-block run
   * would send a hundred progress events and tell the dashboard nothing.
   */
  runProgress(blocks: number): void {
    for (const step of PROGRESS_STEPS) {
      if (blocks < step.blocks || sentSteps.has(step.blocks)) continue;
      sentSteps.add(step.blocks);
      swallow(
        telemetry.progress({
          progress: step.progress,
          action: 'tower_height',
          actionDetails: `${step.blocks}_blocks`,
        })
      );
    }
  },

  /** One of the discrete things a person chooses to do. */
  did(action: string, detail?: string): void {
    swallow(telemetry.interaction({ action, ...(detail ? { actionDetails: detail } : {}) }));
  },

  /**
   * The run resolved.
   *
   * `placed` is completion: the tower is on the board. `won` is the thing the player was
   * actually chasing, which is beating somebody or beating themselves.
   */
  runEnded(opts: { placed: boolean; won: boolean; score: number }): void {
    swallow(
      telemetry.endJourney({
        complete: opts.placed,
        game: { win: opts.won, score: Math.max(0, Math.round(opts.score)) },
      })
    );
  },
};
