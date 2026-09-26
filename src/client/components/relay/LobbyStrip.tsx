import React from 'react';
import type { RelayPlayer, RelayTurn } from '../../../shared/types/api';
import { factionRgb } from '../../../shared/types/factions';
import { Avatar } from './Avatar';

/** A seat on its way out: somebody who just fell, shown where they sat while they drop. */
export interface LeavingSeat {
  key: number;
  player: RelayPlayer;
  /** Where in the strip they sat. */
  index: number;
}

interface LobbyStripProps {
  /** The crew who are here, in rotation order, starting with whoever holds the turn. */
  lobby: readonly RelayPlayer[];
  turn: RelayTurn | null;
  myUserId: string | null;
  /** 0 to 1, how much of the current turn has elapsed. */
  progress: number;
  leaving?: LeavingSeat | null | undefined;
}

/**
 * How many seats the strip draws before it says "+N": the player on turn and the next four,
 * which is as much of a column as fits between the readout and the buttons in a 512 post.
 */
const SHOWN = 5;

const ordinal = (n: number): string => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

const Seat: React.FC<{
  p: RelayPlayer;
  className: string;
  children?: React.ReactNode;
  /** Only the seat on turn and your own are named; the rest are faces. */
  label: string | null;
}> = ({ p, className, children, label }) => (
  <div
    className={className}
    title={`u/${p.username}`}
    style={{ ['--rim-rgb' as string]: factionRgb(p.faction) }}
  >
    <Avatar className="lobby__snoo" src={p.snoovatar} name={p.username} />
    {label && <span className="lobby__name">{label}</span>}
    {children}
  </div>
);

/**
 * The crew, down the right edge.
 *
 * A seat per player in rotation order: their snoo ringed in their colour. The seat on turn is
 * lit and a fuse along its foot burns down with the turn. You are marked with your place in the
 * queue: "3rd" is the whole answer to "when do I get to play", which is what a crew list exists
 * to answer. A player who falls shudders, goes grey and drops out of their seat.
 */
export const LobbyStrip: React.FC<LobbyStripProps> = ({
  lobby,
  turn,
  myUserId,
  progress,
  leaving,
}) => {
  const shown = lobby.slice(0, SHOWN);
  const rest = lobby.length - shown.length;
  const myIndex = lobby.findIndex((p) => p.userId === myUserId);
  const ghost = leaving && !lobby.some((p) => p.userId === leaving.player.userId) ? leaving : null;
  const seats: Array<{ p: RelayPlayer; i: number; falling: boolean }> = shown.map((p, i) => ({
    p,
    i,
    falling: false,
  }));
  if (ghost) {
    seats.splice(Math.min(ghost.index, seats.length), 0, {
      p: ghost.player,
      i: -1,
      falling: true,
    });
  }

  return (
    <div className="lobby" aria-label="The crew">
      {seats.map(({ p, i, falling }) => {
        if (falling) {
          return (
            <Seat
              key={`leaving-${ghost!.key}`}
              p={p}
              className="lobby__seat lobby__seat--falling"
              label={p.userId === myUserId ? 'you' : p.username}
            />
          );
        }
        const active = turn?.userId === p.userId;
        const mine = p.userId === myUserId;
        return (
          <Seat
            key={p.userId}
            p={p}
            className={`lobby__seat${active ? ' lobby__seat--active' : ''}${mine ? ' lobby__seat--me' : ''}`}
            label={mine ? 'you' : active ? p.username : null}
          >
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
          </Seat>
        );
      })}
      {rest > 0 && <span className="lobby__more">+{rest}</span>}
      {myIndex >= SHOWN && (
        <span className="lobby__place lobby__place--far">you {ordinal(myIndex + 1)}</span>
      )}
    </div>
  );
};
