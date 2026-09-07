import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { TowerMapEntry } from '../../../shared/types/api';
import { DEFAULT_TOWER_GRID_SIZE } from '../../../shared/types/towerPlacement';
import { towerBox } from './boardInstancing';

interface SelectionHaloProps {
  tower: TowerMapEntry;
  color: string;
}

/**
 * Marks the selected tower: a breathing translucent shell around it and a square on the floor
 * at its cell. The shell is drawn back-face only so it never covers the tower's own rims.
 */
export const SelectionHalo: React.FC<SelectionHaloProps> = ({ tower, color }) => {
  const shell = useRef<THREE.MeshBasicMaterial>(null);
  const ring = useRef<THREE.LineBasicMaterial>(null);
  const pulse = useRef(0);

  const frame = useMemo(() => {
    const box = towerBox(tower.towerBlocks);
    const baseY = (tower.stackBaseY ?? 0) / 1000;
    const x = tower.worldX ?? 0;
    const z = tower.worldZ ?? 0;
    if (!box) return { x, z, y: baseY + 0.75, w: 4, h: 1.5, d: 4, baseY };
    return {
      x: x + (box.minX + box.maxX) / 2,
      z: z + (box.minZ + box.maxZ) / 2,
      y: baseY + (box.minY + box.maxY) / 2,
      w: box.maxX - box.minX,
      h: box.maxY - box.minY,
      d: box.maxZ - box.minZ,
      baseY,
    };
  }, [tower]);

  const square = useMemo(() => {
    const half = DEFAULT_TOWER_GRID_SIZE / 2 - 0.1;
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
  React.useEffect(() => () => square.dispose(), [square]);

  useFrame((_, delta) => {
    pulse.current += delta * 2.4;
    const wave = (Math.sin(pulse.current) + 1) / 2;
    if (shell.current) shell.current.opacity = 0.06 + wave * 0.06;
    if (ring.current) ring.current.opacity = 0.7 + wave * 0.3;
  });

  return (
    <group>
      <mesh
        position={[frame.x, frame.y, frame.z]}
        scale={[frame.w + 0.6, frame.h + 0.4, frame.d + 0.6]}
        raycast={() => null}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial
          ref={shell}
          color={color}
          transparent
          opacity={0.08}
          depthWrite={false}
          side={THREE.BackSide}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
      <lineLoop
        position={[tower.worldX ?? 0, frame.baseY + 0.02 - 0.5 + 0.06, tower.worldZ ?? 0]}
        geometry={square}
        raycast={() => null}
      >
        <lineBasicMaterial ref={ring} color={color} transparent opacity={0.9} toneMapped={false} />
      </lineLoop>
    </group>
  );
};
