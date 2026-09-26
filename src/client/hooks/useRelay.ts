import { useCallback, useEffect, useRef, useState } from 'react';
import { connectRealtime, disconnectRealtime } from '@devvit/web/client';
import type {
  RelayBragResponse,
  RelayDropResponse,
  RelayEvent,
  RelayJoinResponse,
  RelayPush,
  RelayState,
  RelayStateResponse,
  RelayTowerSummary,
} from '../../shared/types/api';

/** How often presence is reported. Three of these missed and you are not here. */
const HEARTBEAT_MS = 6_000;
/** Polling cadence when realtime is not connected (the local harness, or a dropped socket). */
const POLL_MS = 2_500;

/**
 * What changed between one state and the next, for the scene and the chrome to act on: new
 * events on the tower being looked at, with the state from just before them, so a player who
 * just fell can still be found in the crew they fell out of.
 */
export type RelayMoments = (events: readonly RelayEvent[], before: RelayState | null) => void;

/**
 * The shared towers, kept current.
 *
 * Presence is a heartbeat; changes arrive over realtime as small pushes per tower carrying a
 * version. A push about the tower on screen with a version the client has not seen makes it
 * fetch that tower; a push about another tower just redraws that neighbour from its summary.
 * When realtime is not there at all, the state is polled. Either way the server is the only
 * author of the state; the client never guesses at anyone else's turn.
 *
 * A post opens on its own relay. An older post's has topped out and does not change, so it is
 * read once, and paged through, with no heartbeat: looking at how a day ended is not being here
 * today. Today's relay, and everything played, is live: the post moves over to it by itself when
 * its own relay is today's, and otherwise when the player takes a seat.
 */
export interface RelayHook {
  state: RelayState | null;
  /** True once the post plays today's relay; false while it shows its own topped-out day. */
  live: boolean;
  connected: boolean;
  error: string | null;
  /** The server's clock, estimated from the last response. */
  serverNow: () => number;
  /** The tower asked to be shown while not seated. Null means whatever the server features. */
  watching: number | null;
  watch: (tower: number | null) => void;
  /**
   * Take a seat on today's relay, next to the tower on screen, or with `tower` given, next to
   * that one; null for wherever there is room. Moves the post over to today's relay.
   */
  join: (tower?: number | null) => Promise<RelayJoinResponse>;
  drop: (tick: number, index: number) => Promise<RelayDropResponse>;
  brag: () => Promise<{ ok: boolean; message?: string }>;
  refresh: () => Promise<void>;
}

const mergeSummary = (
  towers: readonly RelayTowerSummary[],
  next: RelayTowerSummary
): RelayTowerSummary[] => {
  const i = towers.findIndex((t) => t.id === next.id);
  if (i < 0) return [...towers, next].sort((a, b) => a.id - b.id);
  if ((towers[i]?.version ?? 0) > next.version) return [...towers];
  const out = [...towers];
  out[i] = next;
  return out;
};

export const useRelay = (onMoments?: RelayMoments): RelayHook => {
  const [state, setState] = useState<RelayState | null>(null);
  const [live, setLive] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [watching, setWatching] = useState<number | null>(null);
  const stateRef = useRef<RelayState | null>(null);
  const liveRef = useRef(false);
  /**
   * Bumped when a seat is taken. What a join answers is the truth about the seat, so a read asked
   * for before it answered, e.g. the heartbeat going out as the post goes live, is not adopted
   * over it: it would show the player back on their feet for a heartbeat.
   */
  const joins = useRef(0);
  const watchingRef = useRef<number | null>(null);
  const offsetRef = useRef(0);
  const momentsRef = useRef<RelayMoments | undefined>(onMoments);
  useEffect(() => {
    momentsRef.current = onMoments;
  }, [onMoments]);

  /** Today's relay from now on: heartbeats, pushes and polls. A tower looked at is let go. */
  const goLive = useCallback(() => {
    if (liveRef.current) return;
    liveRef.current = true;
    watchingRef.current = null;
    setWatching(null);
    setLive(true);
  }, []);

  const adopt = useCallback(
    (next: RelayState | null | undefined) => {
      if (!next) return;
      // The post's own relay is still being played: it is today's.
      if (!liveRef.current && !next.closed) goLive();
      // Server clock offset from the response, with no attempt at latency correction: a few
      // hundred milliseconds either way is inside the turn's slack.
      offsetRef.current = next.now - Date.now();
      const before = stateRef.current;
      // Today's relay moves on when the day turns over, and an older post moves from its own day to
      // today's when its player takes a seat: either way the next answer is about a different post,
      // with new towers, new crews, new numbering. That is a fresh start, not a change to the tower
      // on screen, so nothing in it is replayed as a moment, and a tower being watched by number is
      // let go because the new day's may not have it.
      const newDay = before !== null && before.postId !== next.postId;
      if (newDay) {
        watchingRef.current = null;
        setWatching(null);
      }
      if (!newDay && before && before.tower === next.tower && next.version < before.version) return;
      stateRef.current = next;
      setState(next);
      // Only what happened on this tower since the last look. A tower that has just come on
      // screen brings its history with it, and that history has already happened.
      if (!newDay && before && before.tower === next.tower) {
        const since = before.events[before.events.length - 1]?.at ?? 0;
        const fresh = next.events.filter((e) => e.at > since);
        if (fresh.length > 0) momentsRef.current?.(fresh, before);
      }
    },
    [goLive]
  );

  const refresh = useCallback(async () => {
    try {
      const w = watchingRef.current;
      const asked = liveRef.current;
      const epoch = joins.current;
      const query = new URLSearchParams();
      if (!asked) query.set('view', 'post');
      if (w) query.set('tower', String(w));
      const qs = query.toString();
      const res = await fetch(`/api/relay/state${qs ? `?${qs}` : ''}`);
      if (!res.ok) return;
      const data = (await res.json()) as RelayStateResponse;
      // A look at the post's own day that answers after the move to today's is not today's.
      if (asked !== liveRef.current || epoch !== joins.current) return;
      adopt(data.state);
    } catch {
      // A missed poll is nothing; the next one comes.
    }
  }, [adopt]);

  const heartbeat = useCallback(async () => {
    try {
      const epoch = joins.current;
      const res = await fetch('/api/relay/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(watchingRef.current ? { tower: watchingRef.current } : {}),
      });
      if (!res.ok) return;
      const data = (await res.json()) as RelayStateResponse;
      if (!data.state) setError('No tower in this post.');
      if (epoch !== joins.current) return;
      adopt(data.state);
    } catch {
      // Same: presence is retried in a few seconds.
    }
  }, [adopt]);

  const watch = useCallback(
    (tower: number | null) => {
      watchingRef.current = tower;
      setWatching(tower);
      void refresh();
    },
    [refresh]
  );

  // The post's own relay, read once on opening. An older post's has topped out and never changes.
  useEffect(() => {
    if (live) return;
    // Deferred a tick so the state lands after mount rather than during it.
    const first = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(first);
  }, [live, refresh]);

  // Presence, on today's relay. Sent while the post is on screen; a hidden tab stops, which is
  // what gives up a seat, so a phone in a pocket is not holding up a crew.
  useEffect(() => {
    if (!live) return;
    // Deferred a tick so the first heartbeat's state lands after mount rather than during it.
    const first = setTimeout(() => void heartbeat(), 0);
    const t = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      void heartbeat();
    }, HEARTBEAT_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void heartbeat();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(first);
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [heartbeat, live]);

  // Realtime, where the platform provides it. The channel is the relay being played, which is
  // today's post rather than necessarily this one, so it is joined once the first state says
  // which, and moved when the day turns over. Polling covers the moments before and between.
  const livePostId = live ? (state?.postId ?? null) : null;
  useEffect(() => {
    const postId = livePostId;
    if (!postId) return;
    const channel = `relay_${postId.replace(/[^a-zA-Z0-9_]/g, '')}`;
    try {
      connectRealtime({
        channel,
        onConnect: () => setConnected(true),
        onDisconnect: () => setConnected(false),
        onMessage: (data) => {
          // The push is JSON of RelayPush; the platform types it as any JSON value.
          const msg = data as unknown as RelayPush;
          if (!msg || msg.kind !== 'relay') return;
          const current = stateRef.current;
          if (current && msg.tower === current.tower) {
            if (msg.version > current.version) void refresh();
            return;
          }
          const summary = msg.summary;
          if (current && summary) {
            const next = { ...current, towers: mergeSummary(current.towers, summary) };
            stateRef.current = next;
            setState(next);
          }
        },
      });
    } catch {
      queueMicrotask(() => setConnected(false));
    }
    return () => {
      try {
        disconnectRealtime(channel);
      } catch {
        // Already gone.
      }
      // Polling until the next channel says it is up.
      setConnected(false);
    };
  }, [refresh, livePostId]);

  // Polling, when realtime is not carrying the changes.
  useEffect(() => {
    if (!live || connected) return;
    const t = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      void refresh();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [live, connected, refresh]);

  const join = useCallback(
    async (on?: number | null): Promise<RelayJoinResponse> => {
      // A seat is always on today's relay, whichever day the post was showing.
      goLive();
      try {
        const tower = on === undefined ? stateRef.current?.tower : on;
        const res = await fetch('/api/relay/join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(tower ? { tower } : {}),
        });
        const data = (await res.json()) as RelayJoinResponse;
        joins.current += 1;
        if (data.success) {
          // Seated: the seat decides what is shown from now on.
          watchingRef.current = null;
          setWatching(null);
        }
        adopt(data.state);
        return data;
      } catch {
        return { type: 'relay_join', success: false, message: 'Could not reach the tower.' };
      }
    },
    [adopt, goLive]
  );

  const drop = useCallback(
    async (tick: number, index: number): Promise<RelayDropResponse> => {
      try {
        const res = await fetch('/api/relay/drop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tick, index }),
        });
        const data = (await res.json()) as RelayDropResponse;
        adopt(data.state);
        return data;
      } catch {
        return { type: 'relay_drop', success: false, message: 'Could not reach the tower.' };
      }
    },
    [adopt]
  );

  const brag = useCallback(async () => {
    try {
      const res = await fetch('/api/relay/brag', { method: 'POST' });
      const data = (await res.json()) as RelayBragResponse;
      return { ok: res.ok && data.success, ...(data.message ? { message: data.message } : {}) };
    } catch {
      return { ok: false, message: 'Could not reach Reddit' };
    }
  }, []);

  const serverNow = useCallback(() => Date.now() + offsetRef.current, []);

  return {
    state,
    live,
    connected,
    error,
    serverNow,
    watching,
    watch,
    join,
    drop,
    brag,
    refresh,
  };
};
