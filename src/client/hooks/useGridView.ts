import { useCallback, useMemo, useState } from 'react';

/**
 * Which towers the board is showing.
 *
 * Two views, not one. Landing on the whole community means arriving at a wall of other people's
 * work with your own contribution somewhere inside it; landing on your own plot means arriving
 * somewhere you recognise, with the community one tap away.
 */
export type GridScope = 'mine' | 'community';

/** A step feels like a step at this ratio; smaller reads as nothing happening. */
export const ZOOM_STEP = 1.6;

/**
 * Zoom is a multiplier on the framing the camera works out for itself from the viewport, so 1 is
 * always "the subject, fitted". The limits are what keep a single cell readable at one end and
 * a thousand-block tower inside the frame at the other.
 */
export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 10;

/** Eighth turns, so four taps bring you halfway round and the grid stays axis-legible. */
export const ROTATE_STEP = Math.PI / 4;

/** Looking down the grid's diagonal, which reads as depth rather than as a flat elevation. */
export const DEFAULT_YAW = Math.PI / 4;

export const clampZoom = (z: number): number =>
  Number.isFinite(z) ? Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z)) : 1;

export const zoomedIn = (z: number): number => clampZoom(z / ZOOM_STEP);
export const zoomedOut = (z: number): number => clampZoom(z * ZOOM_STEP);

export interface GridViewState {
  scope: GridScope;
  setScope: (scope: GridScope) => void;
  /** Camera rotation around the focus point, radians. */
  yaw: number;
  /** Standoff multiplier over the camera's own fitted framing. 1 is the fit. */
  zoom: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  zoomIn: () => void;
  zoomOut: () => void;
  rotateLeft: () => void;
  rotateRight: () => void;
  /** Back to the fitted framing, keeping the scope. */
  resetZoom: () => void;
  /** Drop back to the default framing entirely. */
  reset: () => void;
}

/**
 * Camera controls for the board, driven entirely by taps.
 *
 * Reddit inline posts permit tap and click only -- pinch, drag and scroll belong to the feed and
 * capturing them breaks the page around the game. So orbit and zoom, which a 3D scene normally
 * gets for free from gestures, have to be explicit state driven by buttons.
 *
 * Kept as a hook because two separate things need it: the scene, which turns it into a camera,
 * and the chrome, which draws the buttons.
 */
export const useGridView = (initialScope: GridScope = 'mine'): GridViewState => {
  const [yaw, setYaw] = useState(DEFAULT_YAW);
  const [scope, setScopeState] = useState<GridScope>(initialScope);
  const [zoom, setZoom] = useState(1);

  // Switching scope re-frames: the camera fits the new subject, so zoom goes back to 1. Leaving
  // it in place drops you either inside a single tower or so far from your own plot that you
  // cannot find it.
  const setScope = useCallback((next: GridScope) => {
    setScopeState(next);
    setZoom(1);
  }, []);

  const zoomIn = useCallback(() => setZoom(zoomedIn), []);
  const zoomOut = useCallback(() => setZoom(zoomedOut), []);
  const rotateLeft = useCallback(() => setYaw((y) => y - ROTATE_STEP), []);
  const rotateRight = useCallback(() => setYaw((y) => y + ROTATE_STEP), []);
  const resetZoom = useCallback(() => setZoom(1), []);
  const reset = useCallback(() => {
    setYaw(DEFAULT_YAW);
    setZoom(1);
  }, []);

  return useMemo(
    () => ({
      scope,
      setScope,
      yaw,
      zoom,
      // Compared against the clamped result rather than the raw bound, so a zoom already at the
      // limit reports the button as dead instead of offering a no-op.
      canZoomIn: zoomedIn(zoom) !== zoom,
      canZoomOut: zoomedOut(zoom) !== zoom,
      zoomIn,
      zoomOut,
      rotateLeft,
      rotateRight,
      resetZoom,
      reset,
    }),
    [scope, setScope, yaw, zoom, zoomIn, zoomOut, rotateLeft, rotateRight, resetZoom, reset]
  );
};
