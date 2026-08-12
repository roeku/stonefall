import React from 'react';
import type { PlacementDirection, PlacementTarget } from '../../hooks/usePlacementMode';
import { MAX_STACK_PER_CELL } from '../../../shared/types/towerPlacement';

interface PlacementControlsProps {
  target: PlacementTarget;
  canZoomIn: boolean;
  canZoomOut: boolean;
  isSaving?: boolean;
  error?: string | null;
  onMove: (direction: PlacementDirection) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onRotateLeft: () => void;
  onRotateRight: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Controls for placing a finished tower on your home grid.
 *
 * Built for Reddit's inline posts, where the gesture rules are strict: **tap and click are the
 * only permitted input**, and an app must not capture scroll, pinch or pan -- those belong to
 * the feed, and a user has to be able to scroll past the post. So every action here is a
 * discrete button, including the ones a 3D scene would normally get from dragging.
 *
 * The whole cluster only exists while a tower is being placed. Nothing from this component is
 * on screen during play or while browsing the grid.
 */

/** Comfortably above the ~44px minimum tap target, since these get used repeatedly. */
const BUTTON_SIZE = 48;

const buttonBase: React.CSSProperties = {
  width: BUTTON_SIZE,
  height: BUTTON_SIZE,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: '1px solid rgba(96, 165, 250, 0.45)',
  borderRadius: 10,
  background: 'rgba(3, 12, 24, 0.82)',
  color: 'rgba(191, 219, 254, 0.95)',
  fontFamily: "'Orbitron', monospace",
  fontSize: 18,
  lineHeight: 1,
  cursor: 'pointer',
  // Stops the browser reserving the gesture for panning/zooming, which would both break the
  // button and interfere with the feed scroll Reddit requires to stay intact.
  touchAction: 'manipulation',
  WebkitTapHighlightColor: 'transparent',
  userSelect: 'none',
};

const ControlButton: React.FC<{
  label: string;
  ariaLabel: string;
  onPress: () => void;
  disabled?: boolean;
  style?: React.CSSProperties;
}> = ({ label, ariaLabel, onPress, disabled = false, style }) => (
  <button
    type="button"
    aria-label={ariaLabel}
    disabled={disabled}
    onClick={onPress}
    style={{
      ...buttonBase,
      ...style,
      opacity: disabled ? 0.32 : 1,
      cursor: disabled ? 'default' : 'pointer',
    }}
  >
    {label}
  </button>
);

export const PlacementControls: React.FC<PlacementControlsProps> = ({
  target,
  canZoomIn,
  canZoomOut,
  isSaving = false,
  error,
  onMove,
  onZoomIn,
  onZoomOut,
  onRotateLeft,
  onRotateRight,
  onConfirm,
  onCancel,
}) => {
  const cellFull = !target.canPlace;
  const statusText = cellFull
    ? `Cell full (${MAX_STACK_PER_CELL} max)`
    : target.isEmpty
      ? 'Empty cell'
      : `Stacking on ${target.stackCount} (${target.stackCount + 1}/${MAX_STACK_PER_CELL})`;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        // The overlay itself must never eat taps meant for the scene, or block the feed scroll.
        // Only the controls themselves opt back into pointer events.
        pointerEvents: 'none',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '12px',
        zIndex: 40,
      }}
    >
      {/* Status + view controls */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <div
          style={{
            pointerEvents: 'none',
            padding: '8px 12px',
            borderRadius: 10,
            background: 'rgba(3, 12, 24, 0.82)',
            border: '1px solid rgba(96, 165, 250, 0.35)',
            fontFamily: "'Orbitron', monospace",
            fontSize: 11,
            letterSpacing: '0.08em',
            color: cellFull ? 'rgba(248, 113, 113, 0.95)' : 'rgba(191, 219, 254, 0.95)',
          }}
        >
          <div style={{ opacity: 0.7, fontSize: 9, marginBottom: 2 }}>PLACE YOUR TOWER</div>
          <div>{statusText}</div>
        </div>

        {/* View controls: the replacement for pinch-zoom and drag-rotate, neither of which
            inline posts allow. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, pointerEvents: 'auto' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <ControlButton label="+" ariaLabel="Zoom in" onPress={onZoomIn} disabled={!canZoomIn} />
            <ControlButton
              label="−"
              ariaLabel="Zoom out"
              onPress={onZoomOut}
              disabled={!canZoomOut}
            />
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <ControlButton label="⟲" ariaLabel="Rotate view left" onPress={onRotateLeft} />
            <ControlButton label="⟳" ariaLabel="Rotate view right" onPress={onRotateRight} />
          </div>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          style={{
            alignSelf: 'center',
            padding: '8px 14px',
            borderRadius: 10,
            background: 'rgba(69, 10, 10, 0.9)',
            border: '1px solid rgba(248, 113, 113, 0.5)',
            color: 'rgba(254, 226, 226, 0.98)',
            fontFamily: "'Orbitron', monospace",
            fontSize: 11,
          }}
        >
          {error}
        </div>
      )}

      {/* Movement + commit */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        {/* D-pad. Directions are resolved against the current view angle, so "up" always means
            away from the camera even after rotating. */}
        <div
          style={{
            pointerEvents: 'auto',
            display: 'grid',
            gridTemplateColumns: `repeat(3, ${BUTTON_SIZE}px)`,
            gridTemplateRows: `repeat(2, ${BUTTON_SIZE}px)`,
            gap: 4,
          }}
        >
          <div />
          <ControlButton label="▲" ariaLabel="Move away" onPress={() => onMove('up')} />
          <div />
          <ControlButton label="◀" ariaLabel="Move left" onPress={() => onMove('left')} />
          <ControlButton label="▼" ariaLabel="Move closer" onPress={() => onMove('down')} />
          <ControlButton label="▶" ariaLabel="Move right" onPress={() => onMove('right')} />
        </div>

        <div
          style={{ pointerEvents: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}
        >
          <ControlButton
            label={isSaving ? '…' : '✓'}
            ariaLabel="Confirm placement"
            onPress={onConfirm}
            disabled={cellFull || isSaving}
            style={{
              width: BUTTON_SIZE * 2 + 4,
              borderColor: 'rgba(74, 222, 128, 0.6)',
              color: 'rgba(187, 247, 208, 0.98)',
              fontSize: 22,
            }}
          />
          <ControlButton
            label="✕"
            ariaLabel="Cancel placement"
            onPress={onCancel}
            disabled={isSaving}
            style={{
              width: BUTTON_SIZE * 2 + 4,
              height: 36,
              borderColor: 'rgba(148, 163, 184, 0.4)',
              color: 'rgba(203, 213, 225, 0.9)',
              fontSize: 14,
            }}
          />
        </div>
      </div>
    </div>
  );
};
