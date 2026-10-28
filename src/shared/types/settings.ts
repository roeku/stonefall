import { startSpeedOr, type StartSpeed } from '../simulation/gameSimulation';

/**
 * The player's settings: what the menu behind the top corner changes.
 *
 * Notifications are not here: Reddit keeps whether a player gets them (server/core/notify.ts).
 *
 * Kept in the browser, which is the device's own say, and on the player's record, because Devvit
 * clears a game's localStorage with every new version of the app: without the second copy every
 * update would turn the sound back on and a ×4 player back to ×1.
 */

/** How much the renderer draws: the full frame, or fewer pixels and a cheaper glow. */
export type Quality = 'high' | 'low';

export interface Settings {
  sound: boolean;
  /** The camera's jolt when a block lands or a tower falls. */
  shake: boolean;
  quality: Quality;
  /** How fast a solo run opens (StartSpeed). */
  start: StartSpeed;
}

export const DEFAULT_SETTINGS: Settings = { sound: true, shake: true, quality: 'high', start: 1 };

/** Whatever was stored or sent, as settings: anything missing or unknown is `base`'s. */
export const settingsFrom = (raw: unknown, base: Settings = DEFAULT_SETTINGS): Settings => {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    sound: typeof r.sound === 'boolean' ? r.sound : base.sound,
    shake: typeof r.shake === 'boolean' ? r.shake : base.shake,
    quality: r.quality === 'high' || r.quality === 'low' ? r.quality : base.quality,
    start: r.start === undefined ? base.start : startSpeedOr(r.start),
  };
};
