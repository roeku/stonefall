import React from 'react';
import type { FactionId } from '../../../shared/types/factions';
import { FACTIONS, factionHex, factionName, factionRgb } from '../../../shared/types/factions';
import { landCountByFaction, type Holdings } from '../../../shared/types/territory';
import { AudioPlayer } from '../audio/AudioPlayer';
import { ordinal } from '../../utils/stakes';
import { Button } from './Chrome';

/**
 * Colour, on the chrome.
 *
 * A faction is a colour, so everywhere the chrome names one it shows one: a square of it beside
 * the word, the same square the swatch row is made of. The swatch row is the only place the
 * colour is chosen, and it is a row of eight squares rather than a menu, because there is
 * nothing to read.
 */

export const FactionSquare: React.FC<{ faction: FactionId | null | undefined; size?: number }> = ({
  faction,
  size = 12,
}) => (
  <span
    className="ui-side__sq"
    aria-hidden="true"
    style={{ width: size, height: size, background: factionHex(faction) }}
  />
);

/**
 * The viewer's side, top left: their colour, its name, and where it stands on today's map.
 * Tapping it opens the swatches.
 */
export const SideLine: React.FC<{
  faction: FactionId;
  /** 1-based place among the colours holding land; 0 when the colour holds none. */
  place: number;
  open: boolean;
  onToggle: () => void;
  /** Bumped when the colour gains ground, so the place pops. */
  pulse?: number | undefined;
}> = ({ faction, place, open, onToggle, pulse = 0 }) => (
  <button
    type="button"
    className={`ui-side${open ? ' ui-side--open' : ''}`}
    onClick={() => {
      AudioPlayer.unlock();
      AudioPlayer.playTap(1.05);
      onToggle();
    }}
    aria-expanded={open}
    aria-label={`Your colour: ${factionName(faction)}${place > 0 ? `, ${ordinal(place)}` : ''}. Tap to change.`}
  >
    <FactionSquare faction={faction} />
    <span className="ui-side__name">{factionName(faction)}</span>
    {place > 0 && (
      <span key={`${place}-${pulse}`} className={`ui-side__place${pulse > 0 ? ' ui-pop' : ''}`}>
        {ordinal(place)}
      </span>
    )}
  </button>
);

interface SwatchesProps {
  value: FactionId;
  onChange: (faction: FactionId) => void;
  /** Shown above the row on a first visit. */
  title?: string | undefined;
}

/** Eight squares, thumb-sized, in two rows of four. The chosen one is larger, underlined. */
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
          <span className="ui-swatch__sq" />
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
 * so the tap on a square asks first, says exactly what goes, and offers the way back as plainly
 * as the way forward.
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
      <FactionSquare faction={to} size={14} />
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
  /** The viewer's colour, named even when it is not in the top three. */
  mine: FactionId;
  /** Bumped when the viewer's colour gains ground: its count pops. */
  pulse?: number | undefined;
}

const cells = (n: number): string => `${n.toLocaleString()} ${n === 1 ? 'cell' : 'cells'}`;

/**
 * The map's scoreboard, as one line of words: the three colours holding most, each named in its
 * own colour with its count of cells, and the viewer's own colour after them when it is further
 * down. The viewer's place is already on the line above.
 */
export const Standings: React.FC<StandingsProps> = ({ holdings, mine, pulse = 0 }) => {
  const counts = React.useMemo(() => landCountByFaction(holdings), [holdings]);
  const ranked = React.useMemo(() => [...counts.entries()].sort((a, b) => b[1] - a[1]), [counts]);
  if (ranked.length === 0) return null;
  const shown = ranked.slice(0, 3);
  const mineAt = ranked.findIndex(([f]) => f === mine);
  if (mineAt >= 3) shown.push(ranked[mineAt]!);
  return (
    <div
      className="ui-standings"
      aria-label={ranked.map(([f, n]) => `${factionName(f)} ${cells(n)}`).join(', ')}
    >
      {shown.map(([f, n]) => (
        <span key={f} style={{ color: factionHex(f) }}>
          {factionName(f)}
          <span
            key={f === mine ? `n-${pulse}` : 'n'}
            className={`ui-standings__n${f === mine && pulse > 0 ? ' ui-pop' : ''}`}
          >
            {n.toLocaleString()}
          </span>
        </span>
      ))}
    </div>
  );
};
