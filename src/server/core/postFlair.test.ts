import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The flair on the game's posts, against in-memory stand-ins for Devvit's Redis and Reddit: one
 * template per kind, made once and kept as a moderator leaves it, and the one-off pass over the
 * posts from before.
 */

const strings = new Map<string, string>();
const redis = {
  get: async (k: string) => strings.get(k),
  set: async (k: string, v: string) => void strings.set(k, v),
  exists: async (...keys: string[]) => keys.filter((k) => strings.has(k)).length,
};

interface Template {
  id: string;
  text: string;
  backgroundColor: string;
  textColor: 'light' | 'dark';
  modOnly: boolean;
}
const templates: Template[] = [];
interface Flair {
  flairTemplateId?: string;
  text?: string;
  backgroundColor?: string;
  textColor?: string;
}
const flairs = new Map<string, Flair>();
const listed: Array<{ id: string; authorName: string; flair?: { text: string }; kind?: string }> =
  [];

const reddit = {
  getPostFlairTemplates: vi.fn(async () => [...templates]),
  createPostFlairTemplate: vi.fn(async (o: Omit<Template, 'id'>) => {
    const t = { ...o, id: `tmpl-${templates.length + 1}` };
    templates.push(t);
    return t;
  }),
  setPostFlair: vi.fn(async (o: { postId: string; subredditName: string } & Flair) => {
    const { flairTemplateId, text, backgroundColor, textColor } = o;
    flairs.set(
      o.postId,
      JSON.parse(JSON.stringify({ flairTemplateId, text, backgroundColor, textColor }))
    );
  }),
  getAppUser: async () => ({ username: 'stonefall99' }),
  getNewPosts: () => ({
    all: async () =>
      listed.map((p) => ({
        ...p,
        getPostData: async () => (p.kind ? { kind: p.kind } : undefined),
      })),
  }),
};

vi.mock('@devvit/web/server', () => ({ redis, reddit, context: { subredditName: 'stonefall' } }));

const { PostFlair } = await import('./postFlair');

beforeEach(() => {
  strings.clear();
  templates.length = 0;
  flairs.clear();
  listed.length = 0;
  vi.clearAllMocks();
});

describe('the flair on a new post', () => {
  it('makes a moderator-only template the first time, and reuses it after', async () => {
    await PostFlair.put('t3_a', 'map');
    await PostFlair.put('t3_b', 'map');
    await PostFlair.put('t3_c', 'relay');

    expect(reddit.createPostFlairTemplate).toHaveBeenCalledTimes(2);
    expect(templates.map((t) => [t.text, t.modOnly])).toEqual([
      ['Map', true],
      ['Relay', true],
    ]);
    expect(flairs.get('t3_a')).toMatchObject({ flairTemplateId: 'tmpl-1', text: 'Map' });
    expect(flairs.get('t3_b')).toMatchObject({ flairTemplateId: 'tmpl-1', text: 'Map' });
    expect(flairs.get('t3_c')).toMatchObject({ flairTemplateId: 'tmpl-2', text: 'Relay' });
  });

  it('keeps a template as a moderator restyled it', async () => {
    await PostFlair.put('t3_a', 'map');
    Object.assign(templates[0]!, {
      text: 'Daily map',
      backgroundColor: '#ffd23d',
      textColor: 'dark',
    });

    await PostFlair.put('t3_b', 'map');
    expect(reddit.createPostFlairTemplate).toHaveBeenCalledTimes(1);
    expect(flairs.get('t3_b')).toEqual({
      flairTemplateId: 'tmpl-1',
      text: 'Daily map',
      backgroundColor: '#ffd23d',
      textColor: 'dark',
    });
  });

  it('uses a template the subreddit already has under the same name', async () => {
    templates.push({
      id: 'mods-own',
      text: 'Relay',
      backgroundColor: 'transparent',
      textColor: 'dark',
      modOnly: true,
    });
    await PostFlair.put('t3_a', 'relay');
    expect(reddit.createPostFlairTemplate).not.toHaveBeenCalled();
    // A transparent template is sent no colour, which keeps it transparent.
    expect(flairs.get('t3_a')).toEqual({
      flairTemplateId: 'mods-own',
      text: 'Relay',
      textColor: 'dark',
    });
  });

  it('makes another when a moderator deleted it', async () => {
    await PostFlair.put('t3_a', 'map');
    templates.length = 0;
    await PostFlair.put('t3_b', 'map');
    expect(reddit.createPostFlairTemplate).toHaveBeenCalledTimes(2);
    expect(flairs.get('t3_b')).toMatchObject({ text: 'Map' });
  });

  it('never fails the post when Reddit refuses', async () => {
    reddit.setPostFlair.mockRejectedValueOnce(new Error('403'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(PostFlair.put('t3_a', 'map')).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });
});

describe('the posts from before post flairs', () => {
  it('flairs the game’s own posts by kind, once, and leaves every other post alone', async () => {
    listed.push(
      { id: 't3_map', authorName: 'stonefall99', kind: 'map' },
      { id: 't3_relay', authorName: 'stonefall99', kind: 'relay' },
      { id: 't3_flaired', authorName: 'stonefall99', kind: 'map', flair: { text: 'Event' } },
      { id: 't3_nokind', authorName: 'stonefall99' },
      { id: 't3_player', authorName: 'kv_nine', kind: 'map' }
    );

    expect(await PostFlair.backfill()).toBe(2);
    expect([...flairs.keys()].sort()).toEqual(['t3_map', 't3_relay']);
    expect(flairs.get('t3_map')).toMatchObject({ text: 'Map' });
    expect(flairs.get('t3_relay')).toMatchObject({ text: 'Relay' });
    // One look-up per kind, not per post.
    expect(reddit.getPostFlairTemplates).toHaveBeenCalledTimes(2);

    expect(await PostFlair.backfilled()).toBe(true);
    expect(await PostFlair.backfill()).toBe(0);
    expect(reddit.setPostFlair).toHaveBeenCalledTimes(2);
  });
});
