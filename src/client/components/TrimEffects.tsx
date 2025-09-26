import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { TrimEffect } from '../../shared/simulation';

interface TrimEffectsProps {
  trimEffects: ReadonlyArray<TrimEffect>;
  convertPosition: (fixedValue: number) => number;
  currentTick: number;
}

interface FallingPiece {
  position: THREE.Vector3;
  rotation: THREE.Vector3;
  scale: THREE.Vector3;
  velocity: THREE.Vector3;
  angularVelocity: THREE.Vector3;
  life: number;
  size: [number, number, number];
}

export const TrimEffects: React.FC<TrimEffectsProps> = ({
  trimEffects,
  convertPosition,
  currentTick
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const fallingPieces = useRef<FallingPiece[]>([]);

  // Convert trim effects to falling pieces
  const activePieces = useMemo(() => {
    const pieces: FallingPiece[] = [];

    trimEffects.forEach((effect) => {
      const age = currentTick - effect.tick;
      if (age > 60) return; // Remove after 1 second

      effect.trimmedPieces.forEach((piece) => {
        const worldX = convertPosition(piece.x);
        const worldY = convertPosition(piece.y);
        const worldZ = convertPosition(piece.z ?? 0);
        const worldWidth = convertPosition(piece.width);
        const worldHeight = convertPosition(piece.height);
        const worldDepth = piece.depth !== undefined ? convertPosition(piece.depth) : Math.max(0.6, worldWidth * 0.25);

        // Calculate initial velocity and position based on age
        const deltaTime = age / 60; // Convert ticks to seconds
        const gravity = 9.8; // positive so world Y increases upward in Three.js coords

        // For polished look, trimmed pieces should move upward when velocityY is positive
        const initialVelY = convertPosition(piece.velocityY) / 20;

        // Physics simulation (vertical-only + gravity upward)
        const currentVelX = 0;
        const currentVelY = initialVelY + gravity * deltaTime;
        const currentVelZ = 0;

        const currentX = worldX; // no horizontal drift
        const currentY = worldY + initialVelY * deltaTime + 0.5 * gravity * deltaTime * deltaTime;
        const currentZ = worldZ; // no horizontal drift

        pieces.push({
          position: new THREE.Vector3(currentX, Math.max(currentY, -40), currentZ),
          rotation: new THREE.Vector3(0, 0, 0),
          scale: new THREE.Vector3(1, 1, 1),
          velocity: new THREE.Vector3(currentVelX, currentVelY * 2.45, currentVelZ),
          angularVelocity: new THREE.Vector3(0, 0, 0),
          life: Math.max(0, 1 - age / 60),
          size: [worldWidth, worldHeight, worldDepth] as [number, number, number],
        });
      });
    });

    return pieces;
  }, [trimEffects, convertPosition, currentTick]);

  // Update physics in animation loop
  useFrame(() => {
    fallingPieces.current = activePieces;

    if (groupRef.current) {
      // Update each piece's visual representation
      groupRef.current.children.forEach((child, index) => {
        const piece = fallingPieces.current[index];
        if (piece && child instanceof THREE.Mesh) {
          // Apply physics simulation would be done here in real-time
          // But since we pre-calculate in useMemo, just update visual properties
          child.position.copy(piece.position);
          child.rotation.setFromVector3(piece.rotation);

          // Fade out as life decreases
          if (child.material instanceof THREE.MeshStandardMaterial) {
            child.material.opacity = piece.life;
            child.material.transparent = true;
          }
        }
      });
    }
  });

  return (
    <group ref={groupRef}>
      {activePieces.map((piece, index) => (
        <mesh key={`trim-piece-${index}`}
          position={piece.position}
          rotation={[piece.rotation.x, piece.rotation.y, piece.rotation.z]}
          scale={piece.scale}>
          <boxGeometry args={piece.size} />
          <meshStandardMaterial
            color="#e8e8e0"
            roughness={0.2}
            metalness={0.1}
            transparent
            opacity={piece.life}
          />
        </mesh>
      ))}
    </group>
  );
};
