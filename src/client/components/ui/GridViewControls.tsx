import React from 'react';
import { IconButton } from './Chrome';
import { RotateLeftIcon, RotateRightIcon, ZoomInIcon, ZoomOutIcon } from './icons';

interface GridViewControlsProps {
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onRotateLeft: () => void;
  onRotateRight: () => void;
}

/**
 * Zoom and rotate buttons for the board.
 *
 * These exist because Reddit's inline posts permit tap and click as their only input -- pinch,
 * drag and scroll belong to the feed and an app must not capture them. So the two camera gestures
 * a 3D scene would normally get for free have to be buttons instead.
 */
export const GridViewControls: React.FC<GridViewControlsProps> = ({
  canZoomIn,
  canZoomOut,
  onZoomIn,
  onZoomOut,
  onRotateLeft,
  onRotateRight,
}) => (
  <div className="board-controls">
    <IconButton label="Zoom in" onClick={onZoomIn} disabled={!canZoomIn}>
      <ZoomInIcon />
    </IconButton>
    <IconButton label="Zoom out" onClick={onZoomOut} disabled={!canZoomOut}>
      <ZoomOutIcon />
    </IconButton>
    <IconButton label="Rotate view left" onClick={onRotateLeft}>
      <RotateLeftIcon />
    </IconButton>
    <IconButton label="Rotate view right" onClick={onRotateRight}>
      <RotateRightIcon />
    </IconButton>
  </div>
);
