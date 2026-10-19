import React from 'react';
import { Html } from '@react-three/drei';
import { CountUp } from '../ui/Progress';

/**
 * What a raise did, floating off the top of the tower that did it: "+1" over land the viewer's
 * colour gained, "Safe" over a tower raised on the keep, with a line under it saying what it was
 * or who it came from.
 */
export interface RaiseMark {
  key: number;
  /** World position of the top of the tower that did it. */
  x: number;
  y: number;
  z: number;
  text: string;
  /** The colour the word is set in: the winner's, or white for a raise that won nothing. */
  color: string;
  /** How long after the raise it appears, ms: a take waits for the loser to come down. */
  delay: number;
  /** A line under the word, e.g. "from u/name", with the name in its owner's colour. */
  sub?: { lead: string; name?: string | undefined; rgb?: string | null | undefined } | undefined;
  /**
   * What the raise earned, counted up under it: its XP, and the multiplier the raise won when it
   * won more than its blocks (shared/social/progress.ts), stamped on first.
   */
  xp?: { value: number; mult: number } | undefined;
  /** A last, quieter line: what a capstone was made of. */
  note?: string | undefined;
}

/** How long after the mark itself its XP line comes in, ms. */
const XP_AFTER_MS = 260;

/** "×2", "×1.5": a multiplier as the mark stamps it. */
const multWords = (m: number): string =>
  `×${Number.isInteger(m) ? m : m.toFixed(1).replace(/\.0$/, '')}`;

/** How long a mark lives, including its delay. Matches the CSS animation plus the longest delay. */
export const RAISE_MARK_MS = 3200;

/**
 * The marks, drawn as DOM over the scene so they are type, like the rest of the chrome.
 *
 * They float up and fade by CSS alone; the list is trimmed by the caller after RAISE_MARK_MS.
 * Never interactive: they sit over the board, and the board is where the taps go.
 */
export const RaiseMarks: React.FC<{ marks: readonly RaiseMark[] }> = ({ marks }) => (
  <>
    {marks.map((m) => (
      <Html
        key={m.key}
        position={[m.x, m.y, m.z]}
        center
        zIndexRange={[6, 0]}
        style={{ pointerEvents: 'none' }}
      >
        <span className="raise-mark" style={{ animationDelay: `${m.delay}ms` }}>
          <span className="raise-mark__text" style={{ color: m.color }}>
            {m.text}
          </span>
          {m.sub && (
            <span className="raise-mark__sub">
              {m.sub.lead}
              {m.sub.name && (
                <>
                  {' '}
                  <span
                    className="ui-name"
                    style={
                      m.sub.rgb
                        ? ({ ['--rim-rgb' as string]: m.sub.rgb } as React.CSSProperties)
                        : undefined
                    }
                  >
                    {m.sub.name}
                  </span>
                </>
              )}
            </span>
          )}
          {m.xp && m.xp.value > 0 && (
            <span
              className="raise-mark__xp"
              style={{ animationDelay: `${m.delay + XP_AFTER_MS}ms` }}
            >
              {m.xp.mult > 1 && (
                <span
                  className="raise-mark__mult"
                  style={{ animationDelay: `${m.delay + XP_AFTER_MS}ms` }}
                >
                  {multWords(m.xp.mult)}
                </span>
              )}
              <span>
                +<CountUp value={m.xp.value} delay={m.delay + XP_AFTER_MS + 120} /> XP
              </span>
            </span>
          )}
          {m.note && <span className="raise-mark__note">{m.note}</span>}
        </span>
      </Html>
    ))}
  </>
);
