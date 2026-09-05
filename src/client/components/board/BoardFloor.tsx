import React from 'react';
import { Grid } from '@react-three/drei';
import { DEFAULT_TOWER_GRID_SIZE } from '../../../shared/types/towerPlacement';
import { REGION_PITCH, REGION_RADIUS } from '../../../shared/types/worldGrid';

interface BoardFloorProps {
  /** Tint, mixed from the community's colour balance. */
  color: string;
  /** Distance at which the floor has faded to nothing. Tied to the camera so it never haloes. */
  fadeDistance: number;
  /**
   * World point the grid lines pass through. Defaults to a plot edge, which is where the
   * board's cells fall; the game centres its tower on the origin, so it passes half a cell.
   */
  originX?: number | undefined;
  originZ?: number | undefined;
}

/**
 * The floor grid.
 *
 * Dim on purpose. The floor used to be drawn at full neon and 80% opacity, and at a low camera
 * angle the lines near the horizon merged into a white haze that bloom then lit up -- the whole
 * lower half of the frame was an overexposed sheet, and towers standing on it lost their
 * silhouettes. The rims are the bright thing on this board; the floor is where they stand.
 *
 * Sections are one plot pitch apart and offset to the plot edge, so the heavier lines mark where
 * one player's ground ends and the next begins without drawing a tray under anybody.
 */
export const BoardFloor: React.FC<BoardFloorProps> = ({
  color,
  fadeDistance,
  originX,
  originZ,
}) => {
  // The plot's centre cell spans [0, cell) so its edge sits `radius` cells below the origin.
  const edge = -REGION_RADIUS * DEFAULT_TOWER_GRID_SIZE;
  return (
    <Grid
      position={[originX ?? edge, -0.5, originZ ?? edge]}
      args={[10, 10]}
      cellSize={DEFAULT_TOWER_GRID_SIZE}
      cellThickness={0.55}
      cellColor={color}
      sectionSize={REGION_PITCH * DEFAULT_TOWER_GRID_SIZE}
      sectionThickness={1}
      sectionColor={color}
      fadeDistance={fadeDistance}
      fadeStrength={1.4}
      followCamera={false}
      infiniteGrid
      material-depthWrite={false}
      material-transparent
      material-opacity={0.32}
      renderOrder={-100}
    />
  );
};
