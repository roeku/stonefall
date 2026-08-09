import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { DEFAULT_TOWER_GRID_SIZE } from '../../../shared/types/towerPlacement';

interface PlacementCursorProps {
  worldX: number;
  worldZ: number;
  /** Height of what's already stacked here, in world units. The marker rides on top of it. */
  stackHeight: number;
  /** False when the cell has hit its stack cap. */
  canPlace: boolean;
}

const VALID_COLOR = '#4ade80';
const BLOCKED_COLOR = '#f87171';

/**
 * Highlights the cell a tower is about to be placed in.
 *
 * Movement is eased rather than snapped: on a small inline canvas a cursor that teleports
 * between cells is genuinely hard to follow, whereas a short glide makes the direction of travel
 * obvious. It also gives the D-pad a sense of momentum that discrete taps otherwise lack.
 */
export const PlacementCursor: React.FC<PlacementCursorProps> = ({
  worldX,
  worldZ,
  stackHeight,
  canPlace,
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const pulseRef = useRef(0);

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;

    // Ease toward the target cell. Frame-rate independent, so it behaves the same whether the
    // device is running at 60fps or struggling at 30.
    const lerpFactor = 1 - Math.pow(0.001, delta);
    group.position.x += (worldX - group.position.x) * lerpFactor;
    group.position.z += (worldZ - group.position.z) * lerpFactor;
    group.position.y += (stackHeight - group.position.y) * lerpFactor;

    // Slow pulse so the marker stays findable against a busy grid.
    pulseRef.current += delta * 2.4;
    const scale = 1 + Math.sin(pulseRef.current) * 0.06;
    group.scale.set(scale, 1, scale);
  });

  const color = canPlace ? VALID_COLOR : BLOCKED_COLOR;
  const half = DEFAULT_TOWER_GRID_SIZE / 2;

  return (
    <group ref={groupRef} position={[worldX, stackHeight, worldZ]}>
      {/* Footprint outline sitting just above the surface to avoid z-fighting with the grid. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]}>
        <ringGeometry args={[half * 0.82, half * 0.96, 4]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.85}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* Soft fill, so the target reads as a cell rather than just an outline. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
        <planeGeometry args={[DEFAULT_TOWER_GRID_SIZE * 0.9, DEFAULT_TOWER_GRID_SIZE * 0.9]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.14}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* Vertical beam: on a rotated or zoomed-out view the ground marker alone is easy to lose. */}
      <mesh position={[0, 6, 0]}>
        <cylinderGeometry args={[0.22, 0.22, 12, 6]} />
        <meshBasicMaterial color={color} transparent opacity={0.32} depthWrite={false} />
      </mesh>
    </group>
  );
};
