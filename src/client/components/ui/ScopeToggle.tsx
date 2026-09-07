import React from 'react';
import type { GridScope } from '../../hooks/useGridView';
import { Tabs } from './Chrome';

interface ScopeToggleProps {
  scope: GridScope;
  onChange: (scope: GridScope) => void;
  /** Disabled while placing: the plot you are aiming at is not a choice at that moment. */
  disabled?: boolean;
}

const OPTIONS = [
  { value: 'mine', label: 'My plot' },
  { value: 'community', label: 'The city' },
] as const;

/**
 * Switches the board between the player's own plot and the whole community.
 *
 * Tabs rather than a button, because the states are peers and neither modifies the other -- a
 * button labelled "community" gives no hint that what you are looking at right now is only yours.
 */
export const ScopeToggle: React.FC<ScopeToggleProps> = ({ scope, onChange, disabled }) => (
  <Tabs
    options={OPTIONS}
    value={scope}
    onChange={(value) => onChange(value as GridScope)}
    ariaLabel="Which towers to show"
    disabled={disabled}
  />
);
