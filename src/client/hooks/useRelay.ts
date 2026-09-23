import { useCallback, useEffect, useRef, useState } from 'react';
import { connectRealtime, context, disconnectRealtime } from '@devvit/web/client';
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
 */
export interface RelayHook {
  state: RelayState | null;
  connected: boolean;
  error: string | null;
  /** The server's clock, estimated from the last response. */
  serverNow: () => number;
  /** The tower asked to be shown while not seated. Null means whatever the server features. */
  watching: number | null;
  watch: (tower: number | null) => void;
  join: () => Promise<RelayJoinResponse>;
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
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [watching, setWatching] = useState<number | null>(null);
  const stateRef = useRef<RelayState | null>(null);
  const watchingRef = useRef<number | null>(null);
  const offsetRef = useRef(0);
  const momentsRef = useRef<RelayMoments | undefined>(onMoments);
  useEffect(() => {
    momentsRef.current = onMoments;
  }, [onMoments]);

  const adopt = useCallback((next: RelayState | null | undefined) => {
    if (!next) return;
    // Server clock offset from the response, with no attempt at latency correction: a few
    // hundred milliseconds either way is inside the turn's slack.
    offsetRef.current = next.now - Date.now();
    const before = stateRef.current;
    if (before && before.tower === next.tower && next.version < before.version) return;
    stateRef.current = next;
    setState(next);
    // Only what happened on this tower since the last look. A tower that has just come on
    // screen brings its history with it, and that history has already happened.
    if (before && before.tower === next.tower) {
      const since = before.events[before.events.length - 1]?.at ?? 0;
      const fresh = next.events.filter((e) => e.at > since);
      if (fresh.length > 0) momentsRef.current?.(fresh, before);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const w = watchingRef.current;
      const res = await fetch(`/api/relay/state${w ? `?tower=${w}` : ''}`);
      if (!res.ok) return;
      const data = (await res.json()) as RelayStateResponse;
      adopt(data.state);
    } catch {
      // A missed poll is nothing; the next one comes.
    }
  }, [adopt]);

  const heartbeat = useCallback(async () => {
    try {
      const res = await fetch('/api/relay/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(watchingRef.current ? { tower: watchingRef.current } : {}),
      });
      if (!res.ok) return;
      const data = (await res.json()) as RelayStateResponse;
      if (!data.state) setError('No tower in this post.');
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

  // Presence. Sent while the post is on screen; a hidden tab stops, which is what gives up a
  // seat, so a phone in a pocket is not holding up a crew.
  useEffect(() => {
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
  }, [heartbeat]);

  // Realtime, where the platform provides it.
  useEffect(() => {
    const postId = context?.postId;
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
    };
  }, [refresh]);

  // Polling, when realtime is not carrying the changes.
  useEffect(() => {
    if (connected) return;
    const t = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      void refresh();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [connected, refresh]);

  const join = useCallback(async (): Promise<RelayJoinResponse> => {
    try {
      const tower = stateRef.current?.tower;
      const res = await fetch('/api/relay/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tower ? { tower } : {}),
      });
      const data = (await res.json()) as RelayJoinResponse;
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
  }, [adopt]);

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
