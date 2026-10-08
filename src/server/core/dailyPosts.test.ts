import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What the daily job puts on Reddit when the day turns, against in-memory stand-ins for Devvit's
 * Redis and Reddit: today's map post titled with yesterday's challenge, its pinned comment naming
 * yesterday's best players, and yesterday's post given its closing line.
 */

const strings = new Map<string, string>();
const hashes = new Map<string, Map<string, string>>();
const has = (k: string) => strings.has(k) || hashes.has(k);

const redis = {
  get: async (k: string) => strings.get(k),
  set: async (k: string, v: string, o?: { nx?: boolean }) => {
    if (o?.nx && has(k)) return;
    strings.set(k, v);
  },
  del: async (...keys: string[]) => keys.forEach((k) => strings.delete(k)),
  exists: async (...keys: string[]) => keys.filter(has).length,
  expire: async () => {},
  hSet: async (k: string, fields: Record<string, string>) => {
    const h = hashes.get(k) ?? new Map<string, string>();
    for (const [f, v] of Object.entries(fields)) h.set(f, v);
    hashes.set(k, h);
  },
};

const posts: Array<{ id: string; title: string }> = [];
const comments: Array<{ id: string; parent: string; text: string; pinned: boolean }> = [];
const templates: Array<{ id: string; text: string; backgroundColor: string; textColor: string }> =
  [];
const flairs = new Map<string, string | undefined>();
const reddit = {
  getPostFlairTemplates: async () => [...templates],
  createPostFlairTemplate: async (o: {
    text: string;
    backgroundColor: string;
    textColor: string;
  }) => {
    const t = { ...o, id: `tmpl-${templates.length + 1}` };
    templates.push(t);
    return t;
  },
  setPostFlair: async (o: { postId: string; text?: string }) => void flairs.set(o.postId, o.text),
  submitCustomPost: async (o: { title: string }) => {
    const post = { id: `t3_${posts.length + 1}`, title: o.title };
    posts.push(post);
    return post;
  },
  submitComment: async (o: { id: string; text: string }) => {
    const c = { id: `t1_${comments.length + 1}`, parent: o.id, text: o.text, pinned: false };
    comments.push(c);
    return { id: c.id, distinguish: async (sticky?: boolean) => void (c.pinned = !!sticky) };
  },
};

vi.mock('@devvit/web/server', () => ({
  redis,
  reddit,
  context: { subredditName: 'stonefall' },
  realtime: {},
}));

const { Maps, dayOf } = await import('./maps');
const { Plots } = await import('./plots');
const { MAP_CURRENT } = await import('./keys');

beforeEach(() => {
  strings.clear();
  hashes.clear();
  posts.length = 0;
  comments.length = 0;
  templates.length = 0;
  flairs.clear();
  vi.restoreAllMocks();
});

const yesterday = dayOf(Date.now() - 86_400_000);

describe('a new day’s map post', () => {
  it('leads with yesterday’s challenge, names its best players, and closes yesterday’s', async () => {
    strings.set(MAP_CURRENT, JSON.stringify({ day: yesterday, postId: 't3_old', openedAt: 1 }));
    vi.spyOn(Plots, 'standings').mockResolvedValue({
      ranked: [
        { faction: 'cobalt', cells: 14 },
        { faction: 'rose', cells: 12 },
      ],
      best: { username: 'kv_nine', score: 12400 },
      most: { username: 'orbit_wren', cells: 6 },
      builders: 9,
      towers: 31,
    });

    const opened = await Maps.openToday();
    expect(opened.created).toBe(true);

    expect(posts).toHaveLength(1);
    expect(posts[0]!.title).toMatch(
      /^Beat 12,400, yesterday's best tower\. Cobalt edged Rose by 2 cells\. Stonefall map, /
    );
    expect(flairs.get(opened.postId)).toBe('Map');

    const pinned = comments.find((c) => c.parent === opened.postId)!;
    expect(pinned.pinned).toBe(true);
    expect(pinned.text).toMatch(/^\*\*Yesterday\.\*\* Best tower: u\/kv_nine, \*\*12,400\*\*\. /);
    expect(pinned.text).toContain('Most land: u/orbit_wren, 6 cells.');
    expect(pinned.text).toContain('**Scores.**');

    // Read once, for both posts.
    expect(Plots.standings).toHaveBeenCalledTimes(1);
    const closing = comments.find((c) => c.parent === 't3_old')!;
    expect(closing.text).toMatch(/^That's the day\. \*\*Cobalt\*\* held the most ground/);
  });

  it('is only the day, with a plain pinned comment, when there was no yesterday', async () => {
    vi.spyOn(Plots, 'standings');
    const opened = await Maps.openToday();
    expect(posts[0]!.title).toMatch(/^Stonefall map, \w{3} \d{1,2} \w{3}$/);
    expect(Plots.standings).not.toHaveBeenCalled();
    const pinned = comments.find((c) => c.parent === opened.postId)!;
    expect(pinned.text.startsWith('**Scores.**')).toBe(true);
  });

  it('still goes up when yesterday cannot be read', async () => {
    strings.set(MAP_CURRENT, JSON.stringify({ day: yesterday, postId: 't3_old', openedAt: 1 }));
    vi.spyOn(Plots, 'standings').mockRejectedValue(new Error('redis down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const opened = await Maps.openToday();
    expect(opened.created).toBe(true);
    expect(posts[0]!.title).toMatch(/^Stonefall map, /);
  });
});
