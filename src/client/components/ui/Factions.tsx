import React from 'react';
import type { FactionId } from '../../../shared/types/factions';
import { FACTIONS, factionHex, factionName, factionRgb } from '../../../shared/types/factions';
import { landCountByFaction, type Holdings } from '../../../shared/types/territory';
import { AudioPlayer } from '../audio/AudioPlayer';
import { Button } from './Chrome';

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
  </div>
);

interface SwitchConfirmProps {
  from: FactionId;
  to: FactionId;
  /** Towers the player has standing, all of which come down. */
  standing: number;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * The yes that a switch needs.
 *
 * A colour is a side: changing it takes down everything the player has standing on today's map,
 * so the tap on a dot asks first, says exactly what goes, and offers the way back as plainly as
 * the way forward. The button to go is lit in the colour being joined.
 */
export const SwitchConfirm: React.FC<SwitchConfirmProps> = ({
  from,
  to,
  standing,
  onConfirm,
  onCancel,
}) => (
  <div
    className="ui-switch"
    role="alertdialog"
    aria-label={`Switch to ${factionName(to)}`}
    style={{ ['--accent-rgb' as string]: factionRgb(to) }}
  >
    <span className="ui-switch__title">
      <FactionDot faction={to} size={10} />
      Join {factionName(to)}?
    </span>
    <span className="ui-switch__note">
      {standing === 1
        ? `Your ${factionName(from)} tower comes down.`
        : `All ${standing.toLocaleString()} of your ${factionName(from)} towers come down.`}
    </span>
    <Button onClick={onConfirm}>Switch</Button>
    <Button variant="ghost" onClick={onCancel}>
      Stay {factionName(from)}
    </Button>
  </div>
);

interface StandingsProps {
  holdings: Holdings;
  /** The viewer's colour, so their bloc is named even when it is not in the top three. */
  mine: FactionId;
  /** The day is over: these are the standings it closed on. */
  final?: boolean | undefined;
}

const cells = (n: number): string => `${n.toLocaleString()} ${n === 1 ? 'cell' : 'cells'}`;

/** A faction's colour for a bar segment's own glow. */
const segStyle = (f: FactionId, share: number): React.CSSProperties => ({
  width: `${share * 100}%`,
  background: factionHex(f),
  color: factionHex(f),
});

const ordinal = (n: number): string => {
  const suffix = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${suffix[(v - 20) % 10] ?? suffix[v] ?? suffix[0]}`;
};

/**
 * Who holds how much, as one line: the land split by colour, and where the viewer's colour
 * stands in it.
 *
 * It used to be a kicker, a bar and three named counts: four lines in the corner of a phone for
 * a question with a one-word answer. The bar still shows the split -- the viewer's own share
 * rimmed so it can be found -- and the word says the rest: leading, or second of eight.
 */
export const Standings: React.FC<StandingsProps> = ({ holdings, mine, final = false }) => {
  const counts = React.useMemo(() => landCountByFaction(holdings), [holdings]);
  const total = React.useMemo(() => [...counts.values()].reduce((a, b) => a + b, 0), [counts]);
  if (total === 0) return null;
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const place = ranked.findIndex(([f]) => f === mine);
  const word =
    place < 0
      ? 'No land'
      : place === 0
        ? final
          ? 'Held most'
          : 'Leading'
        : `${ordinal(place + 1)} of ${ranked.length}`;
  return (
    <div
      className="ui-standings"
      aria-label={`Land by colour. ${factionName(mine)}: ${word}.`}
      title={ranked.map(([f, n]) => `${factionName(f)} ${cells(n)}`).join(', ')}
    >
      <div className="ui-standings__bar">
        {ranked.map(([f, n]) => (
          <span
            key={f}
            className={`ui-standings__seg${f === mine ? ' ui-standings__seg--mine' : ''}`}
            style={segStyle(f, n / total)}
          />
        ))}
      </div>
      <span className="ui-standings__word">{word}</span>
    </div>
  );
};
