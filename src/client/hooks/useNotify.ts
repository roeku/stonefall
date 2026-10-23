import { useCallback, useEffect, useState } from 'react';
import type { NotifyResponse } from '../../shared/types/api';

/**
 * Push notifications, on or off: the bell beside the sound.
 *
 * Devvit asks that a game's first screen says whether its notifications are on and turns them on
 * or off in one tap, so the bell does both. `on` is null when the game can't send any (signed
 * out, or `PUSH_ENABLED` off on the server), and then there is no bell.
 *
 * Reddit keeps the answer, and a player can change it in Reddit's own settings, so the bell asks
 * whenever it is shown. The map has the game's last word on it in `/api/me`, passed in as `seed`,
 * to show until then; the relay waits for the answer.
 */
export interface NotifyHook {
  on: boolean | null;
  busy: boolean;
  /** Flip it. Resolves with what the player should be told. */
  toggle: () => Promise<{ ok: boolean; text: string }>;
}

/** Minutes east of UTC, so nothing comes at night where the player is. */
const utcOffset = () => -new Date().getTimezoneOffset();

export const useNotify = (source: { seed: boolean | null } | 'fetch'): NotifyHook => {
  const fetchOwn = source === 'fetch';
  const seed = fetchOwn ? undefined : source.seed;
  const [on, setOn] = useState<boolean | null>(seed ?? null);
  const [busy, setBusy] = useState(false);
  // A null seed is no bell to show (signed out, or no notifications), so nothing to ask.
  const ask = fetchOwn || (seed !== undefined && seed !== null);

  useEffect(() => {
    if (seed !== undefined) setOn(seed);
  }, [seed]);

  useEffect(() => {
    if (!ask) return;
    let live = true;
    void fetch(`/api/me/notify?offset=${utcOffset()}`)
      .then((res) => (res.ok ? (res.json() as Promise<NotifyResponse>) : null))
      .then((data) => {
        if (live && data) setOn(data.on);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [ask]);

  const toggle = useCallback(async (): Promise<{ ok: boolean; text: string }> => {
    if (on === null) return { ok: false, text: 'Notifications are not available' };
    const next = !on;
    setBusy(true);
    try {
      const res = await fetch('/api/me/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ on: next, offset: utcOffset() }),
      });
      const data = (await res.json()) as NotifyResponse;
      if (!res.ok || !data.success) {
        if (data.on !== undefined) setOn(data.on);
        return { ok: false, text: data.message ?? 'Could not change that' };
      }
      setOn(next);
      return { ok: true, text: next ? 'Notifications on' : 'Notifications off' };
    } catch {
      return { ok: false, text: 'Could not change that' };
    } finally {
      setBusy(false);
    }
  }, [on]);

  return { on, busy, toggle };
};
