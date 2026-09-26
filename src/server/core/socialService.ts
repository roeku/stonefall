import { context, redis, reddit } from '@devvit/web/server';
import type { BragRecord } from '../../shared/types/api';
import { SCORES_THREAD_TEXT, composeBody, type ScoreComment } from '../../shared/social/comments';
import {
  FEED_TTL_SECONDS,
  bragGuardKey,
  feedKey,
  scoresThreadKey,
  scoresThreadLockKey,
} from './keys';

/**
 * The part of Stonefall that makes people talk.
 *
 * A run is announced as a comment, as the player, and the app reads those comments back so the
 * board can show who has been saying what. A post per run would bury the game under its own
 * scores; the conversation on Reddit happens in the comments of the thread people are already in.
 *
 * Three rules hold this together.
 *
 * The player never writes the text. Every comment is assembled from a fixed set of phrasings and
 * the numbers the run actually produced (`shared/social/comments.ts`), and the game shows the
 * player that exact text, under their name, before they confirm it.
 *
 * Score comments are replies to one pinned comment the app leaves on the post, never top-level
 * comments. Devvit's rules require that for shared scores: the results fold away under one
 * comment, out of the way of the conversation, and each stays the player's own to delete.
 *
 * Redis is the index, the comment is the artifact. The comment is what people reply to and vote
 * on; the Redis record is what the board reads, so drawing the feed never costs a Reddit call.
 */

/** How many recent brags the board keeps per post. Older ones fall off the end. */
const FEED_LENGTH = 40;

/** A player gets one comment per run, for as long as a run is kept. */
const GUARD_TTL_MS = 1000 * 60 * 60 * 24 * 30;

export interface BragInput extends ScoreComment {
  sessionId: string;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const SocialService = {
  /**
   * The app's pinned comment on a post: the one score comments reply to. Made the first time a
   * post needs it, under a short lock so two players scoring at once do not pin two.
   */
  async scoresThread(postId: string): Promise<string> {
    const key = scoresThreadKey(postId);
    const known = await redis.get(key);
    if (known) return known;

    const lock = scoresThreadLockKey(postId);
    const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    await redis.set(lock, token, { nx: true, expiration: new Date(Date.now() + 30_000) });
    if ((await redis.get(lock)) !== token) {
      // Somebody else is pinning it. Their comment is usually there within a second.
      for (let i = 0; i < 6; i++) {
        await pause(500);
        const made = await redis.get(key);
        if (made) return made;
      }
      throw new Error('scores thread is being opened');
    }

    const comment = await reddit.submitComment({
      id: postId as `t3_${string}`,
      text: SCORES_THREAD_TEXT,
      runAs: 'APP',
    });
    try {
      await comment.distinguish(true);
    } catch (err) {
      // Not pinned (the app is not a moderator here) is still a single parent for the scores.
      console.warn('scores thread: could not pin', err);
    }
    await redis.set(key, String(comment.id), {
      expiration: new Date(Date.now() + FEED_TTL_SECONDS * 1000),
    });
    await redis.del(lock);
    return String(comment.id);
  },

  /**
   * Announce a run in the post's scores thread, as the player.
   *
   * `runAs: 'USER'` is what makes this worth doing: the comment is theirs, it appears in their
   * profile, they can delete it, and replies notify them. It is only ever called from the
   * player's confirmation in the game, which shows the text this posts.
   *
   * `postId` is the post it goes in: today's post, whichever post the run was played from, so
   * the day's talk collects in one place. Falls back to the post the request came from.
   */
  async brag(
    input: BragInput,
    target?: string | null
  ): Promise<{ ok: true; record: BragRecord } | { ok: false; reason: string }> {
    const postId = target ?? context.postId;
    if (!postId) return { ok: false, reason: 'No post context' };

    // One per run.
    const guard = bragGuardKey(input.sessionId);
    if (await redis.exists(guard)) return { ok: false, reason: 'Already posted this one' };
    await redis.set(guard, '1', { expiration: new Date(Date.now() + GUARD_TTL_MS) });

    const user = await reddit.getCurrentUser();
    const username = user?.username ?? 'someone';

    // The guard is claimed before the call so a double-tap cannot double-post, which means a
    // failed call has to give it back. Without this, one bad deploy silently costs every player
    // who tried during it the ability to ever announce that run: the key outlives the outage by
    // thirty days and the run is long finished by the time anyone notices.
    let comment;
    try {
      const parent = await this.scoresThread(postId);
      comment = await reddit.submitComment({
        id: parent as `t1_${string}`,
        text: composeBody(input),
        runAs: 'USER',
      });
    } catch (err) {
      await redis.del(guard);
      console.error('brag: submitComment failed', err);
      return { ok: false, reason: 'Reddit would not take the comment. Try again.' };
    }

    const record: BragRecord = {
      username,
      faction: input.faction,
      score: input.score,
      blocks: input.blocks,
      perfectStreak: input.perfectStreak,
      kind: input.kind,
      commentId: String(comment.id),
      permalink:
        typeof comment.permalink === 'string' ? `https://reddit.com${comment.permalink}` : null,
      timestamp: Date.now(),
      ...(input.passedUsername ? { passedUsername: input.passedUsername } : {}),
      ...(input.cell ? { cell: input.cell } : {}),
    };

    const key = feedKey(postId);
    await redis.zAdd(key, { member: JSON.stringify(record), score: record.timestamp });
    // Ranks run low-score-first, so dropping everything below the last FEED_LENGTH keeps the
    // newest and bounds the key.
    await redis.zRemRangeByRank(key, 0, -(FEED_LENGTH + 1));
    await redis.expire(key, FEED_TTL_SECONDS);

    return { ok: true, record };
  },

  /**
   * The recent chatter in a post's thread, newest first. Read from Redis, never from Reddit.
   *
   * `target` is today's post for the map, so every post shows the day's talk.
   */
  async feed(limit = 12, target?: string | null): Promise<BragRecord[]> {
    const postId = target ?? context.postId;
    if (!postId) return [];
    const rows = await redis.zRange(feedKey(postId), 0, Math.max(0, limit - 1), {
      by: 'rank',
      reverse: true,
    });
    const out: BragRecord[] = [];
    for (const row of rows ?? []) {
      try {
        out.push(JSON.parse(row.member) as BragRecord);
      } catch {
        // A malformed row is not worth failing a whole board render over.
      }
    }
    return out;
  },

  /** Whether a post's thread has this player on this score: a name a `passed` comment can use. */
  async inFeed(postId: string | null, username: string, score: number): Promise<boolean> {
    if (!postId) return false;
    const rows = await this.feed(FEED_LENGTH, postId);
    const name = username.toLowerCase();
    return rows.some((b) => b.username.toLowerCase() === name && b.score === score);
  },

  /**
   * Drop a comment from the feed when it is removed, and forget the pinned scores comment when
   * that is the one removed, so the next score pins a new one.
   *
   * Devvit's rules require deleted content to leave the app too, and without this the board
   * would keep quoting a comment that a moderator or the author has already taken down.
   */
  async forgetComment(commentId: string, target?: string | null): Promise<void> {
    const postId = target ?? context.postId;
    if (!postId) return;
    if ((await redis.get(scoresThreadKey(postId))) === commentId) {
      await redis.del(scoresThreadKey(postId), scoresThreadLockKey(postId));
    }
    const rows = await redis.zRange(feedKey(postId), 0, FEED_LENGTH - 1, {
      by: 'rank',
      reverse: true,
    });
    const doomed = (rows ?? []).filter((row) => {
      try {
        return (JSON.parse(row.member) as BragRecord).commentId === commentId;
      } catch {
        return true; // an unparseable row is worth removing anyway
      }
    });
    if (!doomed.length) return;
    await redis.zRem(
      feedKey(postId),
      doomed.map((row) => row.member)
    );
  },

  /** A deleted post takes its thread with it: the feed of its comments and its pinned comment. */
  async forgetPost(postId: string): Promise<void> {
    await redis.del(feedKey(postId), scoresThreadKey(postId), scoresThreadLockKey(postId));
  },
};
