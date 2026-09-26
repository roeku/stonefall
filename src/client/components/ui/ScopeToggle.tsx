import React from 'react';
import type { GridScope } from '../../hooks/useGridView';

interface ScopeToggleProps {
  scope: GridScope;
  onChange: (scope: GridScope) => void;
  /** Disabled while placing: the plot you are aiming at is not a choice at that moment. */
  disabled?: boolean;
}

/**
 * The names are places, not owners. "Mine" used to sit over a view that shows every tower on the
 * plot, most of them the neighbours', so it was a small lie read a hundred times.
 */
const NAME: Record<GridScope, string> = { mine: 'Plot', all: 'Map' };

/**
 * Switches the board between the player's own plot and the whole map.
 *
 * One word, naming where a tap goes: MAP on the plot, PLOT on the map. Two tabs said the same
 * thing with twice the chrome. The switch sounds where the scope changes, so there is no tick
 * here as well.
 */
export const ScopeToggle: React.FC<ScopeToggleProps> = ({ scope, onChange, disabled }) => {
  const next: GridScope = scope === 'mine' ? 'all' : 'mine';
  return (
    <button
      type="button"
      className="ui-button ui-button--ghost"
      onClick={() => onChange(next)}
      disabled={disabled}
      aria-label={`Show the ${NAME[next].toLowerCase()}`}
    >
      <span className="ui-button__label">{NAME[next]}</span>
    </button>
  );
};
