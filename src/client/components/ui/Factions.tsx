import React from 'react';
import type { FactionId } from '../../../shared/types/factions';
import { FACTIONS, factionHex, factionName, factionRgb } from '../../../shared/types/factions';
import { landCountByFaction, type Holdings } from '../../../shared/types/territory';
import { AudioPlayer } from '../audio/AudioPlayer';

/**
 * Colour, on the chrome.
 *
 * A faction is a colour, so everywhere the chrome names one it shows one: a dot the colour of
 * the flag beside the word. The swatch row is the only place the colour is chosen, and it is a
 * row of eight dots rather than a menu, because there is nothing to read.
 */

export const FactionDot: React.FC<{ faction: FactionId | null | undefined; size?: number }> = ({
  faction,
  size = 8,
}) => (
  <span
    className="ui-dot"
    aria-hidden="true"
    style={{
      width: size,
      height: size,
      background: factionHex(faction),
      boxShadow: `0 0 6px ${factionHex(faction)}`,
    }}
  />
);

/** The player's colour, as a tappable chip that opens the swatches. */
export const FactionChip: React.FC<{
  faction: FactionId;
  open: boolean;
  onToggle: () => void;
}> = ({ faction, open, onToggle }) => (
  <button
    type="button"
    className={`ui-chip${open ? ' ui-chip--open' : ''}`}
    onClick={() => {
      AudioPlayer.unlock();
      AudioPlayer.playTap(1.05);
      onToggle();
    }}
    aria-expanded={open}
    aria-label={`Your colour: ${factionName(faction)}. Tap to change.`}
  >
    <FactionDot faction={faction} size={9} />
    <span className="ui-chip__label">{factionName(faction)}</span>
  </button>
);

interface SwatchesProps {
  value: FactionId;
  onChange: (faction: FactionId) => void;
  /** Shown above the row on a first visit. */
  title?: string | undefined;
}

/** Eight dots, thumb-sized, in two rows of four. The chosen one is ringed; tapping another changes flag. */
export const Swatches: React.FC<SwatchesProps> = ({ value, onChange, title }) => (
  <div className="ui-swatches" role="radiogroup" aria-label="Your colour">
    {title && <span className="ui-swatches__title">{title}</span>}
    <div className="ui-swatches__row">
      {FACTIONS.map((f) => (
        <button
          key={f.id}
          type="button"
          role="radio"
          aria-checked={f.id === value}
          aria-label={f.name}
          title={f.name}
          className={`ui-swatch${f.id === value ? ' ui-swatch--on' : ''}`}
          style={{ ['--rim-rgb' as string]: factionRgb(f.id) }}
          onClick={() => onChange(f.id)}
        >
          <span className="ui-swatch__dot" />
        </button>
      ))}
    </div>
    <span className="ui-swatches__name">{factionName(value)}</span>
  </div>
);

interface StandingsProps {
  holdings: Holdings;
  /** The viewer's colour, so their bloc is named even when it is not in the top three. */
  mine: FactionId;
}

const cells = (n: number): string => `${n.toLocaleString()} ${n === 1 ? 'cell' : 'cells'}`;

/** A faction's colour for a bar segment's own glow. */
const segStyle = (f: FactionId, share: number): React.CSSProperties => ({
  width: `${share * 100}%`,
  background: factionHex(f),
  color: factionHex(f),
});

/**
 * Who holds how much: one hairline split by share, and the leading three by name.
 *
 * This is the map's scoreboard. It is a line rather than a table because it sits inside a
 * phone-sized post above the board, and because a line that shifts when a cell changes hands
 * is a better story than a number that ticks. The counts say what they count.
 */
export const Standings: React.FC<StandingsProps> = ({ holdings, mine }) => {
  const counts = React.useMemo(() => landCountByFaction(holdings), [holdings]);
  const total = React.useMemo(() => [...counts.values()].reduce((a, b) => a + b, 0), [counts]);
  if (total === 0) return null;
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const top = ranked.slice(0, 3);
  const mineRank = ranked.findIndex(([f]) => f === mine);
  const showMine = mineRank >= 3 ? ranked[mineRank] : null;
  return (
    <div className="ui-standings" aria-label="Land held by faction, in cells">
      <span className="ui-standings__kicker">Land held, in cells</span>
      <div className="ui-standings__bar">
        {ranked.map(([f, n]) => (
          <span
            key={f}
            className="ui-standings__seg"
            style={segStyle(f, n / total)}
            title={`${factionName(f)}: ${cells(n)}`}
          />
        ))}
      </div>
      <div className="ui-standings__names">
        {top.map(([f, n]) => (
          <span
            key={f}
            className={`ui-standings__name${f === mine ? ' ui-standings__name--mine' : ''}`}
            title={`${factionName(f)}: ${cells(n)}`}
          >
            <FactionDot faction={f} size={5} />
            {factionName(f)} {n.toLocaleString()}
          </span>
        ))}
        {showMine && (
          <span
            className="ui-standings__name ui-standings__name--mine"
            title={`${factionName(showMine[0])}: ${cells(showMine[1])}`}
          >
            <FactionDot faction={showMine[0]} size={5} />
            {factionName(showMine[0])} {showMine[1].toLocaleString()}
          </span>
        )}
      </div>
    </div>
  );
};
