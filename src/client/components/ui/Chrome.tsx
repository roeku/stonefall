import React from 'react';
import { AudioPlayer } from '../audio/AudioPlayer';

/**
 * The chrome, reduced to type and hairlines.
 *
 * Everything here sits over a board of glowing towers, and the board is the point. So: no
 * panels, no frames, no ornament. A readout is a small label over a number. A stat is an icon
 * beside a number. The one drawn shape is the primary button, a single hairline with two
 * chamfered corners, because the one action on the screen has to look like the action.
 *
 * Legibility over neon comes from a dark halo on the type rather than from boxes. Nothing is set
 * below ten pixels and nothing tappable is smaller than 44, because this is read on a phone at
 * arm's length and pressed with a thumb.
 *
 * Every control answers a press with a tick. A control that changes state (the scope tabs, the
 * swatches) has its own sound where the state changes, so only the plain buttons tick here.
 */

export type Tone = 'default' | 'good' | 'alert' | 'warm' | 'best';

const tick = (pitch: number): void => {
  AudioPlayer.unlock();
  AudioPlayer.playTap(pitch);
};

interface ReadoutProps {
  label: React.ReactNode;
  value: React.ReactNode;
  tone?: Tone | undefined;
  /** Larger value, for the score. */
  size?: 'default' | 'large' | undefined;
  className?: string | undefined;
}

export const Readout: React.FC<ReadoutProps> = ({
  label,
  value,
  tone = 'default',
  size = 'default',
  className = '',
}) => (
  <div className={`ui-readout ui-tone-${tone} ui-readout--${size} ${className}`}>
    <span className="ui-label">{label}</span>
    <span className="ui-value">{value}</span>
  </div>
);

interface StatProps {
  icon?: React.ReactNode;
  value: React.ReactNode;
  /** What the number is; shown on hover and to screen readers. */
  title: string;
  tone?: Tone | undefined;
  /** Re-run the pop animation whenever this changes. */
  popKey?: React.Key | undefined;
}

export const Stat: React.FC<StatProps> = ({ icon, value, title, tone = 'default', popKey }) => (
  <span
    key={popKey}
    className={`ui-stat ui-tone-${tone}${popKey !== undefined ? ' ui-pop' : ''}`}
    title={title}
    aria-label={title}
  >
    {icon}
    <span className="ui-stat__value">{value}</span>
  </span>
);

export const StatRow: React.FC<{ children: React.ReactNode; className?: string | undefined }> = ({
  children,
  className = '',
}) => <div className={`ui-stats ${className}`}>{children}</div>;

interface TabsProps {
  options: ReadonlyArray<{ value: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  disabled?: boolean | undefined;
}

/** One slab split into cells, the active cell lit. Each cell is thumb-sized. */
export const Tabs: React.FC<TabsProps> = ({ options, value, onChange, ariaLabel, disabled }) => (
  <div className="ui-tabs" role="radiogroup" aria-label={ariaLabel}>
    {options.map((o) => (
      <button
        key={o.value}
        type="button"
        role="radio"
        aria-checked={o.value === value}
        disabled={disabled}
        className={`ui-tab${o.value === value ? ' ui-tab--on' : ''}`}
        onClick={() => onChange(o.value)}
      >
        <span className="ui-tab__label">{o.label}</span>
      </button>
    ))}
  </div>
);

interface ButtonProps {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean | undefined;
  variant?: 'primary' | 'ghost' | undefined;
  className?: string | undefined;
}

/**
 * Primary: the one filled slab on the screen, lit in the viewer's colour. Ghost: the same slab,
 * unlit. Both are drawn entirely in CSS from the shared material.
 */
export const Button: React.FC<ButtonProps> = ({
  children,
  onClick,
  disabled,
  variant = 'primary',
  className = '',
}) => (
  <button
    type="button"
    className={`ui-button ui-button--${variant} ${className}`}
    onClick={() => {
      if (disabled) return;
      tick(variant === 'primary' ? 1.15 : 0.95);
      onClick();
    }}
    disabled={disabled}
  >
    <span className="ui-button__label">{children}</span>
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
