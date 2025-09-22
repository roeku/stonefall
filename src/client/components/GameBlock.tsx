import React, { useRef, useMemo, useEffect, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Block } from '../../shared/simulation';

interface GameBlockProps {
  block: Block;
  isActive: boolean;
  convertPosition: (fixedValue: number) => number;
}

export const GameBlock: React.FC<GameBlockProps> = ({ block, isActive, convertPosition }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const outlineRef = useRef<THREE.Mesh>(null);

  // Animation state for smooth falling
  const [visualPosition, setVisualPosition] = useState<THREE.Vector3 | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const animationStartTime = useRef<number>(0);
  const initialPosition = useRef<THREE.Vector3>(new THREE.Vector3());

  // Convert block properties to Three.js units
  const targetPosition = useMemo(() => [
    convertPosition(block.x),
    convertPosition(block.y + block.height / 2),
    0,
  ] as [number, number, number], [block, convertPosition]);

  // Track block position changes to trigger animations
  const prevPositionRef = useRef<string>('');
  const currentPositionKey = `${block.x},${block.y}`;

  useEffect(() => {
    // If block position changed significantly (dropped), start fall animation
    if (prevPositionRef.current && prevPositionRef.current !== currentPositionKey) {
      const prevParts = prevPositionRef.current.split(',').map(Number);
      const currentY = convertPosition(block.y + block.height / 2);
      const prevY = convertPosition((prevParts[1] || 0) + block.height / 2);

      // If block moved down significantly, animate the fall
      if (prevY - currentY > 0.5) {
        setIsAnimating(true);
        animationStartTime.current = Date.now();
        initialPosition.current.set(
          convertPosition(block.x),
          prevY + 2, // Start slightly above previous position
          0
        );
        setVisualPosition(initialPosition.current.clone());
      } else {
        setIsAnimating(false);
        setVisualPosition(null);
      }
    } else if (!prevPositionRef.current) {
      // First render - no animation
      setIsAnimating(false);
      setVisualPosition(null);
    }

    prevPositionRef.current = currentPositionKey;
  }, [currentPositionKey, block, convertPosition]);

  // Animate falling blocks with magnetic stick
  useFrame(() => {
    if (isAnimating && visualPosition) {
      const elapsed = (Date.now() - animationStartTime.current) / 1000;
      const duration = 0.4; // Faster, more deliberate drop

      if (elapsed >= duration) {
        // Animation complete - magnetic stick effect (instant lock)
        setIsAnimating(false);
        setVisualPosition(null);
      } else {
        // Smooth, consistent velocity drop (no easing for magnetic feel)
        const progress = elapsed / duration;
        const linearDrop = progress; // Linear for consistent velocity

        const currentY = THREE.MathUtils.lerp(
          initialPosition.current.y,
          targetPosition[1],
          linearDrop
        );

        setVisualPosition(new THREE.Vector3(
          targetPosition[0],
          currentY,
          targetPosition[2]
        ));
      }
    }
  });

  // Use animated position if available, otherwise use target position
  const displayPosition = visualPosition ?
    [visualPosition.x, visualPosition.y, visualPosition.z] as [number, number, number] :
    targetPosition;

  const size = useMemo(() => [
    convertPosition(block.width),
    convertPosition(block.height),
    convertPosition(block.width * 0.6), // Make depth smaller for more rectangular blocks like mockup
  ] as [number, number, number], [block, convertPosition]);  // Create materials
  const blockMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: '#f8fbff',
      roughness: 0.1,
      metalness: 0.02,
      emissive: isActive ? '#001a33' : '#000000',
      emissiveIntensity: isActive ? 0.1 : 0,
    });
  }, [isActive]);

  // Prominent cyan outline for active block
  const outlineMaterial = useMemo(() => {
    if (!isActive) return null;
    return new THREE.MeshBasicMaterial({
      color: '#00ffff',
      transparent: true,
      opacity: 0.8,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
    });
  }, [isActive]);

  // Neon wireframe for active block
  const wireframeMaterial = useMemo(() => {
    if (!isActive) return null;
    return new THREE.MeshBasicMaterial({
      color: '#16e6ff',
      wireframe: true,
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending,
    });
  }, [isActive]);

  // Emissive glow for active block
  const glowMaterial = useMemo(() => {
    if (!isActive) return null;
    return new THREE.MeshBasicMaterial({
      color: '#00ffff',
      transparent: true,
      opacity: 0.2,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
    });
  }, [isActive]);

  // Animate active block glow
  useFrame((state) => {
    if (isActive && outlineRef.current) {
      const time = state.clock.getElapsedTime();
      const glowIntensity = 0.6 + Math.sin(time * 6) * 0.4; // Faster, more prominent pulse

      if (outlineRef.current.material instanceof THREE.MeshBasicMaterial) {
        outlineRef.current.material.opacity = glowIntensity;
      }
    }
  });

  return (
    <group position={displayPosition}>
      {/* Main block */}
      <mesh ref={meshRef} castShadow receiveShadow>
        <boxGeometry args={size} />
        <primitive object={blockMaterial} />
      </mesh>

      {/* Multiple outline layers for active block - maximum visibility */}
      {isActive && outlineMaterial && glowMaterial && wireframeMaterial && (
        <>
          {/* Primary outline - larger scale */}
          <mesh ref={outlineRef} scale={[1.12, 1.12, 1.12]}>
            <boxGeometry args={size} />
            <primitive object={outlineMaterial} />
          </mesh>

          {/* Secondary glow layer */}
          <mesh scale={[1.08, 1.08, 1.08]}>
            <boxGeometry args={size} />
            <primitive object={glowMaterial} />
          </mesh>

          {/* Wireframe overlay */}
          <mesh>
            <boxGeometry args={size} />
            <primitive object={wireframeMaterial} />
          </mesh>

          {/* Additional pulsing outline */}
          <mesh scale={[1.15, 1.15, 1.15]}>
            <boxGeometry args={size} />
            <meshBasicMaterial
              color="#00ffff"
              transparent
              opacity={0.3}
              side={THREE.BackSide}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
        </>
      )}
    </group>
  );
};
