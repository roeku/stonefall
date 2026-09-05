import React from 'react';
import {
  ArtIconButton,
  RotateLeftIcon,
  RotateRightIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from './tron/TronArt';

interface GridViewControlsProps {
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onRotateLeft: () => void;
  onRotateRight: () => void;
}

const Btn: React.FC<{
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}> = ({ label, onClick, disabled, children }) => (
  <button
    type="button"
    className="tron-view-btn"
    aria-label={label}
    onClick={onClick}
    disabled={disabled}
  >
    <ArtIconButton>{children}</ArtIconButton>
  </button>
);

/**
 * Zoom and rotate buttons for the grid.
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
  <div className="tron-view-controls">
    <Btn label="Zoom in" onClick={onZoomIn} disabled={!canZoomIn}>
      <ZoomInIcon />
    </Btn>
    <Btn label="Zoom out" onClick={onZoomOut} disabled={!canZoomOut}>
      <ZoomOutIcon />
    </Btn>
    <Btn label="Rotate view left" onClick={onRotateLeft}>
      <RotateLeftIcon />
    </Btn>
    <Btn label="Rotate view right" onClick={onRotateRight}>
      <RotateRightIcon />
    </Btn>
  </div>
);
