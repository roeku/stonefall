import React from 'react';
import type { StartSpeed } from '../../../shared/simulation/gameSimulation';
import type { Quality, Settings } from '../../../shared/types/settings';
import { AudioPlayer } from '../audio/AudioPlayer';
import { PlayerSettings, useSettings } from '../../utils/settings';
import { Telemetry } from '../../utils/telemetry';
import { CloseIcon, SettingsIcon } from './icons';

/**
 * The settings: a glyph in the top corner, and what it opens.
 *
 * Open, the world steps back under a dark scrim and the settings stand on it as type, one row
 * each: what it is, dimmed, and its choices as words, the chosen one lit in the player's colour
 * with a line under it, as the colour swatches mark theirs. No panel: the scrim is the only
 * thing behind them, and a tap on it puts the menu away.
 *
 * Notifications are a row here too, but the bell stays in the corner while the menu is shut:
 * Devvit asks that the first screen says in words whether they are on.
 */

const tick = (pitch: number): void => {
  AudioPlayer.unlock();
  AudioPlayer.playTap(pitch);
};

export const SettingsButton: React.FC<{ open: boolean; onToggle: () => void }> = ({
  open,
  onToggle,
}) => (
  <button
    type="button"
    className={`ui-iconbtn${open ? ' ui-iconbtn--on' : ''}`}
    aria-label={open ? 'Close settings' : 'Settings'}
    aria-expanded={open}
    title={open ? 'Close settings' : 'Settings'}
    onClick={() => {
      tick(open ? 0.95 : 1.05);
      onToggle();
    }}
  >
    {open ? <CloseIcon /> : <SettingsIcon />}
  </button>
);

interface ChoiceProps<T> {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; word: string; aria?: string }>;
  onPick: (value: T) => void;
}

/** One setting: its name, and its choices as words. */
const Choice = <T extends string | number | boolean>({
  label,
  value,
  options,
  onPick,
}: ChoiceProps<T>) => (
  <div className="ui-setting" role="radiogroup" aria-label={label}>
    <span className="ui-setting__label">{label}</span>
    <span className="ui-setting__options">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={o.aria}
            className={`ui-setting__opt${on ? ' ui-setting__opt--on' : ''}`}
            onClick={() => {
              if (on) return;
              tick(1.1);
              onPick(o.value);
            }}
          >
            {o.word}
          </button>
        );
      })}
    </span>
  </div>
);

const ON_OFF = [
  { value: true, word: 'On' },
  { value: false, word: 'Off' },
] as const;

const QUALITY: ReadonlyArray<{ value: Quality; word: string }> = [
  { value: 'high', word: 'High' },
  { value: 'low', word: 'Low' },
];

const START: ReadonlyArray<{ value: StartSpeed; word: string; aria: string }> = [
  { value: 1, word: '×1', aria: 'Normal speed' },
  { value: 2, word: '×2', aria: 'Twice as fast' },
  { value: 4, word: '×4', aria: 'Four times as fast' },
];

/** A setting chosen, here and on the record, and counted: how many play at ×4 is worth knowing. */
const choose = <K extends keyof Settings>(key: K, value: Settings[K]): void => {
  PlayerSettings.set({ [key]: value } as Partial<Settings>);
  Telemetry.did(`setting_${key}`, String(value));
};

interface SettingsMenuProps {
  /** Push notifications: on, off, or null when there are none to have (no row). */
  notify: boolean | null;
  onToggleNotify: () => void;
  /** Whether runs start here: the start speed is the solo run's, the relay's sweep the crew's. */
  start: boolean;
  onClose: () => void;
}

export const SettingsMenu: React.FC<SettingsMenuProps> = ({
  notify,
  onToggleNotify,
  start,
  onClose,
}) => {
  const settings = useSettings();
  return (
    <div className="settings">
      <div className="settings__scrim" onClick={onClose} aria-hidden="true" />
      <div className="settings__list" role="group" aria-label="Settings">
        <Choice
          label="Sound"
          value={settings.sound}
          options={ON_OFF}
          onPick={(sound) => {
            choose('sound', sound);
            // Turned on, it answers: the tick before it went out under the mute.
            if (sound) AudioPlayer.playTap(1.2);
          }}
        />
        {notify !== null && (
          <Choice label="Notifications" value={notify} options={ON_OFF} onPick={onToggleNotify} />
        )}
        <Choice
          label="Shake"
          value={settings.shake}
          options={ON_OFF}
          onPick={(shake) => choose('shake', shake)}
        />
        <Choice
          label="Quality"
          value={settings.quality}
          options={QUALITY}
          onPick={(quality) => choose('quality', quality)}
        />
        {start && (
          <Choice
            label="Start speed"
            value={settings.start}
            options={START}
            onPick={(speed) => choose('start', speed)}
          />
        )}
      </div>
    </div>
  );
};
