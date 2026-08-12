import React from 'react';

interface GridViewControlsProps {
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onRotateLeft: () => void;
  onRotateRight: () => void;
}

/**
 * Zoom and rotate buttons for the 3D grid screens.
 *
 * These exist because Reddit's inline posts permit tap and click as their only input -- pinch,
 * drag and scroll belong to the feed and an app must not capture them. So the two camera
 * gestures a 3D scene would normally get for free have to be buttons instead.
 *
 * Kept small and cornered: they are a fallback for when the default framing isn't enough, not
 * a primary control.
 */
export const GridViewControls: React.FC<GridViewControlsProps> = ({
  canZoomIn,
  canZoomOut,
  onZoomIn,
  onZoomOut,
  onRotateLeft,
  onRotateRight,
}) => (
  <div className="tron-view-controls">
    <button
      type="button"
      className="tron-view-btn"
      aria-label="Zoom in"
      onClick={onZoomIn}
      disabled={!canZoomIn}
    >
      +
    </button>
    <button
      type="button"
      className="tron-view-btn"
      aria-label="Zoom out"
      onClick={onZoomOut}
      disabled={!canZoomOut}
    >
      −
    </button>
    <button
      type="button"
      className="tron-view-btn"
      aria-label="Rotate view left"
      onClick={onRotateLeft}
    >
      ⟲
    </button>
    <button
      type="button"
      className="tron-view-btn"
      aria-label="Rotate view right"
      onClick={onRotateRight}
    >
      ⟳
    </button>
  </div>
);
