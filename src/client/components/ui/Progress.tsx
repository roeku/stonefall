import React from 'react';
import { orderWords, type OrderNews } from '../../../shared/social/progress';
import { factionHex, factionRgb, type FactionId } from '../../../shared/types/factions';

/**
 * Progress on the chrome (shared/social/progress.ts): the level, the day's orders, and the moment
 * a level is gained.
 *
 * The level is a block. The square of colour that has always stood for the player's side carries
 * their level on it now, so it costs the chrome nothing: the same shape, the same place, with a
 * number. XP flies into it, and it takes every spark as a small knock.
 */

/** The player's level on a square of their colour. */
export const LevelChip: React.FC<{
  faction: FactionId;
  level: number;
  /** Bumped by each spark arriving. */
  hit: number;
  /** The level just gained, while its flash plays. */
  up: number | null;
}> = ({ faction, level, hit, up }) => (
  // Keyed on the hit, so every spark restarts the knock, and on the level gained for its flash.
  <span
    key={up !== null ? `up-${up}` : `h-${hit}`}
    className={`ui-level${up !== null ? ' ui-level--up' : hit > 0 ? ' ui-level--hit' : ''}`}
    style={{ background: factionHex(faction), ['--rim-rgb' as string]: factionRgb(faction) }}
  >
    {level}
  </span>
);

/**
 * The day's orders, one line under the side: three little blocks, lit for each order done, and
 * what the next one asks, with how far along it is. An order just done says so for a moment and
 * sends its XP up into the level, then the line moves on. Gone once every order is done.
 */
export const OrderLine: React.FC<{
  orders: readonly OrderNews[];
  /** The order just done, while it is being shown off. */
  done: { key: number; index: number } | null;
}> = ({ orders, done }) => {
  const showing = done ? orders[done.index] : orders.find((o) => !o.done);
  if (!showing) return null;
  const index = done ? done.index : orders.indexOf(showing);
  const justDone = done !== null;
  return (
    <span
      className={`ui-orders${justDone ? ' ui-orders--done' : ''}`}
      aria-label={`Orders: ${orders.filter((o) => o.done).length} of ${orders.length} done. Next: ${orderWords(showing)}.`}
    >
      <span className="ui-orders__pips" aria-hidden="true">
        {orders.map((o, i) => (
          <span
            key={`${i}-${o.done ? 'on' : 'off'}`}
            className={`ui-orders__pip${o.done ? ' ui-orders__pip--on' : ''}${justDone && i === index ? ' ui-pop' : ''}`}
          />
        ))}
      </span>
      <span key={justDone ? `done-${done.key}` : `o-${index}`} className="ui-orders__text">
        {justDone ? (
          <>
            {orderWords(showing)} <span className="ui-orders__gain">+{showing.xp}</span>
          </>
        ) : (
          <>
            {orderWords(showing)}
            {showing.n > 1 && (
              <span className="ui-orders__count">
                {' '}
                {showing.count}/{showing.n}
              </span>
            )}
          </>
        )}
      </span>
    </span>
  );
};

/**
 * A level gained: the number, huge, over the world for a moment. Type over the scene like the
 * rest of the chrome; nothing behind it. The towers light up under it (App's spotlight).
 */
export const LevelUpCallout: React.FC<{
  up: { key: number; level: number } | null;
  faction: FactionId;
}> = ({ up, faction }) =>
  up ? (
    <div
      key={up.key}
      className="level-up"
      role="status"
      style={{ ['--rim-rgb' as string]: factionRgb(faction) }}
    >
      <span className="level-up__kicker">Level up</span>
      <span className="level-up__n">{up.level}</span>
    </div>
  ) : null;

/** A number that counts up to `value` once it appears, quick at first and settling. */
export const CountUp: React.FC<{ value: number; delay?: number; ms?: number }> = ({
  value,
  delay = 0,
  ms = 650,
}) => {
  const [n, setN] = React.useState(0);
  React.useEffect(() => {
    let raf = 0;
    const start = performance.now() + delay;
    const tick = () => {
      const t = Math.min(1, Math.max(0, (performance.now() - start) / ms));
      setN(Math.round(value * (1 - Math.pow(1 - t, 3))));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, delay, ms]);
  return <>{n.toLocaleString()}</>;
};
