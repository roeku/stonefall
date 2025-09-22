import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

export const AmbientParticles: React.FC = () => {
  const particlesRef = useRef<THREE.Points>(null);

  // Create simple floating ambient particles
  const { geometry, material } = useMemo(() => {
    const particleCount = 50;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 30;
      positions[i * 3 + 1] = Math.random() * 25 + 5;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 30;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      size: 0.05,
      sizeAttenuation: true,
      color: '#4a90e2',
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending
    });

    return { geometry, material };
  }, []);

  useFrame((state) => {
    if (!particlesRef.current) return;

    // Simple rotation animation
    particlesRef.current.rotation.y += 0.001;

    // Gentle floating motion
    const time = state.clock.getElapsedTime();
    particlesRef.current.position.y = Math.sin(time * 0.5) * 0.5;
  });

  return (
    <points ref={particlesRef}>
      <primitive object={geometry} />
      <primitive object={material} />
    </points>
  );
};
