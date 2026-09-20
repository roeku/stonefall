import React from 'react';
import type { RelayPlayer, RelayTurn } from '../../../shared/types/api';
import { factionRgb } from '../../../shared/types/factions';

interface LobbyStripProps {
  /** Present players in rotation order, starting with whoever holds the turn. */
  lobby: readonly RelayPlayer[];
  turn: RelayTurn | null;
  myUserId: string | null;
  /** 0 to 1, how much of the current turn has elapsed. */
  progress: number;
}

/** How many seats the strip draws before it says "+N". */
const SHOWN = 6;

const ordinal = (n: number): string => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

/**
 * Who is here, down the right edge.
 *
 * A seat per player, in rotation order: a small slab rimmed in their colour with their snoo on
 * it, the same material as everything else on the screen. The seat on turn is lit and a fuse
 * along its foot burns down with the ten seconds. You are marked with your place in the queue:
 * "3rd" is the whole answer to "when do I get to play", which is what a lobby exists to answer.
 */
export const LobbyStrip: React.FC<LobbyStripProps> = ({ lobby, turn, myUserId, progress }) => {
  const shown = lobby.slice(0, SHOWN);
  const rest = lobby.length - shown.length;
  const myIndex = lobby.findIndex((p) => p.userId === myUserId);

  return (
    <div className="lobby" aria-label="Players in the lobby">
      {shown.map((p, i) => {
        const active = turn?.userId === p.userId;
        const mine = p.userId === myUserId;
        return (
          <div
            key={p.userId}
            className={`lobby__seat${active ? ' lobby__seat--active' : ''}${mine ? ' lobby__seat--me' : ''}`}
            title={`u/${p.username}`}
            style={{ ['--rim-rgb' as string]: factionRgb(p.faction) }}
          >
            <img
              className="lobby__snoo"
              src={p.snoovatar ?? '/snoo.png'}
              alt=""
              draggable={false}
              onError={(e) => {
                const img = e.currentTarget;
                if (!img.src.endsWith('/snoo.png')) img.src = '/snoo.png';
              }}
            />
            <span className="lobby__name">{mine ? 'you' : p.username}</span>
            {mine && !active && myIndex > 0 && (
              <span className="lobby__place">{ordinal(myIndex + 1)}</span>
            )}
            {i === 0 && active && <span className="lobby__place lobby__place--now">now</span>}
            {active && (
              <span
                className="lobby__fuse"
                aria-hidden="true"
                style={{ transform: `scaleX(${Math.max(0, 1 - progress)})` }}
              />
            )}
          </div>
        );
      })}
      {rest > 0 && <span className="lobby__more">+{rest}</span>}
      {myIndex >= SHOWN && (
        <span className="lobby__place lobby__place--far">you {ordinal(myIndex + 1)}</span>
      )}
    </div>
  );
};
