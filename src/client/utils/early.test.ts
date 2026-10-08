import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EARLY, EARLY_READS, fetchEarly } from './early';

const BOOT = readFileSync(resolve(__dirname, '../public/boot.js'), 'utf8');

/** Runs boot.js the way a page would, and says what it asked for. */
const boot = (opts: { kind?: string; search?: string; early?: object }) => {
  const asked: string[] = [];
  const window: Record<string, unknown> = {};
  if (opts.kind) window.devvit = { context: { postData: { kind: opts.kind } } };
  if (opts.early) window.__early = opts.early;
  runInNewContext(BOOT, {
    window,
    location: { search: opts.search ?? '' },
    URLSearchParams,
    fetch: (url: string) => {
      asked.push(url);
      return Promise.resolve(new Response('{}'));
    },
  });
  return { asked, early: window.__early as Record<string, unknown> | undefined };
};

describe('boot.js', () => {
  it('asks for what the map post reads first', () => {
    const { asked, early } = boot({ kind: 'map' });
    expect(asked).toEqual([...EARLY_READS.map]);
    expect(Object.keys(early ?? {})).toEqual([...EARLY_READS.map]);
  });

  it('asks for what the relay post reads first', () => {
    expect(boot({ kind: 'relay' }).asked).toEqual([...EARLY_READS.relay]);
  });

  it('reads ?relay outside the platform, as Root does', () => {
    expect(boot({ search: '?relay' }).asked).toEqual([...EARLY_READS.relay]);
    expect(boot({ search: '' }).asked).toEqual([...EARLY_READS.map]);
  });

  it('trusts the post over the URL', () => {
    expect(boot({ kind: 'map', search: '?relay' }).asked).toEqual([...EARLY_READS.map]);
  });

  it('asks for nothing once the game has started reading for itself', () => {
    expect(boot({ early: {} }).asked).toEqual([]);
  });
});

describe('fetchEarly', () => {
  const network = vi.fn((url: string) => Promise.resolve(new Response(`net ${url}`)));

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
    network.mockClear();
    vi.unstubAllGlobals();
  });

  const page = (early?: Record<string, Promise<Response>>) => {
    vi.stubGlobal('fetch', network);
    vi.stubGlobal('window', early === undefined ? {} : { __early: early });
  };

  it('answers the first read of a URL with the early one, and later reads from the network', async () => {
    page({ [EARLY.me]: Promise.resolve(new Response('early')) });
    expect(await (await fetchEarly(EARLY.me)).text()).toBe('early');
    expect(network).not.toHaveBeenCalled();
    expect(await (await fetchEarly(EARLY.me)).text()).toBe(`net ${EARLY.me}`);
  });

  it('goes to the network for a URL boot.js did not ask for', async () => {
    page({ [EARLY.me]: Promise.resolve(new Response('early')) });
    expect(await (await fetchEarly('/api/board')).text()).toBe('net /api/board');
  });

  it('asks again when the early read failed', async () => {
    page({ [EARLY.board]: Promise.reject(new Error('offline')) });
    expect(await (await fetchEarly(EARLY.board)).text()).toBe(`net ${EARLY.board}`);
  });

  it('claims the slot when the game reads before boot.js has run', async () => {
    page();
    await fetchEarly(EARLY.board);
    expect(window.__early).toEqual({});
    expect(network).toHaveBeenCalledWith(EARLY.board);
  });
});
