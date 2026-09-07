import React from 'react';

/** Monoline icons, 1.5px stroke, no fills. Drawn to sit with the hairline chrome. */
const Icon: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <svg
    className="ui-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {children}
  </svg>
);

export const ZoomInIcon = () => (
  <Icon>
    <circle cx={10.5} cy={10.5} r={6.5} />
    <path d="M15.5 15.5 21 21M10.5 7.5v6M7.5 10.5h6" />
  </Icon>
);

export const ZoomOutIcon = () => (
  <Icon>
    <circle cx={10.5} cy={10.5} r={6.5} />
    <path d="M15.5 15.5 21 21M7.5 10.5h6" />
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

export const BlocksIcon = () => (
  <Icon>
    <path d="M12 3 21 7.5 12 12 3 7.5 12 3Z" />
    <path d="M3 12 12 16.5 21 12M3 16.5 12 21l9-4.5" />
  </Icon>
);

export const HeightIcon = () => (
  <Icon>
    <path d="M12 3.5v17M8.5 4.5h7M10 9h4M10 15h4M8.5 19.5h7" />
  </Icon>
);

/** A perfect placement: a four-point spark. */
export const SparkIcon = () => (
  <Icon>
    <path d="M12 3v6M12 15v6M3 12h6M15 12h6" />
    <path d="M12 8.5 13.6 12 12 15.5 10.4 12 12 8.5Z" />
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

export const CloseIcon = () => (
  <Icon>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
);
