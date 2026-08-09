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
 * Every interaction here is a discrete button press. Reddit's inline posts allow **tap input
 * only** -- no drag, scroll, pinch or pan, since those belong to the feed -- so there is no
 * gesture fallback to lean on. A cell cursor moved by a D-pad is precise at any screen size and
 * never competes with the feed for a gesture.
 */

/** Camera distance multipliers, nearest to widest. */
const ZOOM_STEPS = [0.6, 0.85, 1.15, 1.6, 2.2] as const;
const DEFAULT_ZOOM_INDEX = 2;

/** Radians per rotate press. Eight presses completes a circle. */
const ROTATION_STEP = Math.PI / 4;

export type PlacementDirection = 'up' | 'down' | 'left' | 'right';

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
  target: PlacementTarget;
  zoom: number;
  rotation: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  begin: (grid: PlayerGrid | null) => void;
  end: () => void;
  move: (direction: PlacementDirection) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  rotateLeft: () => void;
  rotateRight: () => void;
}

const gridToWorld = (grid: number): number =>
  DEFAULT_TOWER_GRID_OFFSET + grid * DEFAULT_TOWER_GRID_SIZE + DEFAULT_TOWER_GRID_SIZE / 2;

/** The four grid steps a D-pad press can resolve to. */
const GRID_STEPS: ReadonlyArray<{ dx: number; dz: number }> = [
  { dx: 1, dz: 0 },
  { dx: -1, dz: 0 },
  { dx: 0, dz: 1 },
  { dx: 0, dz: -1 },
];

/**
 * Resolve a screen-relative direction into a grid step, given the current camera angle.
 *
 * Without this the D-pad inverts as soon as the view rotates -- pressing "up" would walk the
 * cursor toward the camera on the far side of the grid. The camera orbits at
 * (cos(rotation), sin(rotation)) from the focus point, so "away from the viewer" is the negation
 * of that, and "right" is its perpendicular. The desired vector is then snapped to whichever of
 * the four grid steps points most nearly the same way.
 */
export const resolveGridStep = (
  direction: PlacementDirection,
  rotation: number
): { dx: number; dz: number } => {
  const awayX = -Math.cos(rotation);
  const awayZ = -Math.sin(rotation);
  // Perpendicular, rotated +90 degrees in the XZ plane.
  const rightX = -awayZ;
  const rightZ = awayX;

  let wantX: number;
  let wantZ: number;
  switch (direction) {
    case 'up':
      wantX = awayX;
      wantZ = awayZ;
      break;
    case 'down':
      wantX = -awayX;
      wantZ = -awayZ;
      break;
    case 'right':
      wantX = rightX;
      wantZ = rightZ;
      break;
    case 'left':
      wantX = -rightX;
      wantZ = -rightZ;
      break;
  }

  let best = GRID_STEPS[0]!;
  let bestDot = -Infinity;
  for (const step of GRID_STEPS) {
    const dot = step.dx * wantX + step.dz * wantZ;
    if (dot > bestDot) {
      bestDot = dot;
      best = step;
    }
  }
  return best;
};

/** Cells outside the circular home grid are not placeable. */
const isWithinGrid = (gridX: number, gridZ: number): boolean =>
  Math.hypot(gridX, gridZ) <= HOME_GRID_RADIUS;

export const usePlacementMode = (): PlacementModeHook => {
  const [isActive, setIsActive] = useState(false);
  const [cursor, setCursor] = useState({ gridX: 0, gridZ: 0 });
  const [zoomIndex, setZoomIndex] = useState<number>(DEFAULT_ZOOM_INDEX);
  const [rotation, setRotation] = useState(0);

  /**
   * Snapshot of what already occupies each cell, keyed "x,z".
   *
   * Held in state rather than behind a ref: `target` is derived during render, and reading a
   * ref there is unsound -- React has no way to know the value changed, so the cursor readout
   * could show stale contents for the cell it's standing on.
   *
   * It's a snapshot because placement mode is short-lived and the grid can't change underneath
   * it; the authoritative state is refetched after every confirmed placement anyway.
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
      // Replay placements in stack order so each lands at the right height.
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
    setCursor({ gridX: 0, gridZ: 0 });
    setZoomIndex(DEFAULT_ZOOM_INDEX);
    setRotation(0);
    setIsActive(true);
  }, []);

  const end = useCallback(() => {
    setIsActive(false);
  }, []);

  const move = useCallback(
    (direction: PlacementDirection) => {
      setCursor((current) => {
        const step = resolveGridStep(direction, rotation);
        const nextX = current.gridX + step.dx;
        const nextZ = current.gridZ + step.dz;
        // Stop at the edge rather than wrapping: wrapping across a circular grid is
        // disorienting when you can't see the whole board.
        if (!isWithinGrid(nextX, nextZ)) {
          return current;
        }
        return { gridX: nextX, gridZ: nextZ };
      });
    },
    [rotation]
  );

  const zoomIn = useCallback(() => setZoomIndex((i) => Math.max(0, i - 1)), []);
  const zoomOut = useCallback(
    () => setZoomIndex((i) => Math.min(ZOOM_STEPS.length - 1, i + 1)),
    []
  );
  const rotateLeft = useCallback(() => setRotation((r) => r - ROTATION_STEP), []);
  const rotateRight = useCallback(() => setRotation((r) => r + ROTATION_STEP), []);

  const target = useMemo<PlacementTarget>(() => {
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
    move,
    zoomIn,
    zoomOut,
    rotateLeft,
    rotateRight,
  };
};
