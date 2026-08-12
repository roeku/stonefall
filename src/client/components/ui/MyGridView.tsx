import React from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { PlayerGrid, TowerMapEntry } from '../../../shared/types/api';
import { DEFAULT_TOWER_GRID_SIZE } from '../../../shared/types/towerPlacement';
import { HOME_GRID_RADIUS, MAX_PLACEMENTS_PER_PLAYER } from '../../../shared/constants/towers';
import { GPUInstancedTowerSystem } from '../game/GPUInstancedTowerSystem';
import { TronBackground } from '../effects/TronBackground';
import { GridViewControls } from './GridViewControls';

interface MyGridViewProps {
  grid: PlayerGrid | null;
  towers: TowerMapEntry[];
  /** Session id of the tower just placed, highlighted so the result of placing is obvious. */
  highlightSessionId?: string | null;
  /** A tower the player built but hasn't placed yet, if any. */
  unplacedTower?: TowerMapEntry | null;
  isBusy: boolean;
  error: string | null;
  onPlaceUnplaced: () => void;
  onRemove: (sessionId: string) => void;
  onBack: () => void;
}

const stubGameState = { isGameOver: true } as const;

const ZOOM_STEPS = [0.65, 0.85, 1.1, 1.45, 1.9] as const;
const ROTATION_STEP = Math.PI / 4;

/**
 * The player's own grid: where placement lands, and where towers are managed.
 *
 * This is the screen that was missing, and its absence is what made the rest of the flow feel
 * broken. Confirming a placement used to return to the *community* grid, where a home-grid
 * placement doesn't appear at all, so placing a tower looked like it had done nothing. It also
 * left two dead ends: a tower you skipped placing could never be placed, and the server's
 * "grid is full, remove one" error told players to do something the app offered no way to do.
 */
export const MyGridView: React.FC<MyGridViewProps> = ({
  grid,
  towers,
  highlightSessionId = null,
  unplacedTower = null,
  isBusy,
  error,
  onPlaceUnplaced,
  onRemove,
  onBack,
}) => {
  const [zoomIndex, setZoomIndex] = React.useState(2);
  const [rotation, setRotation] = React.useState(0);
  const [selected, setSelected] = React.useState<TowerMapEntry | null>(null);

  const placedCount = grid?.placements?.length ?? 0;
  const isFull = placedCount >= MAX_PLACEMENTS_PER_PLAYER;

  // The just-placed tower is worth calling out; otherwise a grid of similar towers gives no
  // feedback that anything happened.
  const highlighted = React.useMemo(
    () => towers.find((t) => t.sessionId === highlightSessionId) ?? null,
    [towers, highlightSessionId]
  );

  React.useEffect(() => {
    if (highlighted) setSelected(highlighted);
  }, [highlighted]);

  const statusText = selected
    ? `${selected.score.toLocaleString()} pts · ${selected.blockCount} blocks`
    : placedCount === 0
      ? 'No towers placed yet'
      : `${placedCount} of ${MAX_PLACEMENTS_PER_PLAYER} placed`;

  return (
    <div style={{ position: 'absolute', inset: 0, background: '#000814', zIndex: 50 }}>
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

        <GPUInstancedTowerSystem
          isGameOver={true}
          playerTower={highlighted}
          preAssignedTowers={towers}
          selectedTower={selected}
          expectedTotalTowers={towers.length}
          leadingColor={null}
          fallbackBluePercentage={null}
          onTowerClick={(tower) =>
            setSelected((current) => (current?.sessionId === tower.sessionId ? null : tower))
          }
        />

        <HomeGridCamera
          focus={selected}
          zoom={ZOOM_STEPS[zoomIndex] ?? 1}
          rotation={rotation}
        />
      </Canvas>

      <div className="tron-grid-chrome">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
          <div className={`tron-grid-status${isFull ? ' tron-grid-status--blocked' : ''}`}>
            <span className="tron-grid-status__label">
              {selected ? 'Selected tower' : 'Your grid'}
            </span>
            {statusText}
          </div>

          <GridViewControls
            canZoomIn={zoomIndex > 0}
            canZoomOut={zoomIndex < ZOOM_STEPS.length - 1}
            onZoomIn={() => setZoomIndex((i) => Math.max(0, i - 1))}
            onZoomOut={() => setZoomIndex((i) => Math.min(ZOOM_STEPS.length - 1, i + 1))}
            onRotateLeft={() => setRotation((r) => r - ROTATION_STEP)}
            onRotateRight={() => setRotation((r) => r + ROTATION_STEP)}
          />
        </div>

        <div className="tron-grid-actions">
          {error && (
            <div role="alert" className="tron-grid-error">
              {error}
            </div>
          )}

          {/* A tower built but never placed is recoverable from here. Without this, skipping
              placement stranded it permanently. */}
          {unplacedTower && (
            <button
              type="button"
              className="tron-grid-btn"
              onClick={onPlaceUnplaced}
              disabled={isBusy || isFull}
            >
              {isFull ? 'Grid full — remove one first' : 'Place your new tower'}
            </button>
          )}

          {/* Removing is what makes the server's "grid full" message actionable. */}
          {selected && (
            <button
              type="button"
              className="tron-grid-btn tron-grid-btn--danger"
              onClick={() => {
                onRemove(selected.sessionId);
                setSelected(null);
              }}
              disabled={isBusy}
            >
              Remove selected
            </button>
          )}

          <button
            type="button"
            className="tron-grid-btn tron-grid-btn--ghost"
            onClick={onBack}
            disabled={isBusy}
          >
            Back to the grid
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * Orbits the whole home grid, or a selected tower once one is tapped.
 *
 * Settles quickly on purpose. The game-end camera drifts at a lerp of 0.03, which is fine for a
 * cinematic reveal but reads as unresponsive when every camera change is a direct answer to a
 * button press.
 */
const HomeGridCamera: React.FC<{
  focus: TowerMapEntry | null;
  zoom: number;
  rotation: number;
}> = ({ focus, zoom, rotation }) => {
  const { camera } = useThree();
  const currentPos = React.useRef(new THREE.Vector3(70, 55, 70));
  const currentLook = React.useRef(new THREE.Vector3(0, 0, 0));

  useFrame((_, delta) => {
    const focusX = focus?.worldX ?? 0;
    const focusZ = focus?.worldZ ?? 0;

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
