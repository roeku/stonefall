import React from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { PlayerRegion, TowerMapEntry } from '../../../shared/types/api';
import { cellToWorld, isCellInRegion, worldToCell } from '../../../shared/types/worldGrid';
import { DEFAULT_TOWER_GRID_SIZE, MAX_STACK_PER_CELL } from '../../../shared/types/towerPlacement';
import { GPUInstancedTowerSystem } from '../game/GPUInstancedTowerSystem';
import { TowerGhost } from '../game/TowerGhost';
import { TronBackground } from '../effects/TronBackground';

const stubGameState = { isGameOver: true } as const;

export interface GridTarget {
  x: number;
  z: number;
}

interface GridSceneProps {
  towers: TowerMapEntry[];
  /** Set when a finished tower is waiting to be placed; enables placement mode. */
  pendingTower: TowerMapEntry | null;
  /** The player's buildable area. Null until they have one. */
  region: PlayerRegion | null;
  isPlacing: boolean;
  target: GridTarget | null;
  onTarget: (cell: GridTarget) => void;
  onPlace: (gridX: number, gridZ: number) => void;
}

/** How many towers already sit in each cell, so the UI can report what a tap would stack onto. */
export const countByCell = (towers: TowerMapEntry[]): Map<string, number> => {
  const map = new Map<string, number>();
  for (const t of towers) {
    if (t.gridX === undefined || t.gridZ === undefined) continue;
    const key = `${t.gridX},${t.gridZ}`;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
};

/**
 * Scene contents for the grid, rendered inside the application's single shared Canvas.
 *
 * This deliberately does NOT own a Canvas. It used to, and so did the game -- switching between
 * them tore down one WebGL context and created another, which the browser answered by losing
 * the context outright and rendering the game black. One Canvas for the whole app, contents
 * swapped inside it.
 *
 * Browsing and placing are the same scene, differing only by whether a tower is in hand. All
 * input is tap: Reddit inline posts permit tap and click only.
 */
export const GridScene: React.FC<GridSceneProps> = ({
  towers,
  pendingTower,
  region,
  isPlacing,
  target,
  onTarget,
  onPlace,
}) => {
  const isPlacementMode = pendingTower !== null && region !== null;
  const occupied = React.useMemo(() => countByCell(towers), [towers]);
  const targetStack = target ? (occupied.get(`${target.x},${target.z}`) ?? 0) : 0;
  const canPlace = targetStack < MAX_STACK_PER_CELL;

  const handleTap = (event: { point: THREE.Vector3; stopPropagation: () => void }) => {
    if (!isPlacementMode || isPlacing || !region) return;
    event.stopPropagation();

    const x = worldToCell(event.point.x);
    const z = worldToCell(event.point.z);

    // Taps outside the player's own area are ignored rather than erroring: most of the grid
    // belongs to other people, so stray taps there are expected, not a mistake worth reporting.
    if (!isCellInRegion({ rx: 0, rz: 0 }, x - region.centerX, z - region.centerZ)) return;

    // First tap targets, so the ghost shows the result; a second tap on the same cell commits.
    // Tapping elsewhere retargets, which keeps a mis-tap from being destructive.
    if (target && target.x === x && target.z === z) {
      if (canPlace) onPlace(x, z);
      return;
    }
    onTarget({ x, z });
  };

  return (
    <>
      <TronBackground
        gameState={stubGameState}
        gridSize={DEFAULT_TOWER_GRID_SIZE}
        gridOffsetX={0}
        gridOffsetZ={0}
        gridLineWidth={3}
        gridColorHex="#1e90ff"
      />

      {/* One invisible ground plane, raycast and converted to a cell, rather than a hitbox per
          cell. The hit point already carries the coordinates. */}
      {isPlacementMode && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} onClick={handleTap} visible={false}>
          <planeGeometry args={[6000, 6000]} />
        </mesh>
      )}

      <GPUInstancedTowerSystem
        isGameOver={true}
        playerTower={null}
        preAssignedTowers={towers}
        selectedTower={null}
        expectedTotalTowers={towers.length}
        leadingColor={null}
        fallbackBluePercentage={null}
      />

      {isPlacementMode && target && pendingTower && (
        <TowerGhost
          blocks={pendingTower.towerBlocks ?? []}
          worldX={cellToWorld(target.x)}
          worldZ={cellToWorld(target.z)}
          baseY={0}
          canPlace={canPlace}
        />
      )}

      <GridCamera
        focusX={target ? cellToWorld(target.x) : region ? cellToWorld(region.centerX) : 0}
        focusZ={target ? cellToWorld(target.z) : region ? cellToWorld(region.centerZ) : 0}
        wide={!isPlacementMode}
      />
    </>
  );
};

interface GridChromeProps {
  towers: TowerMapEntry[];
  isLoading: boolean;
  pendingTower: TowerMapEntry | null;
  region: PlayerRegion | null;
  isPlacing: boolean;
  error: string | null;
  target: GridTarget | null;
  onSkipPlacement: () => void;
  onPlay: () => void;
}

/** DOM chrome for the grid, layered above the shared Canvas. */
export const GridChrome: React.FC<GridChromeProps> = ({
  towers,
  isLoading,
  pendingTower,
  region,
  isPlacing,
  error,
  target,
  onSkipPlacement,
  onPlay,
}) => {
  const isPlacementMode = pendingTower !== null && region !== null;
  const occupied = React.useMemo(() => countByCell(towers), [towers]);
  const targetStack = target ? (occupied.get(`${target.x},${target.z}`) ?? 0) : 0;
  const canPlace = targetStack < MAX_STACK_PER_CELL;

  const status = !isPlacementMode
    ? isLoading
      ? 'Loading the grid'
      : towers.length === 0
        ? 'Nothing built yet'
        : `${towers.length} towers`
    : !target
      ? 'Tap a cell in your area'
      : !canPlace
        ? `Cell full (${MAX_STACK_PER_CELL} max)`
        : targetStack === 0
          ? 'Tap again to place'
          : `Tap again to stack on ${targetStack}`;

  return (
    <div className="tron-grid-chrome">
      <div
        className={`tron-grid-status${isPlacementMode && !canPlace ? ' tron-grid-status--blocked' : ''}`}
      >
        <span className="tron-grid-status__label">
          {isPlacementMode ? 'Place your tower' : 'The grid'}
        </span>
        {status}
      </div>

      <div className="tron-grid-actions">
        {error && (
          <div role="alert" className="tron-grid-error">
            {error}
          </div>
        )}

        {isPlacementMode ? (
          <button
            type="button"
            className="tron-grid-btn tron-grid-btn--ghost"
            onClick={onSkipPlacement}
            disabled={isPlacing}
          >
            {isPlacing ? 'Placing…' : 'Place later'}
          </button>
        ) : (
          <button type="button" className="tron-grid-btn" onClick={onPlay}>
            Build a tower
          </button>
        )}
      </div>
    </div>
  );
};

/**
 * Frames the whole grid while browsing, and tightens onto the target while placing.
 *
 * Settles quickly on purpose: every camera move here answers a tap, and a slow cinematic drift
 * reads as the app ignoring the input.
 */
const GridCamera: React.FC<{ focusX: number; focusZ: number; wide: boolean }> = ({
  focusX,
  focusZ,
  wide,
}) => {
  const { camera } = useThree();
  const pos = React.useRef(new THREE.Vector3(70, 55, 70));
  const look = React.useRef(new THREE.Vector3(0, 0, 0));

  useFrame((_, delta) => {
    const distance = wide ? 190 : 95;
    const height = wide ? 140 : 70;

    const targetPos = new THREE.Vector3(focusX + distance, height, focusZ + distance);
    const targetLook = new THREE.Vector3(focusX, 4, focusZ);

    const t = 1 - Math.pow(0.0001, delta);
    pos.current.lerp(targetPos, t);
    look.current.lerp(targetLook, t);

    camera.position.copy(pos.current);
    camera.lookAt(look.current);
  });

  return null;
};
