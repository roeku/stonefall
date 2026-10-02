import React from 'react';
import type { StoneNews } from '../../../shared/types/api';
import { factionRgb, type FactionId } from '../../../shared/types/factions';
import {
  STONES,
  isUnlocked,
  stoneOf,
  unlockWords,
  type Stone,
  type StoneId,
} from '../../../shared/social/stones';
import { AudioPlayer } from '../audio/AudioPlayer';

/**
 * Stones, on the chrome: a chip of each, drawn in the player's colour, and the row they are
 * chosen from. The chips are CSS sketches of what the block shader draws (rimMaterial's
 * STONE_GLSL), small enough that a sketch is all a thumb-sized square can say.
 */

export const StoneChip: React.FC<{
  stone: StoneId;
  faction: FactionId | null | undefined;
  size?: number | undefined;
}> = ({ stone, faction, size = 18 }) => (
  <span
    className={`stone-chip stone-chip--${stone}`}
    aria-hidden="true"
    style={{ width: size, height: size, ['--rim-rgb' as string]: factionRgb(faction ?? null) }}
  />
);

/** How far a locked stone is, in the player's own numbers. */
const progressWords = (stone: Stone, news: StoneNews): string | null => {
  const u = stone.unlock;
  if (u.by === 'start') return null;
  if (u.by === 'streak') {
    return news.streak > 0 ? `you're on ${news.streak.toLocaleString()}` : null;
  }
  return news.postedDays > 0 ? `${news.postedDays.toLocaleString()} so far` : null;
};

/**
 * The stones, under the colours: every one in the player's colour, the earned ones to wear, the
 * rest faded, saying how they are earned when tapped. The one worn is underlined, as a colour is.
 */
export const StonePicker: React.FC<{
  news: StoneNews;
  faction: FactionId;
  onWear: (stone: StoneId) => void;
}> = ({ news, faction, onWear }) => {
  const [asked, setAsked] = React.useState<StoneId | null>(null);
  const shown = asked ? stoneOf(asked) : null;
  const note = shown
    ? [`${shown.name}: ${unlockWords(shown).toLowerCase()}`, progressWords(shown, news)]
        .filter(Boolean)
        .join(' · ')
    : stoneOf(news.stone).name;
  return (
    <div className="stone-picker" role="radiogroup" aria-label="Your stone">
      <div className="ui-swatches__row">
        {STONES.map((s) => {
          const earned = isUnlocked(s, news);
          const on = s.id === news.stone;
          return (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={earned ? s.name : `${s.name}, not earned yet`}
              title={s.name}
              className={`ui-swatch stone-pick${on ? ' ui-swatch--on' : ''}${
                earned ? '' : ' stone-pick--locked'
              }`}
              onClick={() => {
                AudioPlayer.unlock();
                if (!earned) {
                  AudioPlayer.playTap(0.8);
                  setAsked((a) => (a === s.id ? null : s.id));
                  return;
                }
                AudioPlayer.playTap(1.1);
                setAsked(null);
                if (!on) onWear(s.id);
              }}
            >
              <StoneChip stone={s.id} faction={faction} />
            </button>
          );
        })}
      </div>
      <span className="stone-picker__note" aria-live="polite">
        {note}
      </span>
    </div>
  );
};
