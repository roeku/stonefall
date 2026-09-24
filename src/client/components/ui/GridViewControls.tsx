import React from 'react';
import { IconButton } from './Chrome';
import { ZoomInIcon, ZoomOutIcon } from './icons';

interface GridViewControlsProps {
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
}

/**
 * Zoom buttons for the board.
 *
 * These exist because Reddit's inline posts permit tap and click as their only input -- pinch,
 * drag and scroll belong to the feed and an app must not capture them. Zoom is the gesture a
 * player cannot do without; turning the view is not, because the board already turns itself
 * slowly, so the two rotate buttons that used to stand under these are gone and the right edge
 * is two glyphs rather than a column. The chrome takes them away whenever a card or the
 * swatches need that edge, because a button under a card is a button nobody can press.
 */
export const GridViewControls: React.FC<GridViewControlsProps> = ({
  canZoomIn,
  canZoomOut,
  onZoomIn,
  onZoomOut,
}) => (
  <div className="board-controls">
    <IconButton label="Zoom in" onClick={onZoomIn} disabled={!canZoomIn}>
      <ZoomInIcon />
    </IconButton>
    <IconButton label="Zoom out" onClick={onZoomOut} disabled={!canZoomOut}>
      <ZoomOutIcon />
    </IconButton>
  </div>
);
