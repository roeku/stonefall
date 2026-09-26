import React from 'react';
import { Html } from '@react-three/drei';

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
}

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
        </span>
      </Html>
    ))}
  </>
);
