import React from 'react';

/**
 * Monoline glyphs, no fills, with square ends and sharp corners so they sit with the blocks
 * rather than with a web page. Only where a word would not do: the sound, zoom, paging.
 */
const Icon: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <svg
    className="ui-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.75}
    strokeLinecap="square"
    strokeLinejoin="miter"
    aria-hidden="true"
    focusable="false"
  >
    {children}
  </svg>
);

/** Zoom in: a plus, nothing round around it. */
export const ZoomInIcon = () => (
  <Icon>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

/** Zoom out: a minus. */
export const ZoomOutIcon = () => (
  <Icon>
    <path d="M5 12h14" />
  </Icon>
);

export const RotateLeftIcon = () => (
  <Icon>
    <path d="M4 5v5h5" />
    <path d="M4.5 10a8 8 0 1 1 1.2 7" />
  </Icon>
);

export const RotateRightIcon = () => (
  <Icon>
    <path d="M20 5v5h-5" />
    <path d="M19.5 10a8 8 0 1 0-1.2 7" />
  </Icon>
);

/** One tower standing on another. */
export const StackIcon = () => (
  <Icon>
    <rect x={7} y={13} width={10} height={7} />
    <rect x={9} y={4} width={6} height={9} />
  </Icon>
);

export const UsersIcon = () => (
  <Icon>
    <circle cx={9} cy={8} r={3.2} />
    <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
    <circle cx={16.5} cy={9} r={2.4} />
    <path d="M15.5 14.2a4.5 4.5 0 0 1 5 4.3" />
  </Icon>
);

export const SoundOnIcon = () => (
  <Icon>
    <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z" />
    <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
  </Icon>
);

export const SoundOffIcon = () => (
  <Icon>
    <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z" />
    <path d="M16 9.5l5 5M21 9.5l-5 5" />
  </Icon>
);

export const FlagIcon = () => (
  <Icon>
    <path d="M6 21V4M6 4h11l-2.5 4L17 12H6" />
  </Icon>
);

export const TurnIcon = () => (
  <Icon>
    <circle cx={12} cy={12} r={8.5} />
    <path d="M12 7.5V12l3 2" />
  </Icon>
);

export const PrevIcon = () => (
  <Icon>
    <path d="M14.5 6 8.5 12l6 6" />
  </Icon>
);

export const NextIcon = () => (
  <Icon>
    <path d="M9.5 6l6 6-6 6" />
  </Icon>
);
