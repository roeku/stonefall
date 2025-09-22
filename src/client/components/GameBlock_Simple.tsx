import React from 'react';
import { Block } from '../../shared/simulation';

interface GameBlockProps {
  block: Block;
  isActive: boolean;
  convertPosition: (fixedValue: number) => number;
  highlight?: 'perfect' | 'cut' | null;
}

export const GameBlock: React.FC<GameBlockProps> = ({ block, isActive, convertPosition, highlight = null }) => {
  // Convert block properties to Three.js units
  const position: [number, number, number] = [
    convertPosition(block.x),
    convertPosition(block.y + block.height / 2), // Center the block on its position
    0,
  ];

  const size: [number, number, number] = [
    convertPosition(block.width),
    convertPosition(block.height),
    convertPosition(block.width * 0.6), // Depth is smaller for rectangular appearance
  ];

  // Convert fixed-point rotation (millidegrees) to radians
  const rotationY = (block.rotation / 1000) * (Math.PI / 180); // millidegrees to radians

  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <mesh castShadow receiveShadow>
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
        <mesh scale={1.02} renderOrder={999}>
          <boxGeometry args={size} />
          <meshBasicMaterial color="#00aacc" toneMapped={false} transparent opacity={0.15} side={2} />
        </mesh>
      )}

      {highlight === 'perfect' && (
        <mesh scale={1.04} renderOrder={1000}>
          <boxGeometry args={size} />
          <meshBasicMaterial color="#66ffff" toneMapped={false} transparent opacity={0.25} />
        </mesh>
      )}
    </group>
  );
};
