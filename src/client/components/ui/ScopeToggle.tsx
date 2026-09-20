import React from 'react';
import type { GridScope } from '../../hooks/useGridView';
import { Tabs } from './Chrome';

interface ScopeToggleProps {
  scope: GridScope;
  onChange: (scope: GridScope) => void;
  /** Disabled while placing: the plot you are aiming at is not a choice at that moment. */
  disabled?: boolean;
}

/**
 * The two labels are places, not owners. "Mine" used to sit over a view that shows every tower
 * on the plot, most of them the neighbours', so it was a small lie read a hundred times.
 */
const OPTIONS = [
  { value: 'mine', label: 'Plot' },
  { value: 'all', label: 'Map' },
] as const;

/**
 * Switches the board between the player's own plot and the whole map.
 *
 * Tabs rather than a button, because the states are peers and neither modifies the other. One
 * word each: they are read a hundred times and understood once.
 */
export const ScopeToggle: React.FC<ScopeToggleProps> = ({ scope, onChange, disabled }) => (
  <Tabs
    options={OPTIONS}
    value={scope}
    onChange={(value) => onChange(value as GridScope)}
    ariaLabel="Which part of the board to show"
    disabled={disabled}
  />
);
