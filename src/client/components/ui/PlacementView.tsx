import React from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { TowerMapEntry } from '../../../shared/types/api';
import {
  DEFAULT_TOWER_GRID_SIZE,
  MAX_STACK_PER_CELL,
} from '../../../shared/types/towerPlacement';
import { HOME_GRID_RADIUS } from '../../../shared/constants/towers';
import { GPUInstancedTowerSystem } from '../game/GPUInstancedTowerSystem';
import { TowerGhost } from '../game/TowerGhost';
import { TronBackground } from '../effects/TronBackground';
import type { PlacementModeHook } from '../../hooks/usePlacementMode';
import { worldToGrid } from '../../hooks/usePlacementMode';

interface PlacementViewProps {
  placement: PlacementModeHook;
  /** The tower being placed. Its geometry is what the ghost draws. */
  tower: TowerMapEntry | null;
  /** Towers already on the player's home grid. */
  placedTowers: TowerMapEntry[];
  isSaving: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

const stubGameState = { isGameOver: true } as const;

/** Half-extent of the tappable ground plane, sized to comfortably cover the home grid. */
const GROUND_EXTENT = (HOME_GRID_RADIUS + 2) * DEFAULT_TOWER_GRID_SIZE;

/**
 * Dedicated screen for placing a finished tower on your home grid.
 *
 * Deliberately its own view rather than an overlay on the community grid. The community grid is
 * sized for thousands of towers (radius ~40, driven by MAX_VISIBLE_TOWERS) while a home grid is
 * radius 6 -- overlaying one on the other meant the cursor and the drawn grid were different
 * coordinate spaces, and every piece of game-end chrome stayed on screen underneath.
 *
 * Interaction is tap-only, which is all Reddit's inline posts permit. One invisible ground plane
 * is raycast and the hit point converted to a cell, so targeting costs a single hit test rather
 * than a mesh per cell. First tap targets, second tap on the same cell commits.
 */
export const PlacementView: React.FC<PlacementViewProps> = ({
  placement,
  tower,
  placedTowers,
  isSaving,
  error,
  onConfirm,
  onCancel,
}) => {
  const { target } = placement;

  const handleGroundTap = (event: { point: THREE.Vector3; stopPropagation: () => void }) => {
    event.stopPropagation();
    if (isSaving) return;

    const gridX = worldToGrid(event.point.x);
    const gridZ = worldToGrid(event.point.z);

    // Tapping the already-targeted cell is the confirm gesture. Tapping anywhere else
    // retargets, so a mis-tap moves the ghost rather than committing to the wrong place.
    if (placement.isTargeted(gridX, gridZ)) {
      if (target?.canPlace) onConfirm();
      return;
    }
    placement.selectCell(gridX, gridZ);
  };

  const statusText = !target
    ? 'Tap a cell to position your tower'
    : !target.canPlace
      ? `That cell is full (${MAX_STACK_PER_CELL} max) — pick another`
      : target.isEmpty
        ? 'Tap again to place here'
        : `Tap again to stack on ${target.stackCount}`;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: '#000814',
        zIndex: 60,
      }}
    >
      <Canvas
        dpr={[0.6, 1.1]}
        camera={{ position: [70, 55, 70], fov: 30, near: 1, far: 2000 }}
        gl={{ antialias: false, alpha: false, powerPreference: 'high-performance' }}
        frameloop="always"
      >
        <color attach="background" args={['#000814']} />

        <TronBackground
          gameState={stubGameState}
          gridSize={DEFAULT_TOWER_GRID_SIZE}
          gridOffsetX={0}
          gridOffsetZ={0}
          gridLineWidth={3}
          gridColorHex="#1e90ff"
        />

        {/* Invisible tap surface. A single plane replaces what would otherwise be one hitbox
            per cell; the hit point carries the coordinates we need. */}
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0, 0]}
          onClick={handleGroundTap}
          visible={false}
        >
          <planeGeometry args={[GROUND_EXTENT * 2, GROUND_EXTENT * 2]} />
        </mesh>

        <GPUInstancedTowerSystem
          isGameOver={true}
          playerTower={null}
          preAssignedTowers={placedTowers}
          selectedTower={null}
          expectedTotalTowers={placedTowers.length}
          leadingColor={null}
          fallbackBluePercentage={null}
        />

        {target && tower && (
          <TowerGhost
            blocks={tower.towerBlocks ?? []}
            worldX={target.worldX}
            worldZ={target.worldZ}
            baseY={target.stackHeight}
            canPlace={target.canPlace}
          />
        )}

        <PlacementCamera
          target={target}
          zoom={placement.zoom}
          rotation={placement.rotation}
        />
      </Canvas>

      {/* Chrome. Deliberately minimal: a status line, cancel, and view controls tucked into a
          corner. Everything else that used to be on this screen belongs to the game-end view,
          which is no longer underneath. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 14,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
          <div
            style={{
              padding: '8px 14px',
              borderRadius: 10,
              background: 'rgba(3, 12, 24, 0.8)',
              border: '1px solid rgba(96, 165, 250, 0.3)',
              fontFamily: "'Orbitron', monospace",
              fontSize: 11,
              letterSpacing: '0.06em',
              color:
                target && !target.canPlace
                  ? 'rgba(248, 113, 113, 0.95)'
                  : 'rgba(191, 219, 254, 0.95)',
            }}
          >
            {statusText}
          </div>

          <ViewControls
            canZoomIn={placement.canZoomIn}
            canZoomOut={placement.canZoomOut}
            onZoomIn={placement.zoomIn}
            onZoomOut={placement.zoomOut}
            onRotateLeft={placement.rotateLeft}
            onRotateRight={placement.rotateRight}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          {error && (
            <div
              role="alert"
              style={{
                padding: '7px 14px',
                borderRadius: 9,
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

          <button
            type="button"
            onClick={onCancel}
            disabled={isSaving}
            style={{
              pointerEvents: 'auto',
              padding: '9px 20px',
              borderRadius: 9,
              border: '1px solid rgba(148, 163, 184, 0.35)',
              background: 'rgba(3, 12, 24, 0.82)',
              color: 'rgba(203, 213, 225, 0.9)',
              fontFamily: "'Orbitron', monospace",
              fontSize: 11,
              letterSpacing: '0.08em',
              touchAction: 'manipulation',
              WebkitTapHighlightColor: 'transparent',
              cursor: isSaving ? 'default' : 'pointer',
              opacity: isSaving ? 0.4 : 1,
            }}
          >
            {isSaving ? 'PLACING…' : 'PLACE LATER'}
          </button>
        </div>
      </div>
    </div>
  );
};

/** Small cornered zoom/rotate cluster: the replacement for pinch and drag. */
const ViewControls: React.FC<{
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onRotateLeft: () => void;
  onRotateRight: () => void;
}> = ({ canZoomIn, canZoomOut, onZoomIn, onZoomOut, onRotateLeft, onRotateRight }) => {
  const button: React.CSSProperties = {
    width: 36,
    height: 36,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    border: '1px solid rgba(96, 165, 250, 0.3)',
    background: 'rgba(3, 12, 24, 0.7)',
    color: 'rgba(191, 219, 254, 0.85)',
    fontSize: 15,
    lineHeight: 1,
    touchAction: 'manipulation',
    WebkitTapHighlightColor: 'transparent',
    userSelect: 'none',
    cursor: 'pointer',
  };

  return (
    <div
      style={{
        pointerEvents: 'auto',
        display: 'grid',
        gridTemplateColumns: '36px 36px',
        gap: 5,
      }}
    >
      <button
        type="button"
        aria-label="Zoom in"
        onClick={onZoomIn}
        disabled={!canZoomIn}
        style={{ ...button, opacity: canZoomIn ? 1 : 0.3 }}
      >
        +
      </button>
      <button
        type="button"
        aria-label="Zoom out"
        onClick={onZoomOut}
        disabled={!canZoomOut}
        style={{ ...button, opacity: canZoomOut ? 1 : 0.3 }}
      >
        −
      </button>
      <button type="button" aria-label="Rotate left" onClick={onRotateLeft} style={button}>
        ⟲
      </button>
      <button type="button" aria-label="Rotate right" onClick={onRotateRight} style={button}>
        ⟳
      </button>
    </div>
  );
};

/**
 * Camera for placement: orbits the whole grid, or the targeted cell once one is chosen.
 *
 * Settles noticeably faster than the game-end camera. That one drifts cinematically at a lerp
 * of 0.03, which under discrete taps reads as the app ignoring the input for a couple of
 * seconds. Here every camera change is a direct response to a press and needs to look like one.
 */
const PlacementCamera: React.FC<{
  target: { worldX: number; worldZ: number } | null;
  zoom: number;
  rotation: number;
}> = ({ target, zoom, rotation }) => {
  const { camera } = useThree();
  const currentPos = React.useRef(new THREE.Vector3(70, 55, 70));
  const currentLook = React.useRef(new THREE.Vector3(0, 0, 0));

  useFrame((_, delta) => {
    const focusX = target?.worldX ?? 0;
    const focusZ = target?.worldZ ?? 0;

    // Framed so the whole home grid fits when zoomed out; tightening as the player zooms in.
    const distance = HOME_GRID_RADIUS * DEFAULT_TOWER_GRID_SIZE * 1.35 * zoom;
    const height = HOME_GRID_RADIUS * DEFAULT_TOWER_GRID_SIZE * 0.95 * zoom;

    const targetPos = new THREE.Vector3(
      focusX + Math.cos(rotation) * distance,
      height,
      focusZ + Math.sin(rotation) * distance
    );
    const targetLook = new THREE.Vector3(focusX, 4, focusZ);

    const lerpFactor = 1 - Math.pow(0.0001, delta);
    currentPos.current.lerp(targetPos, lerpFactor);
    currentLook.current.lerp(targetLook, lerpFactor);

    camera.position.copy(currentPos.current);
    camera.lookAt(currentLook.current);
  });

  return null;
};
