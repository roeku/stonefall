import { describe, expect, it } from 'vitest';
import { gridToWorld, isWithinHomeGrid, worldToGrid } from './usePlacementMode';
import { DEFAULT_TOWER_GRID_SIZE } from '../../shared/types/towerPlacement';
import { HOME_GRID_RADIUS } from '../../shared/constants/towers';

/**
 * Tapping a cell works by raycasting a ground plane and converting the hit point to grid
 * coordinates. If that conversion is off by one anywhere, taps land on a neighbouring cell --
 * which looks like the game ignoring you rather than an outright bug, so it's pinned here.
 *
 * The negative side of the origin is the interesting part: cells are addressed by their centre,
 * so flooring instead of rounding biases one cell off for negative coordinates.
 */
describe('grid <-> world conversion', () => {
  it('round-trips every cell across the home grid, including negatives', () => {
    for (let cell = -HOME_GRID_RADIUS; cell <= HOME_GRID_RADIUS; cell++) {
      expect(worldToGrid(gridToWorld(cell))).toBe(cell);
    }
  });

  it('resolves a hit anywhere inside a cell to that cell', () => {
    const nearEdge = DEFAULT_TOWER_GRID_SIZE / 2 - 0.01;
    for (const cell of [-3, -1, 0, 1, 4]) {
      const centre = gridToWorld(cell);
      expect(worldToGrid(centre)).toBe(cell);
      expect(worldToGrid(centre - nearEdge)).toBe(cell);
      expect(worldToGrid(centre + nearEdge)).toBe(cell);
    }
  });

  it('crosses to the next cell past the boundary', () => {
    const centre = gridToWorld(0);
    const justPast = DEFAULT_TOWER_GRID_SIZE / 2 + 0.01;
    expect(worldToGrid(centre + justPast)).toBe(1);
    expect(worldToGrid(centre - justPast)).toBe(-1);
  });

  it('places cell centres one grid step apart', () => {
    expect(gridToWorld(1) - gridToWorld(0)).toBe(DEFAULT_TOWER_GRID_SIZE);
    expect(gridToWorld(0) - gridToWorld(-1)).toBe(DEFAULT_TOWER_GRID_SIZE);
  });
});

describe('isWithinHomeGrid', () => {
  it('accepts the centre and rejects far cells', () => {
    expect(isWithinHomeGrid(0, 0)).toBe(true);
    expect(isWithinHomeGrid(HOME_GRID_RADIUS + 1, 0)).toBe(false);
    expect(isWithinHomeGrid(0, -(HOME_GRID_RADIUS + 1))).toBe(false);
  });

  it('is circular, not square -- the far corner is outside', () => {
    // A square grid would accept this; the renderer only draws the circle, so it must not.
    expect(isWithinHomeGrid(HOME_GRID_RADIUS, HOME_GRID_RADIUS)).toBe(false);
    expect(isWithinHomeGrid(HOME_GRID_RADIUS, 0)).toBe(true);
  });

  it('treats the boundary itself as inside', () => {
    expect(isWithinHomeGrid(0, HOME_GRID_RADIUS)).toBe(true);
    expect(isWithinHomeGrid(-HOME_GRID_RADIUS, 0)).toBe(true);
  });
});
