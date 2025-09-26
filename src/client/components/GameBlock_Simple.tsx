import React, { useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { Block } from '../../shared/simulation';

interface GameBlockProps {
  block: Block;
  isActive: boolean;
  convertPosition: (fixedValue: number) => number;
  visualOffset?: number;
  highlight?: 'perfect' | 'cut' | null;
  spawnFrom?: { x: number; y: number; z: number } | undefined;
}

export const GameBlock: React.FC<GameBlockProps> = ({ block, isActive, convertPosition, visualOffset = 0, highlight = null, spawnFrom }) => {
  // Convert block properties to Three.js units
  const offset = visualOffset || 0;
  const targetPosition = {
    x: convertPosition(block.x),
    y: convertPosition(block.y + block.height / 2) + offset, // Center the block on its position
    z: convertPosition(block.z ?? 0),
  };

  // Keep depth stable and based on block height (not width) so trimmed widths
  // don't visually squash the block on the Z axis. Use a constant multiplier
  // so blocks remain visually consistent regardless of width trimming.
  const depth = Math.max(0.4, convertPosition(block.depth ?? block.width));
  const size: [number, number, number] = [
    convertPosition(block.width),
    convertPosition(block.height),
    depth,
  ];

  // Convert fixed-point rotation (millidegrees) to radians
  const rotationY = (block.rotation / 1000) * (Math.PI / 180); // millidegrees to radians

  // Refs for smooth interpolation and bounce on placement
  const groupRef = useRef<any>(null);
  const prevFallingRef = useRef<boolean | undefined>(undefined);
  const bounceRef = useRef({ time: 0, intensity: 0 });

  // Initialize position from spawn point (if provided) so newly-placed blocks
  // visually originate from the moving block and animate into their final spot.
  React.useEffect(() => {
    const g = groupRef.current;
    if (!g) return;
    if (spawnFrom) {
  // spawnFrom is expected to already be in world units. Apply vertical
  // visual offset so spawn animation aligns with the final visual placement.
  g.position.x = spawnFrom.x;
  g.position.y = spawnFrom.y + offset;
  g.position.z = spawnFrom.z;
    } else {
      // If no spawnFrom provided and this is an active block, position it at the target immediately
      if (isActive) {
        g.position.x = targetPosition.x;
        g.position.y = targetPosition.y;
        g.position.z = targetPosition.z;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spawnFrom]);

  // Detect transition from falling -> placed to trigger bounce
  useEffect(() => {
    if (prevFallingRef.current === undefined) {
      prevFallingRef.current = !!block.isFalling;
      return;
    }
    if (prevFallingRef.current && !block.isFalling) {
      bounceRef.current.time = 0;
      bounceRef.current.intensity = 0.12; // small placement bounce
    }
    prevFallingRef.current = !!block.isFalling;
  }, [block.isFalling]);

  // Smoothly interpolate position and rotation each frame
  useFrame((_, delta) => {
    const g = groupRef.current;
    if (!g) return;

    // Lerp speed: much faster when falling for snappy drops; faster when placed
    const speed = block.isFalling ? 0.9 : 0.45;

    // Interpolate position
    g.position.x += (targetPosition.x - g.position.x) * speed;
    g.position.y += (targetPosition.y - g.position.y) * speed;
    g.position.z += (targetPosition.z - g.position.z) * speed;

    // Interpolate rotation Y smoothly
    const rotTarget = rotationY;
    g.rotation.y += (rotTarget - g.rotation.y) * Math.min(0.9, speed * 1.2);

    // Apply placement bounce if active
    if (bounceRef.current.intensity > 0) {
      bounceRef.current.time += delta * 3.5; // speed up the bounce timeline
      const t = bounceRef.current.time;
      const intensity = bounceRef.current.intensity * Math.max(0, 1 - t);
      // simple ease-out sine bounce
      const offset = Math.sin(Math.min(1, t) * Math.PI) * intensity * 0.6;
      g.position.y += offset;
      if (t >= 1) {
        bounceRef.current.intensity = 0;
        bounceRef.current.time = 0;
      }
    }
  });

  return (
    <group ref={groupRef} rotation={[0, rotationY, 0]}>
      <mesh castShadow={true} receiveShadow={true}>
        <boxGeometry args={size} />
        <meshPhysicalMaterial
          color={isActive ? '#dff7f3' : '#E5DDD5'}
          roughness={isActive ? 0.38 : 0.6}
          metalness={0.03}
          clearcoat={0.08}
          clearcoatRoughness={0.28}
          envMapIntensity={0.6}
        />
      </mesh>

      {isActive && (
        <mesh scale={1.02} renderOrder={999} castShadow={false} receiveShadow={false}>
          <boxGeometry args={size} />
          <meshBasicMaterial color="#00aacc" toneMapped={false} transparent opacity={0.15} side={2} />
        </mesh>
      )}

      {highlight === 'perfect' && (
        <mesh scale={1.04} renderOrder={1000} castShadow={false} receiveShadow={false}>
          <boxGeometry args={size} />
          <meshBasicMaterial color="#66ffff" toneMapped={false} transparent opacity={0.25} />
        </mesh>
      )}
    </group>
  );
};
