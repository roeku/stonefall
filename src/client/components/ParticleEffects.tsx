import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface ParticleSystemProps {
  position: [number, number, number];
  active: boolean;
  onComplete?: () => void;
}

interface Particle {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
}

export const DropParticles: React.FC<ParticleSystemProps> = ({
  position,
  active,
  onComplete
}) => {
  const particlesRef = useRef<THREE.Points>(null);
  const particles = useRef<Particle[]>([]);
  const startTime = useRef<number>(0);

  // Create particle geometry and material
  const { geometry, material } = useMemo(() => {
    const particleCount = 50;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    const sizes = new Float32Array(particleCount);

    // Initialize particles
    particles.current = [];
    for (let i = 0; i < particleCount; i++) {
      const particle: Particle = {
        position: new THREE.Vector3(
          position[0] + (Math.random() - 0.5) * 2,
          position[1],
          position[2] + (Math.random() - 0.5) * 2
        ),
        velocity: new THREE.Vector3(
          (Math.random() - 0.5) * 4,
          Math.random() * 3 + 2,
          (Math.random() - 0.5) * 4
        ),
        life: 1.0,
        maxLife: 1.0 + Math.random() * 0.5,
        size: Math.random() * 0.1 + 0.05
      };
      particles.current.push(particle);

      // Set initial positions
      positions[i * 3] = particle.position.x;
      positions[i * 3 + 1] = particle.position.y;
      positions[i * 3 + 2] = particle.position.z;

      // Cyan particles
      colors[i * 3] = 0.1;     // R
      colors[i * 3 + 1] = 0.9; // G
      colors[i * 3 + 2] = 1.0; // B

      sizes[i] = particle.size;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const material = new THREE.PointsMaterial({
      size: 0.1,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending
    });

    return { geometry, material };
  }, [position]);

  // Reset particles when effect becomes active
  React.useEffect(() => {
    if (active) {
      startTime.current = Date.now();
      particles.current.forEach((particle) => {
        particle.position.set(
          position[0] + (Math.random() - 0.5) * 2,
          position[1],
          position[2] + (Math.random() - 0.5) * 2
        );
        particle.velocity.set(
          (Math.random() - 0.5) * 4,
          Math.random() * 3 + 2,
          (Math.random() - 0.5) * 4
        );
        particle.life = particle.maxLife;
      });
    }
  }, [active, position]);

  useFrame((_, delta) => {
    if (!active || !particlesRef.current) return;

    const positionAttr = particlesRef.current.geometry.attributes.position;
    const colorAttr = particlesRef.current.geometry.attributes.color;

    if (!positionAttr || !colorAttr) return;

    const positions = positionAttr.array as Float32Array;
    const colors = colorAttr.array as Float32Array;

    let allDead = true;

    particles.current.forEach((particle, i) => {
      if (particle.life > 0) {
        allDead = false;

        // Update physics
        particle.velocity.y -= 9.8 * delta; // Gravity
        particle.position.add(particle.velocity.clone().multiplyScalar(delta));
        particle.life -= delta;

        // Update buffer attributes
        positions[i * 3] = particle.position.x;
        positions[i * 3 + 1] = particle.position.y;
        positions[i * 3 + 2] = particle.position.z;

        // Fade out based on life
        const alpha = Math.max(0, particle.life / particle.maxLife);
        colors[i * 3] = 0.1 * alpha;
        colors[i * 3 + 1] = 0.9 * alpha;
        colors[i * 3 + 2] = 1.0 * alpha;
      }
    });

    positionAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;

    // Call completion callback when all particles are dead
    if (allDead && onComplete) {
      onComplete();
    }
  });

  if (!active) return null;

  return (
    <points ref={particlesRef} geometry={geometry} material={material} />
  );
};

export const PerfectDropEffects: React.FC<ParticleSystemProps> = ({
  position,
  active,
  onComplete
}) => {
  const ringsRef = useRef<THREE.Group>(null);
  const startTime = useRef<number>(0);

  React.useEffect(() => {
    if (active) {
      startTime.current = Date.now();
    }
  }, [active]);

  useFrame(() => {
    if (!active || !ringsRef.current) return;

    const elapsed = (Date.now() - startTime.current) / 1000;
    const duration = 1.0;

    if (elapsed > duration) {
      if (onComplete) onComplete();
      return;
    }

    const progress = elapsed / duration;
    const scale = 1 + progress * 3;
    const opacity = Math.max(0, 1 - progress);

    if (ringsRef.current) {
      ringsRef.current.scale.setScalar(scale);
      ringsRef.current.children.forEach((child) => {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshBasicMaterial) {
          child.material.opacity = opacity;
        }
      });
    }
  });

  if (!active) return null;

  return (
    <group ref={ringsRef} position={position}>
      {/* Expanding rings for perfect drop */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1, 1.2, 32]} />
        <meshBasicMaterial
          color="#16e6ff"
          transparent
          opacity={0.8}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} scale={[0.7, 0.7, 0.7]}>
        <ringGeometry args={[0.8, 1, 32]} />
        <meshBasicMaterial
          color="#ffffff"
          transparent
          opacity={0.6}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
};
