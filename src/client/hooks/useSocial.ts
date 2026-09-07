import React from 'react';
import type { BragKind, BragRecord, BragResponse, GetFeedResponse } from '../../shared/types/api';

/**
 * Who to beat, and telling people you beat them.
 *
 * The board used to be a field of anonymous shapes: every tower was somebody's run and nothing
 * on screen said whose, so there was no reason to care about any of them and nothing to talk
 * about. The rival is the fix. You tap a tower, you take its score into a run as a target, and
 * if you pass it the game offers to say so in the thread, naming them.
 *
 * That last part is the whole engine. A Reddit mention is a notification, so a callout pulls the
 * person you passed back into the post to answer it. Nothing else in this app can do that.
 *
 * The rival is deliberately not persisted. It belongs to one sitting; carrying it across
 * sessions would turn a bit of banter into a grudge the app keeps score of.
 */
export interface Rival {
  username: string;
  score: number;
}

export interface SocialHook {
  feed: BragRecord[];
  refreshFeed: () => Promise<void>;
  rival: Rival | null;
  setRival: (r: Rival | null) => void;
  /** Set while a comment is in flight, so the button cannot be pressed twice. */
  isPosting: boolean;
  /** Session ids already announced, so a re-render cannot re-offer a spent brag. */
  bragged: ReadonlySet<string>;
  brag: (input: {
    sessionId: string;
    kind: BragKind;
    score: number;
    blocks: number;
    perfectStreak: number;
    passedUsername?: string | undefined;
    passedScore?: number | undefined;
  }) => Promise<{ ok: boolean; message?: string }>;
}

export const useSocial = (): SocialHook => {
  const [feed, setFeed] = React.useState<BragRecord[]>([]);
  const [rival, setRival] = React.useState<Rival | null>(null);
  const [isPosting, setIsPosting] = React.useState(false);
  const [bragged, setBragged] = React.useState<Set<string>>(() => new Set());

  const refreshFeed = React.useCallback(async () => {
    try {
      const res = await fetch('/api/social/feed?limit=12');
      if (!res.ok) return;
      const data = (await res.json()) as GetFeedResponse;
      setFeed(Array.isArray(data.brags) ? data.brags : []);
    } catch {
      // The board is worth drawing without the chatter strip.
    }
  }, []);

  const brag = React.useCallback<SocialHook['brag']>(
    async (input) => {
      if (isPosting || bragged.has(input.sessionId)) return { ok: false };
      setIsPosting(true);
      // Marked before the request resolves: a double tap on a slow connection is the most
      // likely way to end up with two comments for one run.
      setBragged((prev) => new Set(prev).add(input.sessionId));
      try {
        const res = await fetch('/api/social/brag', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        });
        const data = (await res.json()) as BragResponse;
        if (!res.ok || !data.success) {
          // Failed for a real reason, so let them try again.
          setBragged((prev) => {
            const next = new Set(prev);
            next.delete(input.sessionId);
            return next;
          });
          return { ok: false, ...(data.message ? { message: data.message } : {}) };
        }
        if (data.record) setFeed((prev) => [data.record as BragRecord, ...prev].slice(0, 12));
        return { ok: true };
      } catch {
        setBragged((prev) => {
          const next = new Set(prev);
          next.delete(input.sessionId);
          return next;
        });
        return { ok: false, message: 'Could not reach Reddit' };
      } finally {
        setIsPosting(false);
      }
    },
    [isPosting, bragged]
  );

  return { feed, refreshFeed, rival, setRival, isPosting, bragged, brag };
};
