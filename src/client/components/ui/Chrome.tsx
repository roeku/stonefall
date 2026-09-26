import React from 'react';
import { AudioPlayer } from '../audio/AudioPlayer';

/**
 * The chrome, reduced to type.
 *
 * Everything here sits over a board of glowing towers, and the board is the point. So there are
 * no panels, no frames and no glow on the chrome: glow belongs to the world. A readout is a
 * number and a word. The one action on a screen is a verb in capitals, the largest line at the
 * foot of the frame. The one drawn thing is Build, which is the next block itself.
 *
 * Legibility over neon comes from a tight dark shadow under the type rather than from boxes.
 * Nothing is set below thirteen pixels and nothing tappable is smaller than 44, because this is
 * read on a phone at arm's length and pressed with a thumb.
 *
 * Every control answers a press with a tick. A control that changes state (the scope toggle,
 * the swatches) has its own sound where the state changes, so only the plain buttons tick here.
 */

export type Tone = 'default' | 'good' | 'alert' | 'best';

const tick = (pitch: number): void => {
  AudioPlayer.unlock();
  AudioPlayer.playTap(pitch);
};

interface ReadoutProps {
  label: React.ReactNode;
  value: React.ReactNode;
  tone?: Tone | undefined;
  /** Larger value, for a number that is the context of the screen. */
  size?: 'default' | 'large' | undefined;
  /** The number first and the word under it, rather than a word over a number. */
  under?: boolean | undefined;
  className?: string | undefined;
}

export const Readout: React.FC<ReadoutProps> = ({
  label,
  value,
  tone = 'default',
  size = 'default',
  under = false,
  className = '',
}) => (
  <div
    className={`ui-readout ui-tone-${tone} ui-readout--${size}${under ? ' ui-readout--under' : ''} ${className}`}
  >
    <span className="ui-label">{label}</span>
    <span className="ui-value">{value}</span>
  </div>
);

interface ButtonProps {
  children: React.ReactNode;
  /** Given the click, for the few calls Reddit only answers from a trusted event. */
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean | undefined;
  /**
   * Primary: the one action, a verb in capitals. Ghost: a quiet word beside it. Link: an optional
   * offer, one underlined sentence.
   */
  variant?: 'primary' | 'ghost' | 'link' | undefined;
  /** A second, smaller line under the label: what the verb will do. Primary only. */
  sub?: React.ReactNode | undefined;
  className?: string | undefined;
  /** For a control whose label is a symbol or needs saying differently to a screen reader. */
  ariaLabel?: string | undefined;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  onClick,
  disabled,
  variant = 'primary',
  sub,
  className = '',
  ariaLabel,
}) => (
  <button
    type="button"
    className={`ui-button ui-button--${variant}${sub ? ' ui-button--has-sub' : ''} ${className}`}
    onClick={(event) => {
      if (disabled) return;
      tick(variant === 'primary' ? 1.15 : 0.95);
      onClick(event);
    }}
    disabled={disabled}
    aria-label={ariaLabel}
  >
    <span className="ui-button__label">{children}</span>
    {sub && <span className="ui-button__sub">{sub}</span>}
  </button>
);

interface IconButtonProps {
  label: string;
  onClick: () => void;
  disabled?: boolean | undefined;
  children: React.ReactNode;
  className?: string | undefined;
}

export const IconButton: React.FC<IconButtonProps> = ({
  label,
  onClick,
  disabled,
  children,
  className = '',
}) => (
  <button
    type="button"
    className={`ui-iconbtn ${className}`}
    aria-label={label}
    title={label}
    onClick={() => {
      if (disabled) return;
      tick(1.05);
      onClick();
    }}
    disabled={disabled}
  >
    {children}
  </button>
);

/** One line of standing guidance or transient feedback. */
export const Pill: React.FC<{
  tone?: Tone | undefined;
  children: React.ReactNode;
  role?: string | undefined;
}> = ({ tone = 'default', children, role = 'status' }) => (
  <div className={`ui-pill ui-tone-${tone}`} role={role}>
    {children}
  </div>
);

/** The page's navy, which a block's unlit faces are mixed toward. */
const GROUND = '#000814';

const mix = (a: string, b: string, t: number): string => {
  const at = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  const channel = (i: number) => Math.round(at(a, i) + (at(b, i) - at(a, i)) * t);
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
};

/**
 * One block, drawn the way the world draws them: seen from above at the board's angle, the top
 * lit most, the two sides darker, the edges picked out in a lighter line.
 */
const Block: React.FC<{ color: string }> = ({ color }) => {
  const rim = mix(color, '#ffffff', 0.25);
  return (
    <svg className="ui-build__block" viewBox="-4 -4 74 60" aria-hidden="true" focusable="false">
      <polygon
        points="3.6,32 33,49 33,35.9 3.6,18.9"
        fill={mix(GROUND, color, 0.42)}
        stroke={rim}
        strokeWidth={1.3}
        strokeLinejoin="round"
      />
      <polygon
        points="62.4,32 33,49 33,35.9 62.4,18.9"
        fill={mix(GROUND, color, 0.28)}
        stroke={rim}
        strokeWidth={1.3}
        strokeLinejoin="round"
      />
      <polygon
        points="33,1.9 62.4,18.9 33,35.9 3.6,18.9"
        fill={mix(GROUND, color, 0.62)}
        stroke={rim}
        strokeWidth={1.3}
        strokeLinejoin="round"
      />
    </svg>
  );
};

interface BuildButtonProps {
  label: string;
  /** What the run will be for, e.g. "Beat 1,240 to take F3". */
  sub?: string | null | undefined;
  /** The viewer's colour, as #rrggbb. */
  color: string;
  disabled?: boolean | undefined;
  onClick: () => void;
}

/**
 * Build: the next block, waiting at the foot of the frame in the viewer's colour. It bobs, so
 * the one thing to do is the one thing moving, and it drops a little under the thumb.
 */
export const BuildButton: React.FC<BuildButtonProps> = ({
  label,
  sub,
  color,
  disabled,
  onClick,
}) => (
  <button
    type="button"
    className="ui-build"
    onClick={() => {
      if (disabled) return;
      tick(1.15);
      onClick();
    }}
    disabled={disabled}
  >
    <span className="ui-build__lift">
      <Block color={color} />
    </span>
    <span className="ui-build__label">{label}</span>
    {sub && <span className="ui-build__sub">{sub}</span>}
  </button>
);
