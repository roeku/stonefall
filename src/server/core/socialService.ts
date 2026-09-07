import { context, redis, reddit } from '@devvit/web/server';
import type { BragKind, BragRecord } from '../../shared/types/api';

/**
 * The part of Stonefall that makes people talk.
 *
 * The game had a share endpoint that created a whole new post and that nothing ever called, and
 * no comment integration at all. Both are the wrong shape for Reddit. A post per run buries the
 * game under its own scores and gets a subreddit annoyed; the conversation on Reddit happens in
 * the comments of the thread people are already in. So a run is announced as a comment on the
 * game post, and the app reads those comments back so the board can show who has been saying
 * what.
 *
 * Two rules hold this together.
 *
 * The player never writes the text. Every comment is assembled here from a fixed set of
 * phrasings and the numbers the run actually produced. That keeps the tone consistent, and it
 * means the app has no user-generated text to moderate, which is the thing that sinks most
 * community features before they ship.
 *
 * Redis is the index, the comment is the artifact. The comment is what people reply to and vote
 * on; the Redis record is what the board reads, so drawing the feed never costs a Reddit call.
 */

/** How many recent brags the board keeps per post. Older ones fall off the end. */
const FEED_LENGTH = 40;

/** A brag record is kept for a month, which is longer than any post stays interesting. */
const GUARD_TTL_MS = 1000 * 60 * 60 * 24 * 30;

/** A player gets one comment per run. The key is the session, so a reload cannot double-post. */
const bragGuardKey = (sessionId: string) => `brag:session:${sessionId}`;

/**
 * The feed is a sorted set scored by timestamp, not a list.
 *
 * Devvit's Redis exposes sorted sets and hashes but no list commands, so the obvious
 * push-and-trim is not available. Scoring by time gives the same newest-first read through
 * zRange with `reverse`, and trimming by rank keeps the key bounded however long the post runs.
 */
const feedKey = (postId: string) => `post:${postId}:brags`;

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/**
 * The comment text.
 *
 * Deliberately plain. Neon in the game, ordinary Reddit English in the thread, because a comment
 * that reads like marketing gets downvoted and a comment that reads like a person gets replies.
 */
const composeBody = (b: {
  kind: BragKind;
  score: number;
  blocks: number;
  perfectStreak: number;
  passedUsername?: string | undefined;
  passedScore?: number | undefined;
}): string => {
  const score = b.score.toLocaleString();
  const blocks = `${b.blocks.toLocaleString()} ${plural(b.blocks, 'block', 'blocks')}`;
  const chain =
    b.perfectStreak > 1 ? `, best chain ${b.perfectStreak.toLocaleString()} perfect` : '';
  const run = `**${score}** off ${blocks}${chain}.`;

  switch (b.kind) {
    case 'passed':
      // The one that actually starts arguments. Naming the person is the whole point, so it is
      // only ever sent when the player chose to send it.
      return b.passedUsername
        ? `${run}\n\nThat puts me past u/${b.passedUsername}${
            b.passedScore ? ` on ${b.passedScore.toLocaleString()}` : ''
          }. Your move.`
        : `${run}\n\nMoved up the plot.`;
    case 'best':
      return `${run}\n\nNew personal best.`;
    case 'first':
      return `${run}\n\nFirst tower on my plot.`;
    case 'plain':
    default:
      return run;
  }
};

export const SocialService = {
  /**
   * Announce a run in the game post's comments, as the player.
   *
   * `runAs: 'USER'` is what makes this worth doing: the comment is theirs, it appears in their
   * profile, and replies notify them. A comment from the app account is an announcement nobody
   * answers.
   */
  async brag(input: {
    sessionId: string;
    kind: BragKind;
    score: number;
    blocks: number;
    perfectStreak: number;
    passedUsername?: string | undefined;
    passedScore?: number | undefined;
  }): Promise<{ ok: true; record: BragRecord } | { ok: false; reason: string }> {
    const { postId } = context;
    if (!postId) return { ok: false, reason: 'No post context' };

    // One per run.
    const guard = bragGuardKey(input.sessionId);
    if (await redis.exists(guard)) return { ok: false, reason: 'Already shared this run' };
    await redis.set(guard, '1', { expiration: new Date(Date.now() + GUARD_TTL_MS) });

    const user = await reddit.getCurrentUser();
    const username = user?.username ?? 'someone';

    const comment = await reddit.submitComment({
      id: postId as `t3_${string}`,
      text: composeBody(input),
      runAs: 'USER',
    });

    const record: BragRecord = {
      username,
      score: input.score,
      blocks: input.blocks,
      perfectStreak: input.perfectStreak,
      kind: input.kind,
      commentId: String(comment.id),
      permalink:
        typeof comment.permalink === 'string' ? `https://reddit.com${comment.permalink}` : null,
      timestamp: Date.now(),
      ...(input.passedUsername ? { passedUsername: input.passedUsername } : {}),
    };

    await redis.zAdd(feedKey(postId), { member: JSON.stringify(record), score: record.timestamp });
    // Ranks run low-score-first, so dropping everything below the last FEED_LENGTH keeps the
    // newest and bounds the key.
    await redis.zRemRangeByRank(feedKey(postId), 0, -(FEED_LENGTH + 1));

    return { ok: true, record };
  },

  /** The recent chatter on this post, newest first. Read from Redis, never from Reddit. */
  async feed(limit = 12): Promise<BragRecord[]> {
    const { postId } = context;
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

  /**
   * Drop a brag from the feed when its comment is removed.
   *
   * Without this the board would keep quoting a comment that a moderator or the author has
   * already taken down, which is the sort of thing that gets an app removed from a subreddit.
   */
  async forgetComment(commentId: string): Promise<void> {
    const { postId } = context;
    if (!postId) return;
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
};
