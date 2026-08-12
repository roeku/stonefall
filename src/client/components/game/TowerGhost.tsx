import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { TowerBlock } from '../../../shared/types/api';

interface TowerGhostProps {
  blocks: readonly TowerBlock[];
  worldX: number;
  worldZ: number;
  /** Base height to sit on, in world units. Non-zero when stacking onto existing towers. */
  baseY: number;
  /** Red when the target cell can't take it. */
  canPlace: boolean;
}

const VALID_COLOR = '#4ade80';
const BLOCKED_COLOR = '#f87171';

/**
 * Translucent preview of the tower about to be placed.
 *
 * Without this the player is aiming an empty marker and can't judge anything that matters --
 * how tall the tower is, whether it clears its neighbours, what the stack will look like. The
 * ghost is the actual geometry, not a placeholder box, so the preview matches the result.
 *
 * Rendered as individual meshes rather than instanced: a single tower is tens of blocks, and
 * this exists only while placing, so the instancing machinery would cost more than it saves.
 */
export const TowerGhost: React.FC<TowerGhostProps> = ({
  blocks,
  worldX,
  worldZ,
  baseY,
  canPlace,
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const pulseRef = useRef(0);

  // Block coordinates are fixed-point at scale 1000, the same convention the tower renderer
  // uses. Converted once here rather than per frame.
  const geometry = useMemo(
    () =>
      blocks
        .filter((b) => b && Number.isFinite(b.x) && Number.isFinite(b.y))
        .map((b, index) => ({
          key: `${index}`,
          x: (b.x ?? 0) / 1000,
          y: (b.y ?? 0) / 1000,
          z: (b.z ?? 0) / 1000,
          width: (b.width ?? 0) / 1000,
          height: (b.height ?? 0) / 1000,
          depth: ((b.depth ?? b.width) ?? 0) / 1000,
          rotation: ((b.rotation ?? 0) / 1000) * (Math.PI / 180),
        }))
        .filter((b) => b.width > 0 && b.height > 0 && b.depth > 0),
    [blocks]
  );

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;

    // Ease to the target cell so the direction of a move is legible, rather than teleporting.
    // Frame-rate independent, so it behaves the same at 30fps as at 60.
    const lerpFactor = 1 - Math.pow(0.0005, delta);
    group.position.x += (worldX - group.position.x) * lerpFactor;
    group.position.z += (worldZ - group.position.z) * lerpFactor;
    group.position.y += (baseY - group.position.y) * lerpFactor;

    // Gentle breathing so the ghost reads as provisional rather than already placed.
    pulseRef.current += delta * 2;
    const material = group.userData.material as THREE.MeshBasicMaterial | undefined;
    if (material) {
      material.opacity = 0.3 + Math.sin(pulseRef.current) * 0.08;
    }
  });

  const color = canPlace ? VALID_COLOR : BLOCKED_COLOR;

  const material = useMemo(() => {
    const m = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
    });
    return m;
  }, [color]);

  return (
    <group
      ref={groupRef}
      position={[worldX, baseY, worldZ]}
      userData={{ material }}
    >
      {geometry.map((b) => (
        <mesh
          key={b.key}
          position={[b.x, b.y + b.height / 2, b.z]}
          rotation={[0, b.rotation, 0]}
          material={material}
        >
          <boxGeometry args={[b.width, b.height, b.depth]} />
        </mesh>
      ))}

      {/* Outline of the footprint, so the ghost still reads when the tower is only a block or
          two tall and the translucent fill is easy to miss. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.08, 0]}>
        <ringGeometry args={[2.6, 3.4, 4]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.9}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
};
