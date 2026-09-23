import React from 'react';
import type { FactionId } from '../../../shared/types/factions';
import { factionRgb } from '../../../shared/types/factions';

/** One elimination, as the overlay shows it. */
export interface Fall {
  key: number;
  username: string;
  snoovatar: string | null;
  faction: FactionId | null;
  /** The block they fell at. */
  block: number;
  /** True when it is the viewer who fell. */
  mine: boolean;
}

/**
 * Somebody is out.
 *
 * A fall used to be one line in the ticker, which is to say nobody saw it: the block vanished
 * on the next state, the seat vanished from the strip, and the crew found out by counting. A
 * fall is the relay's one moment of real stakes, so everyone on the tower now watches it
 * happen: the frame flashes red at the edges, the player's snoo appears ringed in their colour,
 * shudders, loses its colour and drops out of the frame, and OUT lands where it was. The block
 * they missed goes over the edge in the scene behind at the same time.
 *
 * Pointer events are off: on a tower where it is your turn next, the screen is still the drop.
 */
export const RelayFall: React.FC<{ fall: Fall }> = ({ fall }) => (
  <div
    className={`relay-fall${fall.mine ? ' relay-fall--mine' : ''}`}
    aria-live="polite"
    style={{ ['--rim-rgb' as string]: factionRgb(fall.faction) }}
  >
    <span className="relay-fall__flash" aria-hidden="true" />
    <span className="relay-fall__avatar" aria-hidden="true">
      <img
        src={fall.snoovatar ?? '/snoo.png'}
        alt=""
        draggable={false}
        onError={(e) => {
          const img = e.currentTarget;
          if (!img.src.endsWith('/snoo.png')) img.src = '/snoo.png';
        }}
      />
    </span>
    <span className="relay-fall__word">{fall.mine ? 'You fell' : 'Out'}</span>
    <span className="relay-fall__who">
      {fall.mine
        ? `At block ${fall.block.toLocaleString()}. Out until tomorrow.`
        : `u/${fall.username} fell at ${fall.block.toLocaleString()}`}
    </span>
  </div>
);
