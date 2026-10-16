import React from 'react';
import { IconButton } from './Chrome';
import { GrabIcon, ZoomInIcon, ZoomOutIcon } from './icons';

interface GridViewControlsProps {
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  /** The grab tool, on or off. */
  grab: boolean;
  onGrab: (event: MouseEvent) => void;
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
 *
 * Under them, the grab tool, for a player who wants to walk round the map themselves: lit while
 * it is on, when a drag turns the camera and the board stops turning by itself (useOrbitDrag).
 */
export const GridViewControls: React.FC<GridViewControlsProps> = ({
  canZoomIn,
  canZoomOut,
  onZoomIn,
  onZoomOut,
  grab,
  onGrab,
}) => (
  <div className="board-controls">
    <IconButton label="Zoom in" onClick={onZoomIn} disabled={!canZoomIn}>
      <ZoomInIcon />
    </IconButton>
    <IconButton label="Zoom out" onClick={onZoomOut} disabled={!canZoomOut}>
      <ZoomOutIcon />
    </IconButton>
    <IconButton
      label={grab ? 'Stop turning the view' : 'Turn the view by hand'}
      onClick={onGrab}
      pressed={grab}
      className="board-controls__grab"
    >
      <GrabIcon />
    </IconButton>
  </div>
);
