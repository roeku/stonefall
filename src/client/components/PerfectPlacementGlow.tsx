import React, { useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface PerfectPlacementGlowProps {
  active: boolean;
  contactPosition: [number, number, number];
  blockWidth: number;
  blockHeight: number;
  onComplete: () => void;
}

export const PerfectPlacementGlow: React.FC<PerfectPlacementGlowProps> = ({
  active,
  contactPosition,
  blockWidth,
  blockHeight,
  onComplete,
}) => {
  const glowRef = useRef<THREE.Group>(null);
  const animationStartTime = useRef<number>(0);

  useEffect(() => {
    if (active) {
      animationStartTime.current = Date.now();
    }
  }, [active]);

  useFrame(() => {
    if (!active || !glowRef.current) return;

    const elapsed = (Date.now() - animationStartTime.current) / 1000;
    const duration = 0.8; // Animation duration in seconds

    if (elapsed >= duration) {
      onComplete();
      return;
    }

    // Create expanding azure glow effect
    const progress = elapsed / duration;
    const expansion = Math.sin(progress * Math.PI) * 0.5; // Sine wave for organic expansion
    const intensity = Math.max(0, 1 - progress * 1.2); // Fade out with slight overshoot

    // Update all glow materials
    if (glowRef.current) {
      glowRef.current.children.forEach((child, index) => {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshBasicMaterial) {
          const baseScale = 1 + expansion * 0.3;
          child.scale.setScalar(baseScale);

          // Shimmer effect with slight offset for each layer
          const shimmer = 0.8 + 0.2 * Math.sin((elapsed * 8) + (index * 0.5));
          child.material.opacity = intensity * shimmer * 0.7;
        }
      });
    }
  });

  if (!active) return null;

  return (
    <group ref={glowRef} position={contactPosition}>
      {/* Multiple layers for rich azure glow */}

      {/* Core bright center */}
      <mesh position={[0, blockHeight / 2 + 0.01, 0]}>
        <planeGeometry args={[blockWidth * 0.6, blockWidth * 0.6]} />
        <meshBasicMaterial
          color="#00BFFF"
          transparent
          opacity={0.9}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      {/* Mid layer */}
      <mesh position={[0, blockHeight / 2 + 0.02, 0]}>
        <planeGeometry args={[blockWidth * 0.8, blockWidth * 0.8]} />
        <meshBasicMaterial
          color="#0080FF"
          transparent
          opacity={0.6}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      {/* Outer glow layer */}
      <mesh position={[0, blockHeight / 2 + 0.03, 0]}>
        <planeGeometry args={[blockWidth * 1.2, blockWidth * 1.2]} />
        <meshBasicMaterial
          color="#4080FF"
          transparent
          opacity={0.3}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      {/* Surface spread on top of lower block */}
      <mesh position={[0, -blockHeight / 2 - 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[blockWidth * 0.7, 32]} />
        <meshBasicMaterial
          color="#00FFFF"
          transparent
          opacity={0.4}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      {/* Surface spread on bottom of new block */}
      <mesh position={[0, blockHeight / 2 - 0.01, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <circleGeometry args={[blockWidth * 0.7, 32]} />
        <meshBasicMaterial
          color="#00FFFF"
          transparent
          opacity={0.4}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      {/* Sparkle particles around contact point */}
      {Array.from({ length: 8 }, (_, i) => {
        const angle = (i / 8) * Math.PI * 2;
        const distance = blockWidth * 0.4;
        const x = Math.cos(angle) * distance;
        const z = Math.sin(angle) * distance;

        return (
          <mesh key={i} position={[x, blockHeight / 2, z]}>
            <sphereGeometry args={[0.05, 8, 8]} />
            <meshBasicMaterial
              color="#FFFFFF"
              transparent
              opacity={0.8}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
        );
      })}
    </group>
  );
};
