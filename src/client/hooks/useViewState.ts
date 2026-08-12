import { useCallback, useMemo, useReducer } from 'react';

/**
 * The single source of truth for which screen is showing.
 *
 * This replaces a set of independent booleans -- showStartScreen, showGameEndModal,
 * isGridReviewOpen, isTournamentMenuOpen, isEloLeaderboardOpen, isLeaderboardPostView -- that
 * had no rule preventing several from being true at once, and which nearly all rendered at
 * z-50, so whatever ended up on top was source order rather than intent. Screens genuinely did
 * collide.
 *
 * The model is deliberately small: exactly one primary view is showing, and any number of
 * overlays may sit above it at explicit, ordered layers.
 */

/** Mutually exclusive. Exactly one is showing at any moment. */
export type AppView =
  /** Initial data load, before we know what this post is. */
  | 'loading'
  /** Pre-run menu. */
  | 'start'
  /** A run is in progress. */
  | 'playing'
  /**
   * The shared grid. One screen for browsing everyone's towers, looking at your own area, and
   * placing a finished tower -- these were three separate views with three Canvases until
   * placements moved into a single coordinate space, at which point they differed only by
   * where the camera pointed and whether a tower was in hand.
   */
  | 'grid'
  /** Standalone leaderboard post; this post never shows the game. */
  | 'leaderboardPost';

/** Layered above the current view. Several may be open together. */
export type AppOverlay = 'tournament' | 'eloLeaderboard' | 'confirmReset';

/**
 * Explicit stacking order, replacing the flat z-50 pile.
 *
 * Left as gaps of 10 so a new layer can be slotted between two existing ones without
 * renumbering everything.
 */
export const VIEW_Z = {
  primary: 10,
  /** Toasts and transient feedback, above the view but below anything interactive. */
  feedback: 40,
  overlay: 50,
  /** Destructive confirmations always sit on top. */
  confirm: 70,
} as const;

export interface ViewState {
  view: AppView;
  overlays: ReadonlySet<AppOverlay>;
}

export type ViewAction =
  | { type: 'goTo'; view: AppView }
  | { type: 'openOverlay'; overlay: AppOverlay }
  | { type: 'closeOverlay'; overlay: AppOverlay }
  | { type: 'closeAllOverlays' };

export const initialViewState = (view: AppView): ViewState => ({ view, overlays: new Set() });

/**
 * Pure transition function, kept separate from the hook so the rules can be tested directly
 * rather than through a renderer.
 */
export const viewStateReducer = (state: ViewState, action: ViewAction): ViewState => {
  switch (action.type) {
    case 'goTo':
      if (state.view === action.view && state.overlays.size === 0) return state;
      // Overlays belong to the screen that opened them. A tournament menu surviving into
      // placement is exactly the kind of stacking this model exists to prevent.
      return { view: action.view, overlays: new Set() };

    case 'openOverlay': {
      if (state.overlays.has(action.overlay)) return state;
      const overlays = new Set(state.overlays);
      overlays.add(action.overlay);
      return { ...state, overlays };
    }

    case 'closeOverlay': {
      if (!state.overlays.has(action.overlay)) return state;
      const overlays = new Set(state.overlays);
      overlays.delete(action.overlay);
      return { ...state, overlays };
    }

    case 'closeAllOverlays':
      if (state.overlays.size === 0) return state;
      return { ...state, overlays: new Set() };
  }
};

export interface ViewStateHook {
  view: AppView;
  is: (view: AppView) => boolean;
  /** True for any post-run grid screen, community or personal. */
  isGridView: boolean;
  goTo: (view: AppView) => void;
  openOverlay: (overlay: AppOverlay) => void;
  closeOverlay: (overlay: AppOverlay) => void;
  closeAllOverlays: () => void;
  isOverlayOpen: (overlay: AppOverlay) => boolean;
}

export const useViewState = (initial: AppView = 'loading'): ViewStateHook => {
  const [state, dispatch] = useReducer(viewStateReducer, initial, initialViewState);
  const { view, overlays } = state;

  const goTo = useCallback((next: AppView) => dispatch({ type: 'goTo', view: next }), []);
  const openOverlay = useCallback(
    (overlay: AppOverlay) => dispatch({ type: 'openOverlay', overlay }),
    []
  );
  const closeOverlay = useCallback(
    (overlay: AppOverlay) => dispatch({ type: 'closeOverlay', overlay }),
    []
  );
  const closeAllOverlays = useCallback(() => dispatch({ type: 'closeAllOverlays' }), []);

  const isOverlayOpen = useCallback((overlay: AppOverlay) => overlays.has(overlay), [overlays]);

  const is = useCallback((candidate: AppView) => view === candidate, [view]);

  const isGridView = useMemo(() => view === 'grid', [view]);

  // Memoised so the returned object only changes when the state actually does. Without this it
  // is a fresh object every render, which makes it useless as a dependency: callers either omit
  // it (capturing a stale reference) or include it (and lose their memoisation entirely). The
  // transitions are dispatch-backed and stable; only the predicates track state.
  return useMemo(
    () => ({
      view,
      is,
      isGridView,
      goTo,
      openOverlay,
      closeOverlay,
      closeAllOverlays,
      isOverlayOpen,
    }),
    [view, is, isGridView, goTo, openOverlay, closeOverlay, closeAllOverlays, isOverlayOpen]
  );
};
