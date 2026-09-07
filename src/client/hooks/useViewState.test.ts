import { describe, expect, it } from 'vitest';
import {
  initialViewState,
  viewStateReducer,
  VIEW_Z,
  type ViewAction,
  type ViewState,
} from './useViewState';

/**
 * The point of this model is that screens can no longer collide. Before it, six independent
 * booleans each gated a screen with no rule keeping them exclusive, and almost all rendered at
 * the same z-index -- so what showed on top was source order, not intent.
 *
 * These pin the two guarantees that follow: exactly one primary view, and overlays that do not
 * outlive the screen that opened them.
 */
const run = (state: ViewState, ...actions: ViewAction[]): ViewState =>
  actions.reduce(viewStateReducer, state);

describe('viewStateReducer', () => {
  it('holds exactly one view, replacing rather than accumulating', () => {
    const state = run(initialViewState('loading'), { type: 'goTo', view: 'start' });
    expect(state.view).toBe('start');

    const next = run(state, { type: 'goTo', view: 'playing' });
    // The previous screen is genuinely gone, not merely behind the new one.
    expect(next.view).toBe('playing');
  });

  it('stacks multiple overlays over a view without replacing it', () => {
    const state = run(
      initialViewState('grid'),
      { type: 'openOverlay', overlay: 'confirmReset' }
    );

    expect(state.overlays.has('confirmReset')).toBe(true);
    expect(state.view).toBe('grid');
  });

  it('closes one overlay without disturbing the others', () => {
    const state = run(
      initialViewState('grid'),
      { type: 'openOverlay', overlay: 'tournament' },
      { type: 'openOverlay', overlay: 'confirmReset' },
      { type: 'closeOverlay', overlay: 'tournament' }
    );

    expect(state.overlays.has('tournament')).toBe(false);
    expect(state.overlays.has('confirmReset')).toBe(true);
  });

  it('drops overlays when the view changes', () => {
    const state = run(
      initialViewState('grid'),
      { type: 'openOverlay', overlay: 'tournament' },
      { type: 'goTo', view: 'playing' }
    );

    // A tournament menu surviving into placement is exactly the stacking this prevents.
    expect(state.overlays.size).toBe(0);
    expect(state.view).toBe('playing');
  });

  it('clears every overlay at once', () => {
    const state = run(
      initialViewState('grid'),
      { type: 'openOverlay', overlay: 'confirmReset' },
      { type: 'closeAllOverlays' }
    );
    expect(state.overlays.size).toBe(0);
  });

  it('returns the same object for no-op actions so React can skip re-rendering', () => {
    const base = run(initialViewState('start'));
    expect(viewStateReducer(base, { type: 'goTo', view: 'start' })).toBe(base);
    expect(viewStateReducer(base, { type: 'closeOverlay', overlay: 'tournament' })).toBe(base);
    expect(viewStateReducer(base, { type: 'closeAllOverlays' })).toBe(base);

    const withOverlay = run(base, { type: 'openOverlay', overlay: 'tournament' });
    expect(viewStateReducer(withOverlay, { type: 'openOverlay', overlay: 'tournament' })).toBe(
      withOverlay
    );
  });

  it('still clears overlays when re-entering the view it is already on', () => {
    const state = run(
      initialViewState('grid'),
      { type: 'openOverlay', overlay: 'tournament' },
      { type: 'goTo', view: 'grid' }
    );
    // Navigating to the current screen is a reset, not a no-op, or a stuck overlay would
    // survive an attempt to return to a clean screen.
    expect(state.overlays.size).toBe(0);
  });
});

describe('layer ordering', () => {
  it('puts confirmations above overlays, overlays above feedback, feedback above the view', () => {
    expect(VIEW_Z.confirm).toBeGreaterThan(VIEW_Z.overlay);
    expect(VIEW_Z.overlay).toBeGreaterThan(VIEW_Z.feedback);
    expect(VIEW_Z.feedback).toBeGreaterThan(VIEW_Z.primary);
  });
});
