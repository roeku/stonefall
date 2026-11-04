import React from 'react';
import { factionHex } from '../../../shared/types/factions';
import type { LifeWay, WaysBack } from '../../../shared/social/lives';

/**
 * Out for today, with lives still to be won back on the map (shared/social/lives.ts): the out
 * screen as a scene of its own rather than words over a tower. And its answer, back in with a
 * life won there.
 *
 * The world steps back behind it (the HUD's `relay-hud--out` scrim, and the tags, marks and crew
 * strip put away), the way the map steps back for a reward, so the one thing in the light is what
 * there is to do about being out. Each way is a mission: a "+1" for the life it is worth, what to
 * do in the chrome's own type, and how far along it is, the next order to do or the nemesis named
 * in their colour with how often they did it. The tower keeps going behind the dark, without you.
 * Back in, the ways that paid are lit and stop breathing, and any still open stay below them:
 * there is another life in it.
 */
export const OutScene: React.FC<{
  ways: WaysBack;
  /** The ways still to win, in the order they are listed. */
  open: readonly LifeWay[];
  /** A life won on the map has brought the player back in. */
  back?: boolean | undefined;
}> = ({ ways, open, back = false }) => {
  const won: LifeWay[] = back
    ? [
        ...(ways.orders.earned ? (['orders'] as const) : []),
        ...(ways.nemesis?.earned ? (['nemesis'] as const) : []),
      ]
    : [];
  const rows = [
    ...won.map((way) => ({ way, done: true })),
    ...open.map((way) => ({ way, done: false })),
  ];
  const nemesisName = (
    <span
      className="mission__name"
      style={ways.nemesis?.faction ? { color: factionHex(ways.nemesis.faction) } : undefined}
    >
      u/{ways.nemesis?.username}
    </span>
  );
  const pips = (lit: number) => (
    <span className="ui-orders__pips" aria-hidden="true">
      {Array.from({ length: ways.orders.of }, (_, k) => (
        <span key={k} className={`ui-orders__pip${k < lit ? ' ui-orders__pip--on' : ''}`} />
      ))}
    </span>
  );

  return (
    <div
      className={`relay-out${back ? ' relay-out--back' : ''}`}
      role="group"
      aria-label={back ? 'Back in' : 'Out for today'}
    >
      <span className="relay-out__word">{back ? 'Back in' : 'Out for today'}</span>
      <span className="relay-out__kicker">
        {back
          ? won.length > 1
            ? `${won.length} lives won back`
            : 'A life won back'
          : open.length === 1
            ? 'A life to win back'
            : `${open.length} lives to win back`}
      </span>
      <ul className="relay-out__missions">
        {rows.map(({ way, done }, i) => (
          <li
            key={way}
            className={`mission${done ? ' mission--won' : ''}`}
            style={{ ['--i' as string]: i } as React.CSSProperties}
          >
            <span className="mission__gain" aria-label="One life">
              +1
            </span>
            {way === 'orders' ? (
              <span className="mission__text">
                <span className="mission__title">
                  {done ? 'Orders done' : "Finish today's orders"}
                </span>
                <span className="mission__detail">
                  {pips(done ? ways.orders.of : ways.orders.done)}
                  {done
                    ? `All ${ways.orders.of} today`
                    : ways.orders.next
                      ? `Next: ${ways.orders.next}`
                      : `${ways.orders.done} of ${ways.orders.of}`}
                </span>
              </span>
            ) : (
              <span className="mission__text">
                <span className="mission__title">
                  {done ? 'Toppled' : 'Topple'} {nemesisName}
                </span>
                <span className="mission__detail">
                  {done
                    ? 'Your nemesis, paid back'
                    : `Your nemesis · toppled you ${ways.nemesis?.times ?? 0}× this week`}
                </span>
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};
