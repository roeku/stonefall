import { useCallback, useEffect, useRef, useState } from 'react';
import { connectRealtime, context, disconnectRealtime } from '@devvit/web/client';
import type {
  RelayBragResponse,
  RelayDropResponse,
  RelayPush,
  RelayState,
  RelayStateResponse,
} from '../../shared/types/api';

/** How often presence is reported. Three of these missed and you have left the lobby. */
const HEARTBEAT_MS = 6_000;
/** Polling cadence when realtime is not connected (the local harness, or a dropped socket). */
const POLL_MS = 2_500;

/**
 * The shared tower, kept current.
 *
 * Presence is a heartbeat; changes arrive over realtime as small pushes carrying a version, and
 * a push with a version the client has not seen makes it fetch the whole state. When realtime
 * is not there at all, the state is polled. Either way the server is the only author of the
 * state; the client never guesses at anyone else's turn.
 */
export interface RelayHook {
  state: RelayState | null;
  /** The last push received, for immediate feedback before the state refetch lands. */
  push: RelayPush | null;
  connected: boolean;
  error: string | null;
  /** The server's clock, estimated from the last response. */
  serverNow: () => number;
  drop: (tick: number, index: number) => Promise<RelayDropResponse>;
  brag: () => Promise<{ ok: boolean; message?: string }>;
  refresh: () => Promise<void>;
}

export const useRelay = (): RelayHook => {
  const [state, setState] = useState<RelayState | null>(null);
  const [push, setPush] = useState<RelayPush | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const versionRef = useRef(0);
  const offsetRef = useRef(0);

  const adopt = useCallback((next: RelayState | null) => {
    if (!next) return;
    // Server clock offset from the response, with no attempt at latency correction: a few
    // hundred milliseconds either way is inside the turn's slack.
    offsetRef.current = next.now - Date.now();
    if (next.version < versionRef.current) return;
    versionRef.current = next.version;
    setState(next);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/relay/state');
      if (!res.ok) return;
      const data = (await res.json()) as RelayStateResponse;
      adopt(data.state);
    } catch {
      // A missed poll is nothing; the next one comes.
    }
  }, [adopt]);

  const heartbeat = useCallback(async () => {
    try {
      const res = await fetch('/api/relay/heartbeat', { method: 'POST' });
      if (!res.ok) return;
      const data = (await res.json()) as RelayStateResponse;
      if (!data.state) setError('No tower in this post.');
      adopt(data.state);
    } catch {
      // Same: presence is retried in a few seconds.
    }
  }, [adopt]);

  // Presence. Sent while the post is on screen; a hidden tab stops, which is what leaves the
  // lobby, so a phone in a pocket is not holding up the rotation.
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
          setPush(msg);
          if (msg.version > versionRef.current) void refresh();
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

  const drop = useCallback(
    async (tick: number, index: number): Promise<RelayDropResponse> => {
      try {
        const res = await fetch('/api/relay/drop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tick, index }),
        });
        const data = (await res.json()) as RelayDropResponse;
        if (data.state) adopt(data.state);
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

  return { state, push, connected, error, serverNow, drop, brag, refresh };
};
