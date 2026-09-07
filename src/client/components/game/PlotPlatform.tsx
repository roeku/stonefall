import React from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { DEFAULT_TOWER_GRID_SIZE } from '../../../shared/types/towerPlacement';
import { REGION_SPAN, cellToWorld } from '../../../shared/types/worldGrid';

interface PlotOutlineProps {
  /** Centre of the plot, in global cell coordinates. */
  centerX: number;
  centerZ: number;
  /** Cells from centre to edge. */
  radius: number;
  color: string;
  /** Brighter and breathing while a tower is in hand. */
  active?: boolean;
}

/**
 * The player's plot, drawn as an outline on the floor and nothing else.
 *
 * It was a raised slab with a tinted top and its own cell lines. That was wrong twice over: the
 * fill was the brightest thing on screen and drowned the towers standing on it, and a plate under
 * every plot turned the community view into a field of trays. It also introduced a second grid --
 * the plate had cell divisions of its own, drawn over the floor's -- so there were two grids
 * disagreeing about where a cell was.
 *
 * One grid, one set of lines. The plot is just a boundary drawn on it, and because a plot is a
 * whole number of cells across, that boundary lands exactly on floor grid lines.
 */
export const PlotPlatform: React.FC<PlotOutlineProps> = ({
  centerX,
  centerZ,
  radius,
  color,
  active = false,
}) => {
  const worldX = cellToWorld(centerX);
  const worldZ = cellToWorld(centerZ);
  // `cellToWorld` returns a cell's centre, so the boundary sits half a cell beyond the edge
  // cells. That puts it on a grid line rather than through the middle of one.
  const half = (radius * 2 + 1) * (DEFAULT_TOWER_GRID_SIZE / 2);

  const rimRef = React.useRef<THREE.LineBasicMaterial>(null);
  const pulse = React.useRef(0);

  useFrame((_, delta) => {
    pulse.current += delta * 2.2;
    // Only the active state breathes. A resting boundary that pulses reads as something demanding
    // attention, and most of the time it is only there to say where your area ends.
    const wave = active ? Math.sin(pulse.current) : 0;
    if (rimRef.current) rimRef.current.opacity = (active ? 0.9 : 0.4) + wave * 0.12;
  });

  const rim = React.useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [-half, 0, -half, half, 0, -half, half, 0, half, -half, 0, half],
        3
      )
    );
    return g;
  }, [half]);

  React.useEffect(() => () => rim.dispose(), [rim]);

  return (
    // Just above the floor grid, which sits at y = -0.5. Coplanar with it the two z-fight, and
    // the flicker is far more distracting than the boundary is useful.
    <lineLoop position={[worldX, -0.44, worldZ]} geometry={rim}>
      <lineBasicMaterial ref={rimRef} color={color} transparent opacity={0.4} toneMapped={false} />
    </lineLoop>
  );
};

/** Width of one plot in world units, for callers sizing a camera to it. */
export const PLOT_SPAN = REGION_SPAN * DEFAULT_TOWER_GRID_SIZE;
