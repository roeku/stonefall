import { context, reddit, redis } from '@devvit/web/server';
import type { FlairTemplate } from '@devvit/web/server';
import { POST_FLAIR_DONE, postFlairTemplateKey } from './keys';

/** The two kinds of post the game makes, as `postData.kind` says them. */
export type PostKind = 'map' | 'relay';

const isPostKind = (v: unknown): v is PostKind => v === 'map' || v === 'relay';

/**
 * What each kind's flair looks like when the app makes its template: the word the game's tabs use,
 * on the post's own dark. A moderator can rename or recolour the template in the subreddit's
 * settings, and the app keeps using it as they left it.
 */
const LOOKS: Record<PostKind, { text: string; backgroundColor: string; textColor: 'light' }> = {
  map: { text: 'Map', backgroundColor: '#000814', textColor: 'light' },
  relay: { text: 'Relay', backgroundColor: '#000814', textColor: 'light' },
};

/** How far back the one-off pass looks for the app's own posts without a flair. */
const BACKFILL_POSTS = 100;

/** Posts flaired at once by that pass. */
const BACKFILL_CHUNK = 10;

/**
 * The flair on the game's own posts, "Map" or "Relay", so the subreddit's feed says which a post
 * is before it is opened, and a reader can filter by it. Each is a moderator-only template the app
 * makes the first time it needs one, so players can't put it on their own posts.
 *
 * Set after the post is up, never as part of making it: a template a moderator deleted, or
 * Reddit refusing, leaves the day's post without a flair rather than without a post.
 */
export const PostFlair = {
  /**
   * The subreddit's template for this kind: the one the app made, else one already called the
   * same, else a new one.
   */
  async template(subredditName: string, kind: PostKind): Promise<FlairTemplate> {
    const key = postFlairTemplateKey(kind);
    const [templates, stored] = await Promise.all([
      reddit.getPostFlairTemplates(subredditName),
      redis.get(key),
    ]);
    const found =
      templates.find((t) => t.id === stored) ?? templates.find((t) => t.text === LOOKS[kind].text);
    if (found) {
      if (found.id !== stored) await redis.set(key, found.id);
      return found;
    }
    const made = await reddit.createPostFlairTemplate({
      subredditName,
      ...LOOKS[kind],
      allowableContent: 'text',
      modOnly: true,
      allowUserEdits: false,
    });
    await redis.set(key, made.id);
    return made;
  },

  /** Flair one post with a template, in the template's own words and colours. */
  async apply(subredditName: string, postId: string, t: FlairTemplate): Promise<void> {
    await reddit.setPostFlair({
      subredditName,
      postId: postId as `t3_${string}`,
      flairTemplateId: t.id,
      // Left out, Devvit sends blank text and dark text colour, which would override the template.
      text: t.text,
      textColor: t.textColor,
      ...(t.backgroundColor !== 'transparent' ? { backgroundColor: t.backgroundColor } : {}),
    });
  },

  /** Flair a post the game just made. Never fails the caller. */
  async put(postId: string, kind: PostKind): Promise<void> {
    const { subredditName } = context;
    if (!subredditName) return;
    try {
      await this.apply(subredditName, postId, await this.template(subredditName, kind));
    } catch (err) {
      console.error(`post flair: could not flair the ${kind} post`, err);
    }
  },

  /** Whether `backfill` has been through this install's posts. */
  async backfilled(): Promise<boolean> {
    return (await redis.exists(POST_FLAIR_DONE)) > 0;
  },

  /**
   * Once per install: flair the game's posts from before post flairs, among the subreddit's
   * newest, so filtering by "Map" finds the old days too. A post that has any flair already, a
   * moderator's included, is left alone. Throws when Reddit refuses, so a failure waits for the
   * next upgrade instead of retrying at once.
   */
  async backfill(): Promise<number> {
    if (await this.backfilled()) return 0;
    const { subredditName } = context;
    if (!subredditName) return 0;
    const app = await reddit.getAppUser();
    if (!app) throw new Error('post flair: no app account to tell its posts by');
    const posts = await reddit.getNewPosts({ subredditName, limit: BACKFILL_POSTS }).all();
    const ours = posts.filter((p) => p.authorName === app.username && !p.flair?.text);
    const templates = new Map<PostKind, FlairTemplate>();
    let flaired = 0;
    for (let i = 0; i < ours.length; i += BACKFILL_CHUNK) {
      const chunk = ours.slice(i, i + BACKFILL_CHUNK);
      const kinds = await Promise.all(chunk.map(async (p) => (await p.getPostData())?.kind));
      for (const [j, kind] of kinds.entries()) {
        if (!isPostKind(kind)) continue;
        const t = templates.get(kind) ?? (await this.template(subredditName, kind));
        templates.set(kind, t);
        await this.apply(subredditName, chunk[j]!.id, t);
        flaired++;
      }
    }
    await redis.set(POST_FLAIR_DONE, String(Date.now()));
    return flaired;
  },
};
