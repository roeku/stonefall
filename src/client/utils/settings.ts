import { useSyncExternalStore } from 'react';
import type { SettingsResponse } from '../../shared/types/api';
import { DEFAULT_SETTINGS, settingsFrom, type Settings } from '../../shared/types/settings';
import { AudioPlayer } from '../components/audio/AudioPlayer';

/**
 * The player's settings in this page: read once from the browser, changed by the menu, and read
 * by whatever they change (the camera's shake, the canvas's pixels, the next run's start).
 *
 * The browser's copy is the device's own say and wins. The player's record has a second copy for
 * a browser that has none: Devvit clears localStorage with every new version of the app, and the
 * record is how a ×4 player is still ×4 after an update. Sound stays where AudioPlayer keeps it
 * too, so a mute from before this store existed still holds.
 */

const KEY = 'stonefall:settings';
const MUTE_KEY = 'stonefall:muted';

const readStored = (): { own: boolean; settings: Settings } => {
  const base: Settings = { ...DEFAULT_SETTINGS };
  try {
    if (typeof window === 'undefined') return { own: false, settings: base };
    base.sound = window.localStorage.getItem(MUTE_KEY) !== '1';
    // Someone who has asked their device for less motion starts with the camera still.
    base.shake = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const raw = window.localStorage.getItem(KEY);
    return raw
      ? { own: true, settings: settingsFrom(JSON.parse(raw), base) }
      : { own: false, settings: base };
  } catch {
    return { own: false, settings: base };
  }
};

const stored = readStored();
let current: Settings = stored.settings;
/** Changed in this page already: an answer from the record arriving late does not undo it. */
let touched = false;
const listeners = new Set<() => void>();

const apply = (next: Settings): void => {
  if (next.sound !== current.sound) AudioPlayer.setMuted(!next.sound);
  current = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // A browser that refuses storage still has the setting for this page.
  }
  for (const listener of listeners) listener();
};

export const PlayerSettings = {
  get: (): Settings => current,

  /** Change some settings, here and on the player's record. Signed out, only here. */
  set(patch: Partial<Settings>): void {
    touched = true;
    apply({ ...current, ...patch });
    void fetch('/api/me/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: patch }),
    }).catch(() => undefined);
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /**
   * For a browser with no settings of its own: the ones on the player's record, if there are
   * any. Asked once a page, by whichever post opened.
   */
  heal: (() => {
    let asked = false;
    return (): void => {
      if (asked || stored.own) return;
      asked = true;
      void fetch('/api/me/settings')
        .then((res) => (res.ok ? (res.json() as Promise<SettingsResponse>) : null))
        .then((data) => {
          if (!touched && data?.settings) apply(settingsFrom(data.settings, current));
        })
        .catch(() => undefined);
    };
  })(),
};

/** The settings, for a component that draws from them. */
export const useSettings = (): Settings =>
  useSyncExternalStore(PlayerSettings.subscribe, PlayerSettings.get, PlayerSettings.get);
