import React from 'react';

/**
 * The chrome, reduced to type and hairlines.
 *
 * Everything here sits over a board of glowing towers, and the board is the point. So: no
 * panels, no frames, no ornament. A readout is a small label over a number. A stat is an icon
 * beside a number. The one drawn shape is the primary button, a single hairline with two
 * chamfered corners, because the one action on the screen has to look like the action.
 *
 * Legibility over neon comes from a dark halo on the type rather than from boxes.
 */

export type Tone = 'default' | 'good' | 'alert' | 'warm' | 'best';

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

/** Two peers, the active one underlined. */
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
        {o.label}
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
 * Primary: one hairline, chamfered at two opposite corners. Ghost: text with an underline.
 * The frame is an SVG so the line stays a pixel wide whatever the button's size.
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
    onClick={onClick}
    disabled={disabled}
  >
    {variant === 'primary' && (
      <svg
        className="ui-button__frame"
        viewBox="0 0 240 46"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path d="M10 0.5H239.5V36L229.5 45.5H0.5V10L10 0.5Z" vectorEffect="non-scaling-stroke" />
      </svg>
    )}
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
    onClick={onClick}
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
