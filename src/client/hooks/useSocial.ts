import React from 'react';
import type { BragKind, BragRecord, BragResponse, GetFeedResponse } from '../../shared/types/api';
import type { FactionId } from '../../shared/types/factions';

/**
 * What a run is for, and telling people what it did.
 *
 * A run can be aimed at something before it starts:
 *
 * - `beat`: somebody's score, taken from a tower or the chatter strip. Pass it and the game
 *   offers to say so in the thread, naming them.
 * - `take`: a held land cell. The bar is the tower standing there; pass it and the tower is
 *   raised on that cell automatically, theirs topples, and the comment names who lost it.
 * - `claim`: empty land in reach. No bar; finish the run and it is raised there.
 *
 * A Reddit mention is a notification, so a callout pulls the person you passed or toppled back
 * into the post to answer it. Nothing else in this app can do that.
 *
 * The target is deliberately not persisted. It belongs to one sitting; carrying it across
 * sessions would turn a bit of banter into a grudge the app keeps score of.
 */
export interface Target {
  kind: 'beat' | 'take' | 'claim';
  /** Whose score or land it is. Absent for empty land. */
  username?: string | undefined;
  /** Their colour, when it is known, so their name can be set in it. */
  faction?: FactionId | undefined;
  /** The score to beat. Zero for empty land. */
  score: number;
  /** The cell, for `take` and `claim`. */
  cell?: { x: number; z: number } | undefined;
  /** Set when the bar is the player's own tower: a replace, not a take. */
  own?: boolean | undefined;
  /**
   * Set when the game picked this, not the player: a run started from Build chases the nearest
   * rival bar in reach, or the player's own best. Shown during the run like any other target,
   * but never raised on by itself; the placement screen offers the cell instead.
   */
  auto?: boolean | undefined;
}

export interface SocialHook {
  feed: BragRecord[];
  refreshFeed: () => Promise<void>;
  target: Target | null;
  setTarget: (t: Target | null) => void;
  /** Set while a comment is in flight, so the button cannot be pressed twice. */
  isPosting: boolean;
  /** Session ids already announced, so a re-render cannot re-offer a spent brag. */
  bragged: ReadonlySet<string>;
  brag: (input: {
    sessionId: string;
    kind: BragKind;
    passedUsername?: string | undefined;
    passedScore?: number | undefined;
    cell?: { x: number; z: number } | undefined;
  }) => Promise<{ ok: boolean; message?: string }>;
}

export const useSocial = (): SocialHook => {
  const [feed, setFeed] = React.useState<BragRecord[]>([]);
  const [target, setTarget] = React.useState<Target | null>(null);
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

  return { feed, refreshFeed, target, setTarget, isPosting, bragged, brag };
};
