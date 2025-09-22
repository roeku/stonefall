import React, { useRef, useState, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface SlicingEffectProps {
  active: boolean;
  cutPosition: [number, number, number];
  cutDirection: 'vertical' | 'horizontal';
  blockWidth: number;
  blockHeight: number;
  onComplete: () => void;
}

export const SlicingEffect: React.FC<SlicingEffectProps> = ({
  active,
  cutPosition,
  cutDirection,
  blockWidth,
  blockHeight,
  onComplete,
}) => {
  const effectRef = useRef<THREE.Group>(null);
  const animationStartTime = useRef<number>(0);
  const [cutLineVisible, setCutLineVisible] = useState(false);

  useEffect(() => {
    if (active) {
      animationStartTime.current = Date.now();
      setCutLineVisible(true);

      // Hide cut line after brief moment
      const timer = setTimeout(() => {
        setCutLineVisible(false);
      }, 200);

      return () => clearTimeout(timer);
    } else {
      setCutLineVisible(false);
    }
  }, [active]);

  useFrame(() => {
    if (!active || !effectRef.current) return;

    const elapsed = (Date.now() - animationStartTime.current) / 1000;
    const duration = 1.2; // Total effect duration

    if (elapsed >= duration) {
      onComplete();
      return;
    }

    // Animate the cut line intensity
    if (cutLineVisible && elapsed < 0.2 && effectRef.current) {
      const lineProgress = elapsed / 0.2;
      const intensity = Math.sin(lineProgress * Math.PI) * 2; // Quick flash

      effectRef.current.children.forEach(child => {
        if (child.userData.isCutLine && child instanceof THREE.Mesh) {
          const material = child.material as THREE.MeshBasicMaterial;
          material.opacity = intensity * 0.8;
        }
      });
    }

    // Animate fragments falling
    const fragmentProgress = Math.max(0, (elapsed - 0.1) / 1.1); // Start slightly after cut line
    if (effectRef.current) {
      effectRef.current.children.forEach((child, index) => {
        if (child.userData.isFragment && child instanceof THREE.Mesh) {
          const fallSpeed = 2 + (index * 0.1); // Varying fall speeds
          const rotation = fragmentProgress * (2 + index * 0.5); // Tumbling
          const fadeStart = 0.7;

          // Position
          child.position.y = cutPosition[1] - (fragmentProgress * fallSpeed);
          child.position.x = cutPosition[0] + (child.userData.offsetX || 0) * (1 + fragmentProgress * 0.5);
          child.position.z = cutPosition[2] + (child.userData.offsetZ || 0) * (1 + fragmentProgress * 0.5);

          // Rotation
          child.rotation.x = rotation * (child.userData.rotSpeedX || 1);
          child.rotation.y = rotation * (child.userData.rotSpeedY || 1);
          child.rotation.z = rotation * (child.userData.rotSpeedZ || 1);

          // Scale and opacity
          const scale = 1 - fragmentProgress * 0.3;
          child.scale.setScalar(Math.max(0.1, scale));

          const material = child.material as THREE.MeshStandardMaterial;
          if (fragmentProgress > fadeStart) {
            const fadeProgress = (fragmentProgress - fadeStart) / (1 - fadeStart);
            material.opacity = Math.max(0, 1 - fadeProgress);
          }
        }
      });
    }
  });

  if (!active) return null;

  // Generate random fragments
  const fragments = [];
  const numFragments = 12;
  const fragmentSize = Math.min(blockWidth, blockHeight) / 8;

  for (let i = 0; i < numFragments; i++) {
    const offsetX = (Math.random() - 0.5) * blockWidth * 0.8;
    const offsetZ = (Math.random() - 0.5) * blockWidth * 0.8;
    const size = fragmentSize * (0.5 + Math.random() * 0.5);

    fragments.push(
      <mesh
        key={i}
        position={[cutPosition[0] + offsetX, cutPosition[1], cutPosition[2] + offsetZ]}
        userData={{
          isFragment: true,
          offsetX: offsetX,
          offsetZ: offsetZ,
          rotSpeedX: (Math.random() - 0.5) * 4,
          rotSpeedY: (Math.random() - 0.5) * 4,
          rotSpeedZ: (Math.random() - 0.5) * 4,
        }}
      >
        <boxGeometry args={[size, size * 0.7, size * 0.8]} />
        <meshStandardMaterial
          color="#E5DDD5"
          transparent
          opacity={1}
        />
      </mesh>
    );
  }

  return (
    <group ref={effectRef} position={[0, 0, 0]}>
      {/* Glowing cut line */}
      {cutLineVisible && (
        <mesh
          position={cutPosition}
          rotation={cutDirection === 'vertical' ? [0, 0, 0] : [0, 0, Math.PI / 2]}
          userData={{ isCutLine: true }}
        >
          <planeGeometry args={[
            cutDirection === 'vertical' ? 0.05 : blockWidth * 1.2,
            cutDirection === 'vertical' ? blockHeight * 1.2 : 0.05
          ]} />
          <meshBasicMaterial
            color="#00FFFF"
            transparent
            opacity={0.8}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      )}

      {/* Fragment particles */}
      {fragments}

      {/* Particle trail stream */}
      {Array.from({ length: 20 }, (_, i) => {
        const delay = i * 0.05;
        const x = cutPosition[0] + (Math.random() - 0.5) * blockWidth;
        const z = cutPosition[2] + (Math.random() - 0.5) * blockWidth;

        return (
          <mesh
            key={`particle-${i}`}
            position={[x, cutPosition[1] - delay, z]}
            userData={{
              isFragment: true,
              offsetX: (Math.random() - 0.5) * 2,
              offsetZ: (Math.random() - 0.5) * 2,
              rotSpeedX: Math.random() * 8,
              rotSpeedY: Math.random() * 8,
              rotSpeedZ: Math.random() * 8,
            }}
          >
            <sphereGeometry args={[0.02 + Math.random() * 0.03, 6, 6]} />
            <meshBasicMaterial
              color="#FFFFFF"
              transparent
              opacity={0.6}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
        );
      })}
    </group>
  );
};
