import React from 'react';
import type { FactionId } from '../../../shared/types/factions';
import { factionRgb } from '../../../shared/types/factions';
import { Avatar } from './Avatar';
import { Lives } from './Lives';

/** One miss, as the overlay shows it. */
export interface Fall {
  key: number;
  username: string;
  snoovatar: string | null;
  faction: FactionId | null;
  /** The block they fell at. */
  block: number;
  /** True when it is the viewer who fell. */
  mine: boolean;
  /** Lives they have left after it. Zero: they are out for the day. */
  left: number;
  /** Lives they had today in all. */
  lives: number;
}

/**
 * Somebody missed.
 *
 * A fall used to be one line in the ticker, which is to say nobody saw it: the block vanished
 * on the next state, the seat vanished from the strip, and the crew found out by counting. A
 * fall is the relay's one moment of real stakes, so everyone on the tower now watches it
 * happen. On a player's last life the frame flashes red at the edges, their snoo appears ringed
 * in their colour, shudders, loses its colour and drops out of the frame, and OUT lands where it
 * was. A miss that still leaves them a life is the same hit, smaller: the snoo shudders and
 * stays, and the life it cost goes out in the row under it. The block they missed goes over the
 * edge in the scene behind either way.
 *
 * Pointer events are off: on a tower where it is your turn next, the screen is still the drop.
 */
export const RelayFall: React.FC<{ fall: Fall }> = ({ fall }) => {
  const out = fall.left === 0;
  const word = out ? (fall.mine ? 'You fell' : 'Out') : 'Missed';
  const who = out
    ? fall.mine
      ? `At block ${fall.block.toLocaleString()}. Out until tomorrow.`
      : `u/${fall.username} fell at ${fall.block.toLocaleString()}`
    : fall.mine
      ? `${fall.left} ${fall.left === 1 ? 'life' : 'lives'} left today`
      : `u/${fall.username}, ${fall.left} left`;
  return (
    <div
      className={`relay-fall${fall.mine ? ' relay-fall--mine' : ''}${out ? '' : ' relay-fall--spared'}`}
      aria-live="polite"
      style={{ ['--rim-rgb' as string]: factionRgb(fall.faction) }}
    >
      <span className="relay-fall__flash" aria-hidden="true" />
      <span className="relay-fall__avatar" aria-hidden="true">
        <Avatar src={fall.snoovatar} name={fall.username} />
      </span>
      <span className="relay-fall__word">{word}</span>
      {!out && <Lives className="relay-fall__lives" left={fall.left} total={fall.lives} lost />}
      <span className="relay-fall__who">{who}</span>
    </div>
  );
};
