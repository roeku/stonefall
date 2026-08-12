import React from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { PlayerRegion, TowerMapEntry } from '../../../shared/types/api';
import { cellToWorld, isCellInRegion, worldToCell } from '../../../shared/types/worldGrid';
import { DEFAULT_TOWER_GRID_SIZE, MAX_STACK_PER_CELL } from '../../../shared/types/towerPlacement';
import { GPUInstancedTowerSystem } from '../game/GPUInstancedTowerSystem';
import { TowerGhost } from '../game/TowerGhost';
import { TronBackground } from '../effects/TronBackground';

interface GridScreenProps {
  towers: TowerMapEntry[];
  isLoading: boolean;
  /** Set when a finished tower is waiting to be placed; drives placement mode. */
  pendingTower: TowerMapEntry | null;
  /** The player's buildable area. Null until they have one. */
  region: PlayerRegion | null;
  isPlacing: boolean;
  error: string | null;
  onPlace: (gridX: number, gridZ: number) => void;
  onSkipPlacement: () => void;
  onPlay: () => void;
}

const stubGameState = { isGameOver: true } as const;

/**
 * The grid. The only screen outside of an actual run.
 *
 * Browsing and placing are the same screen in the same coordinate space, differing only by
 * whether a tower is waiting to be put down. They were three separate screens once, each with
 * its own Canvas and camera, which is why the app felt like several apps stitched together.
 *
 * All input is tap. Reddit inline posts permit tap and click only -- drag, scroll and pinch
 * belong to the feed and an app must not take them.
 */
export const GridScreen: React.FC<GridScreenProps> = ({
  towers,
  isLoading,
  pendingTower,
  region,
  isPlacing,
  error,
  onPlace,
  onSkipPlacement,
  onPlay,
}) => {
  const [target, setTarget] = React.useState<{ x: number; z: number } | null>(null);
  const isPlacementMode = pendingTower !== null && region !== null;

  React.useEffect(() => {
    if (!isPlacementMode) setTarget(null);
  }, [isPlacementMode]);

  /** Cells already used, so the readout can say what a tap would stack onto. */
  const occupied = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const t of towers) {
      if (t.gridX === undefined || t.gridZ === undefined) continue;
      const key = `${t.gridX},${t.gridZ}`;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [towers]);

  const targetStack = target ? (occupied.get(`${target.x},${target.z}`) ?? 0) : 0;
  const canPlace = targetStack < MAX_STACK_PER_CELL;

  const handleTap = (event: { point: THREE.Vector3; stopPropagation: () => void }) => {
    if (!isPlacementMode || isPlacing || !region) return;
    event.stopPropagation();

    const x = worldToCell(event.point.x);
    const z = worldToCell(event.point.z);

    // Taps outside the player's own area are ignored rather than erroring, since most of the
    // grid belongs to other people and stray taps are expected.
    if (!isCellInRegion({ rx: 0, rz: 0 }, x - region.centerX, z - region.centerZ)) return;

    // First tap targets so the ghost shows the result; a second tap on the same cell commits.
    if (target && target.x === x && target.z === z) {
      if (canPlace) onPlace(x, z);
      return;
    }
    setTarget({ x, z });
  };

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
    <div style={{ position: 'absolute', inset: 0, background: '#000814' }}>
      <Canvas
        dpr={[0.6, 1.1]}
        camera={{ position: [70, 55, 70], fov: 30, near: 1, far: 3000 }}
        gl={{ antialias: false, alpha: false, powerPreference: 'high-performance' }}
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

        {/* One ground plane, raycast and converted to a cell -- rather than a hitbox per cell. */}
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
          focusX={
            target ? cellToWorld(target.x) : region ? cellToWorld(region.centerX) : 0
          }
          focusZ={
            target ? cellToWorld(target.z) : region ? cellToWorld(region.centerZ) : 0
          }
          wide={!isPlacementMode}
        />
      </Canvas>

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
