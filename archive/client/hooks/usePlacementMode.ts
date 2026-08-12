import { useCallback, useMemo, useState } from 'react';
import {
  DEFAULT_TOWER_GRID_OFFSET,
  DEFAULT_TOWER_GRID_SIZE,
  MAX_STACK_PER_CELL,
  TowerPlacementSystem,
} from '../../shared/types/towerPlacement';
import { HOME_GRID_RADIUS } from '../../shared/constants/towers';
import type { PlayerGrid } from '../../shared/types/api';

/**
 * Placement mode: choosing where a just-finished tower goes on your home grid.
 *
 * Targeting is by tap. Reddit's inline posts permit tap and click as their *only* input -- no
 * drag, scroll or pinch, since those belong to the feed -- but a tap is exactly what's needed
 * here. The scene raycasts a single ground plane and converts the hit point to a cell, so
 * pointing at a cell costs one hit test rather than a mesh per cell.
 *
 * The interaction is tap-to-target then tap-again-to-confirm: the first tap moves the ghost so
 * the player can see the result before committing, and the second commits it. Tapping a
 * different cell retargets instead of confirming, so a mis-tap is never destructive.
 */

/** Camera distance multipliers, nearest to widest. */
const ZOOM_STEPS = [0.65, 0.85, 1.1, 1.45, 1.9] as const;
const DEFAULT_ZOOM_INDEX = 2;

/** Radians per rotate press. Eight presses completes a circle. */
const ROTATION_STEP = Math.PI / 4;

export interface PlacementTarget {
  gridX: number;
  gridZ: number;
  worldX: number;
  worldZ: number;
  /** How many towers already occupy the cell. */
  stackCount: number;
  /**
   * Combined height of what's already in the cell, in world units (already divided by the
   * fixed-point scale). This is where a new tower's base would land.
   */
  stackHeight: number;
  isEmpty: boolean;
  /** False once the cell has hit MAX_STACK_PER_CELL. */
  canPlace: boolean;
}

export interface PlacementModeHook {
  isActive: boolean;
  /** Null until the player has tapped a cell. */
  target: PlacementTarget | null;
  zoom: number;
  rotation: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  begin: (grid: PlayerGrid | null) => void;
  end: () => void;
  /** Target a cell. Returns false when the cell is off-grid. */
  selectCell: (gridX: number, gridZ: number) => boolean;
  /** True when this cell is the current target, i.e. a tap on it would commit. */
  isTargeted: (gridX: number, gridZ: number) => boolean;
  zoomIn: () => void;
  zoomOut: () => void;
  rotateLeft: () => void;
  rotateRight: () => void;
}

/** Cell centre in world space. Towers sit at cell centres, not intersections. */
export const gridToWorld = (grid: number): number =>
  DEFAULT_TOWER_GRID_OFFSET + grid * DEFAULT_TOWER_GRID_SIZE + DEFAULT_TOWER_GRID_SIZE / 2;

/**
 * World position to grid cell -- the inverse of gridToWorld.
 *
 * This is what turns a tap on the ground plane into a cell. Rounding rather than flooring
 * because cells are addressed by their centre: a hit anywhere in the cell's half-width should
 * resolve to that cell, including on the negative side of the origin where flooring would
 * bias one cell off.
 */
export const worldToGrid = (world: number): number =>
  // `+ 0` normalises -0, which Math.round yields for a hit just left of the origin. It compares
  // equal to 0 so nothing breaks, but it would leak into cell keys and request payloads as a
  // second spelling of the same cell. Cheaper to kill it here than to reason about downstream.
  Math.round(
    (world - DEFAULT_TOWER_GRID_OFFSET - DEFAULT_TOWER_GRID_SIZE / 2) / DEFAULT_TOWER_GRID_SIZE
  ) + 0;

/** Cells outside the circular home grid are not placeable. */
export const isWithinHomeGrid = (gridX: number, gridZ: number): boolean =>
  Math.hypot(gridX, gridZ) <= HOME_GRID_RADIUS;

export const usePlacementMode = (): PlacementModeHook => {
  const [isActive, setIsActive] = useState(false);
  const [cursor, setCursor] = useState<{ gridX: number; gridZ: number } | null>(null);
  const [zoomIndex, setZoomIndex] = useState<number>(DEFAULT_ZOOM_INDEX);
  const [rotation, setRotation] = useState(0);

  /**
   * Snapshot of what already occupies each cell, keyed "x,z".
   *
   * State rather than a ref because `target` is derived during render, and React cannot know a
   * ref changed -- the readout would go stale for the cell the player is pointing at.
   */
  const [cells, setCells] = useState<ReadonlyMap<string, { count: number; height: number }>>(
    new Map()
  );

  const begin = useCallback((grid: PlayerGrid | null) => {
    // Built through TowerPlacementSystem rather than by tallying placements directly, so the
    // stacking rules (ordering, per-cell cap) stay defined in exactly one place.
    const system = new TowerPlacementSystem(
      DEFAULT_TOWER_GRID_SIZE,
      DEFAULT_TOWER_GRID_OFFSET,
      DEFAULT_TOWER_GRID_OFFSET,
      HOME_GRID_RADIUS
    );

    if (grid?.placements?.length) {
      [...grid.placements]
        .sort((a, b) => a.stackIndex - b.stackIndex)
        .forEach((placement) => {
          system.stackTower(placement.gridX, placement.gridZ, placement.sessionId, placement.height);
        });
    }

    const snapshot = new Map<string, { count: number; height: number }>();
    for (const coord of system.getOccupiedCoordinates()) {
      snapshot.set(`${coord.x},${coord.z}`, {
        count: coord.stack.length,
        height: system.getStackHeight(coord.x, coord.z),
      });
    }

    setCells(snapshot);
    // Nothing targeted initially: the player picks where to look before anything commits.
    setCursor(null);
    setZoomIndex(DEFAULT_ZOOM_INDEX);
    setRotation(0);
    setIsActive(true);
  }, []);

  const end = useCallback(() => {
    setIsActive(false);
    setCursor(null);
  }, []);

  const selectCell = useCallback((gridX: number, gridZ: number): boolean => {
    if (!isWithinHomeGrid(gridX, gridZ)) {
      return false;
    }
    setCursor({ gridX, gridZ });
    return true;
  }, []);

  const isTargeted = useCallback(
    (gridX: number, gridZ: number): boolean =>
      cursor !== null && cursor.gridX === gridX && cursor.gridZ === gridZ,
    [cursor]
  );

  const zoomIn = useCallback(() => setZoomIndex((i) => Math.max(0, i - 1)), []);
  const zoomOut = useCallback(
    () => setZoomIndex((i) => Math.min(ZOOM_STEPS.length - 1, i + 1)),
    []
  );
  const rotateLeft = useCallback(() => setRotation((r) => r - ROTATION_STEP), []);
  const rotateRight = useCallback(() => setRotation((r) => r + ROTATION_STEP), []);

  const target = useMemo<PlacementTarget | null>(() => {
    if (!cursor) return null;
    const { gridX, gridZ } = cursor;
    const cell = cells.get(`${gridX},${gridZ}`);
    const stackCount = cell?.count ?? 0;
    return {
      gridX,
      gridZ,
      worldX: gridToWorld(gridX),
      worldZ: gridToWorld(gridZ),
      stackCount,
      // Stored heights are fixed-point like the block coordinates; the scene works in world
      // units, so convert once here rather than at every consumer.
      stackHeight: (cell?.height ?? 0) / 1000,
      isEmpty: stackCount === 0,
      canPlace: stackCount < MAX_STACK_PER_CELL,
    };
  }, [cursor, cells]);

  return {
    isActive,
    target,
    zoom: ZOOM_STEPS[zoomIndex] ?? 1,
    rotation,
    canZoomIn: zoomIndex > 0,
    canZoomOut: zoomIndex < ZOOM_STEPS.length - 1,
    begin,
    end,
    selectCell,
    isTargeted,
    zoomIn,
    zoomOut,
    rotateLeft,
    rotateRight,
  };
};
