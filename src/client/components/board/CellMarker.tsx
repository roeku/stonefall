import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { DEFAULT_TOWER_GRID_SIZE } from '../../../shared/types/towerPlacement';

interface CellMarkerProps {
  worldX: number;
  worldZ: number;
  color: string;
  /**
   * How far up the marker's column reaches. Set to clear the tallest tower on the plot.
   *
   * A square drawn on the floor is invisible the moment there is anything standing nearby, and
   * a plot is exactly the place where there is. The tower in hand can be two blocks tall next to
   * twelve towers that are two hundred, so the aim point needs to be readable in the skyline,
   * not just on the ground.
   */
  beamHeight?: number | undefined;
}

/**
 * The cell being aimed at, drawn as a square on the floor exactly the size of the cell.
 *
 * It was a four-sided ring, which is a diamond -- it met the cell's corners and cut across its
 * edges, so the marker disagreed with the grid it sat on about where the cell was.
 */
export const CellMarker: React.FC<CellMarkerProps> = ({
  worldX,
  worldZ,
  color,
  beamHeight = 0,
}) => {
  const fill = useRef<THREE.MeshBasicMaterial>(null);
  const edge = useRef<THREE.LineBasicMaterial>(null);
  const beam = useRef<THREE.MeshBasicMaterial>(null);
  const pulse = useRef(0);
  const group = useRef<THREE.Group>(null);

  const outline = useMemo(() => {
    const half = DEFAULT_TOWER_GRID_SIZE / 2 - 0.08;
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [-half, 0, -half, half, 0, -half, half, 0, half, -half, 0, half],
        3
      )
    );
    return g;
  }, []);
  React.useEffect(() => () => outline.dispose(), [outline]);

  useFrame((_, delta) => {
    pulse.current += delta * 3;
    const wave = (Math.sin(pulse.current) + 1) / 2;
    if (fill.current) fill.current.opacity = 0.1 + wave * 0.1;
    if (edge.current) edge.current.opacity = 0.75 + wave * 0.25;
    // The column breathes out of phase with the floor square, so the two read as one marker
    // rather than as two things blinking together.
    if (beam.current) beam.current.opacity = 0.16 + (1 - wave) * 0.12;
    // Slide rather than jump between cells, so the direction of a move is legible.
    const g = group.current;
    if (g) {
      const t = 1 - Math.pow(0.0005, delta);
      g.position.x += (worldX - g.position.x) * t;
      g.position.z += (worldZ - g.position.z) * t;
    }
  });

  return (
    <group ref={group} position={[worldX, -0.42, worldZ]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
        <planeGeometry args={[DEFAULT_TOWER_GRID_SIZE - 0.16, DEFAULT_TOWER_GRID_SIZE - 0.16]} />
        <meshBasicMaterial
          ref={fill}
          color={color}
          transparent
          opacity={0.12}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
      <lineLoop geometry={outline} position={[0, 0.02, 0]} raycast={() => null}>
        <lineBasicMaterial ref={edge} color={color} transparent opacity={0.9} toneMapped={false} />
      </lineLoop>

      {/* A column of light standing in the cell, tall enough to be seen over the plot. Open at
          the top and additively blended, so it never hides what it is pointing at. */}
      {beamHeight > 1 && (
        <mesh position={[0, beamHeight / 2, 0]} raycast={() => null}>
          <cylinderGeometry
            args={[
              DEFAULT_TOWER_GRID_SIZE * 0.38,
              DEFAULT_TOWER_GRID_SIZE * 0.46,
              beamHeight,
              20,
              1,
              true,
            ]}
          />
          <meshBasicMaterial
            ref={beam}
            color={color}
            transparent
            opacity={0.2}
            depthWrite={false}
            side={THREE.DoubleSide}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </mesh>
      )}
    </group>
  );
};
