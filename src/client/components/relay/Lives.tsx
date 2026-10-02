import React from 'react';
import { RELAY } from '../../../shared/relay/rules';

/**
 * A player's lives for the day, as a row of dots: lit while they have it, a hollow ring once it
 * is spent. `lost` marks the one that just went, which pops before it goes hollow.
 */
export const Lives: React.FC<{ left: number; lost?: boolean | undefined; className?: string }> = ({
  left,
  lost = false,
  className,
}) => (
  <span
    className={`lives${className ? ` ${className}` : ''}`}
    role="img"
    aria-label={`${left} of ${RELAY.LIVES} lives left`}
  >
    {Array.from({ length: RELAY.LIVES }, (_, i) => (
      <span
        key={i}
        className={`lives__pip${i >= left ? ' lives__pip--spent' : ''}${
          lost && i === left ? ' lives__pip--lost' : ''
        }`}
      />
    ))}
  </span>
);
