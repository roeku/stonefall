import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { DEFAULT_TOWER_GRID_SIZE } from '../../../shared/types/towerPlacement';

interface CellMarkerProps {
  worldX: number;
  worldZ: number;
  color: string;
}

/**
 * The cell being aimed at, drawn as a square on the floor exactly the size of the cell.
 *
 * It was a four-sided ring, which is a diamond -- it met the cell's corners and cut across its
 * edges, so the marker disagreed with the grid it sat on about where the cell was.
 */
export const CellMarker: React.FC<CellMarkerProps> = ({ worldX, worldZ, color }) => {
  const fill = useRef<THREE.MeshBasicMaterial>(null);
  const edge = useRef<THREE.LineBasicMaterial>(null);
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
    </group>
  );
};
