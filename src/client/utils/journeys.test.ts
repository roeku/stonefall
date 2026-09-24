import { afterEach, describe, expect, it, vi } from 'vitest';
import { createJourneys, memorySession, type JourneysOptions } from './journeys';

/**
 * The dashboard is only as good as the journeys behind it. These pin what one journey is -- one
 * start, each milestone once, one end, in that order -- and the ways the old wiring let journeys
 * run into each other: events racing the start they belong to, a new start reusing an old id, a
 * run with no ending, and a page leaving with its journey open.
 */

const VALID = { status: 'JOURNEY_RECEIPT_VALID', message: 'Success: Event was recorded.' };
const DENIED = {
  status: 'JOURNEY_RECEIPT_DENIED_RATE_LIMITED',
  message: 'Denied: Event was rate limited.',
};

type Call = { method: string; input?: unknown };

/** An SDK that records what it was asked, in order, and answers at once unless held. */
const fakeSdk = (receipt: { status: string; message: string } = VALID) => {
  const calls: Call[] = [];
  let starts = 0;
  let hold: Promise<void> | null = null;
  const answer = async (method: string, input?: unknown, extra: object = {}) => {
    calls.push(input === undefined ? { method } : { method, input });
    if (hold) await hold;
    return { receipt, ...extra };
  };
  const sdk = {
    appReady: () => answer('appReady'),
    startJourney: () => answer('start', undefined, { journeyId: `j${++starts}` }),
    progress: (input: unknown) => answer('progress', input),
    interaction: (input: unknown) => answer('interaction', input),
    endJourney: (input?: unknown) => answer('end', input),
  };
  return {
    sdk: sdk as unknown as JourneysOptions['sdk'],
    calls,
    methods: () => calls.map((c) => c.method),
    /** Holds every answer until the returned function is called. */
    holdAnswers: () => {
      let release = () => {};
      hold = new Promise<void>((r) => (release = r));
      return () => {
        hold = null;
        release();
      };
    },
  };
};

afterEach(() => {
  vi.useRealTimers();
});

describe('a run', () => {
  it('is one start, each height milestone once, and one end', async () => {
    const { sdk, calls } = fakeSdk();
    const j = createJourneys({ sdk });

    j.runStarted();
    for (const blocks of [2, 10, 11, 30, 30, 130]) j.runProgress(blocks);
    j.runEnded({ placed: true, won: true, score: 1234.6 });
    await j.drained();

    expect(calls).toEqual([
      { method: 'start' },
      {
        method: 'progress',
        input: { progress: 0.2, action: 'tower_height', actionDetails: '10_blocks' },
      },
      {
        method: 'progress',
        input: { progress: 0.4, action: 'tower_height', actionDetails: '25_blocks' },
      },
      {
        method: 'progress',
        input: { progress: 0.6, action: 'tower_height', actionDetails: '50_blocks' },
      },
      {
        method: 'progress',
        input: { progress: 0.8, action: 'tower_height', actionDetails: '80_blocks' },
      },
      {
        method: 'progress',
        input: { progress: 1, action: 'tower_height', actionDetails: '120_blocks' },
      },
      { method: 'end', input: { complete: true, game: { win: true, score: 1235 } } },
    ]);
  });

  it('sends nothing for an event until the start before it has answered', async () => {
    const fake = fakeSdk();
    const j = createJourneys({ sdk: fake.sdk });
    const release = fake.holdAnswers();

    j.runStarted();
    j.did('aim_take', 'rival');
    await new Promise((r) => setTimeout(r, 20));
    // The SDK would have sent the interaction 100 ms into a slow start, with no journey on it.
    expect(fake.methods()).toEqual(['start']);

    release();
    await j.drained();
    expect(fake.methods()).toEqual(['start', 'interaction']);
  });

  it('ends a run left open, not completed, before the next one starts', async () => {
    const { sdk, calls } = fakeSdk();
    const j = createJourneys({ sdk });

    j.runStarted();
    j.runProgress(12);
    j.runStarted();
    await j.drained();

    expect(calls.map((c) => c.method)).toEqual(['start', 'progress', 'end', 'start']);
    expect(calls[2]).toEqual({ method: 'end', input: { complete: false } });
  });

  it('starts its milestones over with each run', async () => {
    const fake = fakeSdk();
    const j = createJourneys({ sdk: fake.sdk });

    j.runStarted();
    j.runProgress(10);
    j.runEnded({ placed: false, won: false, score: 40 });
    j.runStarted();
    j.runProgress(10);
    await j.drained();

    expect(fake.methods()).toEqual(['start', 'progress', 'end', 'start', 'progress']);
  });

  it('ignores progress and endings with no run open', async () => {
    const fake = fakeSdk();
    const j = createJourneys({ sdk: fake.sdk });

    j.runProgress(50);
    j.runEnded({ placed: false, won: false, score: 0 });
    j.runStarted();
    j.relayEnded({ fell: true, toppedOut: false });
    j.runEnded({ placed: false, won: false, score: -3 });
    j.runEnded({ placed: true, won: true, score: 9 });
    await j.drained();

    expect(fake.calls).toEqual([
      { method: 'start' },
      { method: 'end', input: { complete: false, game: { win: false, score: 0 } } },
    ]);
  });
});

describe('a relay sitting', () => {
  it('counts the blocks the player landed as its progress and its score', async () => {
    const { sdk, calls } = fakeSdk();
    const j = createJourneys({ sdk });

    j.relayJoined();
    j.relayLanded();
    j.relayLanded();
    j.relayLanded();
    j.relayEnded({ fell: true, toppedOut: false });
    await j.drained();

    expect(calls).toEqual([
      { method: 'start' },
      {
        method: 'progress',
        input: { progress: 0.2, action: 'blocks_landed', actionDetails: '1_blocks' },
      },
      {
        method: 'progress',
        input: { progress: 0.4, action: 'blocks_landed', actionDetails: '3_blocks' },
      },
      // A fall is how a sitting is meant to end, so it completes; it is not a win.
      { method: 'end', input: { complete: true, game: { win: false, score: 3 } } },
    ]);
  });

  it('starts at the first block when the seat was taken on an earlier page', async () => {
    const fake = fakeSdk();
    const j = createJourneys({ sdk: fake.sdk });

    j.relayLanded();
    await j.drained();

    expect(fake.methods()).toEqual(['start', 'progress']);
  });

  it('does not complete a seat given up, and wins only by topping out standing', async () => {
    const { sdk, calls } = fakeSdk();
    const j = createJourneys({ sdk });

    j.relayJoined();
    j.relayEnded({ fell: false, toppedOut: false });
    j.relayJoined();
    j.relayLanded();
    j.relayEnded({ fell: false, toppedOut: true });
    await j.drained();

    const ends = calls.filter((c) => c.method === 'end').map((c) => c.input);
    expect(ends).toEqual([
      { complete: false, game: { win: false, score: 0 } },
      { complete: true, game: { win: true, score: 1 } },
    ]);
  });
});

describe('the page', () => {
  it('sends app.ready once', async () => {
    const fake = fakeSdk();
    const j = createJourneys({ sdk: fake.sdk });

    j.appReady();
    j.appReady();
    await j.drained();

    expect(fake.methods()).toEqual(['appReady']);
  });

  it('ends an open journey through the exit client when it goes away, once', async () => {
    const main = fakeSdk();
    const exit = fakeSdk();
    const j = createJourneys({ sdk: main.sdk, exitSdk: exit.sdk });

    j.leave();
    j.runStarted();
    j.leave();
    j.leave();
    // Nothing left to end: the run went with the page.
    j.runEnded({ placed: true, won: false, score: 5 });
    await j.drained();

    expect(main.methods()).toEqual(['start']);
    expect(exit.calls).toEqual([{ method: 'end', input: { complete: false } }]);
  });

  it('does not let a call that never answers hold up the rest', async () => {
    vi.useFakeTimers();
    const fake = fakeSdk();
    const stuck = { ...fake.sdk, startJourney: () => new Promise<never>(() => {}) };
    const j = createJourneys({ sdk: stuck, timeoutMs: 5_000 });

    j.runStarted();
    j.did('scope_changed', 'all');
    await vi.advanceTimersByTimeAsync(4_999);
    expect(fake.methods()).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    await j.drained();
    expect(fake.methods()).toEqual(['interaction']);
  });

  it('carries on past a call that fails', async () => {
    const fake = fakeSdk();
    const broken = { ...fake.sdk, appReady: () => Promise.reject(new Error('offline')) };
    const warn = vi.fn();
    const j = createJourneys({ sdk: broken, warn });

    j.appReady();
    j.runStarted();
    await j.drained();

    expect(fake.methods()).toEqual(['start']);
    expect(warn).not.toHaveBeenCalled();
  });

  it('says so once for each kind of receipt that was not recorded', async () => {
    const denied = fakeSdk(DENIED);
    const warn = vi.fn();
    const j = createJourneys({ sdk: denied.sdk, warn });

    j.appReady();
    j.runStarted();
    j.did('scope_changed', 'mine');
    await j.drained();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(`[journeys] ${DENIED.message}`);

    const valid = fakeSdk(VALID);
    const quiet = vi.fn();
    const k = createJourneys({ sdk: valid.sdk, warn: quiet });
    k.appReady();
    k.runStarted();
    await k.drained();
    expect(quiet).not.toHaveBeenCalled();
  });
});

describe('memorySession', () => {
  it('holds one id in memory and treats a blank one as none', () => {
    const s = memorySession();
    expect(s.getActiveJourneyId()).toBeUndefined();
    s.setJourneyId('abc');
    expect(s.getActiveJourneyId()).toBe('abc');
    s.setJourneyId('  ');
    expect(s.getActiveJourneyId()).toBeUndefined();
    s.setJourneyId('def');
    s.clearJourneyId();
    expect(s.getActiveJourneyId()).toBeUndefined();
    expect(s.isPersistent()).toBe(false);
  });
});
