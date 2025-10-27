import React, { useRef, useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { TrimEffect } from '../../shared/simulation';

interface Particle {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
  color: THREE.Color;
}

interface Props {
  trimEffects: ReadonlyArray<TrimEffect>;
  convertPosition: (fixedValue: number) => number;
  currentTick: number;
}

/**
 * Clear Tron disintegration: Shows what got cut, then fast particle burst
 */
export const TronClearDisintegration: React.FC<Props> = ({
  trimEffects,
  convertPosition,
  currentTick
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const pointsRef = useRef<THREE.Points>(null);
  const particleCount = 2000; // Increased pool for more particles

  // Particle pool
  const pool = useRef<Particle[]>(
    Array.from({ length: particleCount }).map(() => ({
      pos: new THREE.Vector3(0, 0, 0),
      vel: new THREE.Vector3(0, 0, 0),
      life: 0,
      maxLife: 1,
      size: 0.05,
      color: new THREE.Color(0, 1, 1)
    }))
  );

  // Track spawned effects
  const spawnedEffects = useRef<Set<number>>(new Set());

  // Base material for wireframe - bright and visible
  const baseTrimmedMaterial = useMemo(() => {
    return new THREE.MeshBasicMaterial({
      color: 0x00ffff, // Start with bright cyan
      transparent: true,
      opacity: 0.9, // More opaque for visibility
      wireframe: true,
      toneMapped: false
    });
  }, []);

  // Particle geometry and material
  const particleGeometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    const sizes = new Float32Array(particleCount);

    for (let i = 0; i < particleCount; i++) {
      positions[i * 3] = 0;
      positions[i * 3 + 1] = -1000;
      positions[i * 3 + 2] = 0;
      colors[i * 3] = 0;
      colors[i * 3 + 1] = 1;
      colors[i * 3 + 2] = 1;
      sizes[i] = 0;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    return geo;
  }, []);

  const particleMaterial = useMemo(() => {
    return new THREE.PointsMaterial({
      size: 0.4, // Base size that works well with size variations
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      sizeAttenuation: true, // Enable depth-based sizing for variety
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true // Enable proper depth testing
    });
  }, []);

  // Process trim effects with clear phases
  const activeEffects = useMemo(() => {
    return trimEffects.map(effect => {
      const age = currentTick - effect.tick;
      const progress = Math.min(1, age / 60);

      // Color transition phases - more dramatic timing
      const transitionStart = 8;  // Start transition earlier at 0.13 seconds
      const transitionEnd = 18;   // Complete transition at 0.30 seconds
      const particleSpawn = 16;   // Spawn particles when mostly orange
      const fadeStart = 25;       // Start fading at 0.42 seconds
      const geometryEnd = 40;     // Geometry completely gone at 0.67 seconds

      const transitionProgress = age < transitionStart ? 0 :
        age > transitionEnd ? 1 :
          (age - transitionStart) / (transitionEnd - transitionStart);

      // Smooth fade-out calculation
      const fadeProgress = age < fadeStart ? 0 :
        age > geometryEnd ? 1 :
          (age - fadeStart) / (geometryEnd - fadeStart);

      return {
        ...effect,
        age,
        progress,
        showGeometry: age < geometryEnd,
        shouldSpawnParticles: age >= particleSpawn && age < particleSpawn + 5,
        transitionProgress, // 0 = cyan, 1 = orange
        geometryOpacity: Math.max(0, 1.0 - fadeProgress), // Smooth fade from 1 to 0
        emissionIntensity: Math.min(2.0, transitionProgress * 3) // Increase emission as it turns orange
      };
    }).filter(effect => effect.age < 150); // Let particles linger longer
  }, [trimEffects, currentTick]);

  // Spawn particles from trim effects
  useEffect(() => {
    activeEffects.forEach(effect => {
      if (!effect.shouldSpawnParticles) return;

      const effectId = effect.tick;
      if (spawnedEffects.current.has(effectId)) return;
      spawnedEffects.current.add(effectId);

      console.log(`💥 TRON: Clear disintegration for effect ${effectId} - spawning particles now`);

      // Debug the transition
      const debugEffect = activeEffects.find(e => e.tick === effectId);
      if (debugEffect) {
        console.log(`🎨 Color transition: ${(debugEffect.transitionProgress * 100).toFixed(0)}% (${debugEffect.transitionProgress < 0.5 ? 'cyan' : 'orange'}), opacity: ${debugEffect.geometryOpacity.toFixed(2)}`);
      }

      effect.trimmedPieces.forEach(piece => {
        const worldX = convertPosition(piece.x);
        const worldY = convertPosition(piece.y);
        const worldZ = convertPosition(piece.z ?? 0);
        const worldWidth = convertPosition(piece.width);
        const worldHeight = convertPosition(piece.height);
        const worldDepth = piece.depth !== undefined ? convertPosition(piece.depth) : worldWidth * 0.25;

        // Dense particle explosion
        const numParticles = Math.min(300, Math.max(60, Math.floor(worldWidth * worldHeight * 200))); // Much more particles
        let spawned = 0;

        for (let i = 0; i < pool.current.length && spawned < numParticles; i++) {
          const p = pool.current[i];
          if (!p || p.life > 0) continue;

          // Spawn particles on specific wireframe edges with edge-specific physics
          const edge = Math.random();
          let px, py, pz;
          let edgeNormal = new THREE.Vector3();
          let edgeType = '';

          if (edge < 0.2) {
            // Top edge - particles shoot upward and outward
            px = worldX + (Math.random() - 0.5) * worldWidth;
            py = worldY + worldHeight * 0.5;
            pz = worldZ + (Math.random() - 0.5) * worldDepth;
            edgeNormal.set(0, 1, 0);
            edgeType = 'top';
          } else if (edge < 0.35) {
            // Bottom edge - particles shoot downward and outward
            px = worldX + (Math.random() - 0.5) * worldWidth;
            py = worldY - worldHeight * 0.5;
            pz = worldZ + (Math.random() - 0.5) * worldDepth;
            edgeNormal.set(0, -1, 0);
            edgeType = 'bottom';
          } else if (edge < 0.55) {
            // Right edge - particles shoot right
            px = worldX + worldWidth * 0.5;
            py = worldY + (Math.random() - 0.5) * worldHeight;
            pz = worldZ + (Math.random() - 0.5) * worldDepth;
            edgeNormal.set(1, 0, 0);
            edgeType = 'right';
          } else if (edge < 0.75) {
            // Left edge - particles shoot left
            px = worldX - worldWidth * 0.5;
            py = worldY + (Math.random() - 0.5) * worldHeight;
            pz = worldZ + (Math.random() - 0.5) * worldDepth;
            edgeNormal.set(-1, 0, 0);
            edgeType = 'left';
          } else if (edge < 0.875) {
            // Front edge - particles shoot forward
            px = worldX + (Math.random() - 0.5) * worldWidth;
            py = worldY + (Math.random() - 0.5) * worldHeight;
            pz = worldZ + worldDepth * 0.5;
            edgeNormal.set(0, 0, 1);
            edgeType = 'front';
          } else {
            // Back edge - particles shoot backward
            px = worldX + (Math.random() - 0.5) * worldWidth;
            py = worldY + (Math.random() - 0.5) * worldHeight;
            pz = worldZ - worldDepth * 0.5;
            edgeNormal.set(0, 0, -1);
            edgeType = 'back';
          }

          p.pos.set(px, py, pz);

          // Edge-specific velocity with realistic physics
          const baseForce = 8 + Math.random() * 12;
          let velocity = new THREE.Vector3();

          switch (edgeType) {
            case 'top':
              // Top particles: strong upward burst, then gravity takes over
              velocity.set(
                (Math.random() - 0.5) * 4, // Horizontal spread
                baseForce * (0.8 + Math.random() * 0.4), // Strong upward
                (Math.random() - 0.5) * 4
              );
              break;
            case 'bottom':
              // Bottom particles: immediate downward with outward spread
              velocity.set(
                (Math.random() - 0.5) * 6, // More horizontal spread
                -baseForce * (0.3 + Math.random() * 0.3), // Downward
                (Math.random() - 0.5) * 6
              );
              break;
            case 'right':
              // Right particles: strong rightward with slight upward
              velocity.set(
                baseForce * (0.7 + Math.random() * 0.3), // Strong right
                Math.random() * 3, // Slight upward
                (Math.random() - 0.5) * 3
              );
              break;
            case 'left':
              // Left particles: strong leftward with slight upward
              velocity.set(
                -baseForce * (0.7 + Math.random() * 0.3), // Strong left
                Math.random() * 3, // Slight upward
                (Math.random() - 0.5) * 3
              );
              break;
            case 'front':
              // Front particles: forward burst with upward component
              velocity.set(
                (Math.random() - 0.5) * 3,
                Math.random() * 4, // Upward
                baseForce * (0.7 + Math.random() * 0.3) // Strong forward
              );
              break;
            case 'back':
              // Back particles: backward burst with upward component
              velocity.set(
                (Math.random() - 0.5) * 3,
                Math.random() * 4, // Upward
                -baseForce * (0.7 + Math.random() * 0.3) // Strong backward
              );
              break;
          }

          p.vel.copy(velocity);

          // Explosive particles that linger to watch them fall
          p.life = 1.2 + Math.random() * 0.8; // Longer life to see them fall
          p.maxLife = p.life;

          // Varied particle sizes for more visual interest
          const sizeType = Math.random();
          if (sizeType < 0.3) {
            p.size = 0.1 + Math.random() * 0.1; // Small fragments (30%)
          } else if (sizeType < 0.7) {
            p.size = 0.2 + Math.random() * 0.15; // Medium fragments (40%)
          } else {
            p.size = 0.3 + Math.random() * 0.2; // Large chunks (30%)
          }

          // Orange particles to match wireframe
          const orangeVariation = Math.random();
          if (orangeVariation < 0.3) {
            p.color.setRGB(1, 0.3, 0); // Deep orange
          } else if (orangeVariation < 0.7) {
            p.color.setRGB(1, 0.5, 0); // Medium orange
          } else {
            p.color.setRGB(1, 0.7, 0.2); // Bright orange-yellow
          }

          spawned++;
        }

        console.log(`💥 TRON: EXPLOSIVE burst of ${spawned} particles from wireframe`);
      });
    });
  }, [activeEffects, convertPosition]);

  // Update particles
  useFrame((_state, delta) => {
    if (!particleGeometry.attributes.position || !particleGeometry.attributes.color || !particleGeometry.attributes.size) return;

    const positions = particleGeometry.attributes.position.array as Float32Array;
    const colors = particleGeometry.attributes.color.array as Float32Array;
    const sizes = particleGeometry.attributes.size.array as Float32Array;

    // Minimal logging for performance

    for (let i = 0; i < pool.current.length; i++) {
      const p = pool.current[i];
      if (!p) continue;

      const i3 = i * 3;

      if (p.life > 0) {
        // Explosive physics with stronger gravity and flutter
        p.life -= delta * 1.2; // Age slower to watch them fall

        // Size-based physics - larger particles fall faster, smaller ones flutter more
        const sizeRatio = p.size / 0.5; // Normalize size (0.5 is roughly max size)
        const gravityMultiplier = 0.7 + sizeRatio * 0.6; // Larger = more gravity
        const flutterMultiplier = 1.3 - sizeRatio * 0.8; // Smaller = more flutter

        // Much stronger gravity for faster falling
        p.vel.y -= 25.0 * delta * gravityMultiplier;

        // Add flutter/randomness while falling (air turbulence effect)
        const flutter = 0.8 * flutterMultiplier; // Flutter intensity based on size
        const timeOffset = i * 0.1; // Different flutter per particle
        p.vel.x += Math.sin(_state.clock.elapsedTime * 4 + timeOffset) * flutter * delta;
        p.vel.z += Math.cos(_state.clock.elapsedTime * 3.5 + timeOffset) * flutter * delta;

        // Add some random jitter for more organic movement
        const jitter = 0.3 * flutterMultiplier; // Smaller particles jitter more
        p.vel.x += (Math.random() - 0.5) * jitter * delta;
        p.vel.z += (Math.random() - 0.5) * jitter * delta;

        // Size-based air resistance - larger particles less affected by air
        const airResistance = 0.88 + sizeRatio * 0.05; // Larger = less air resistance
        p.vel.multiplyScalar(airResistance);
        p.pos.addScaledVector(p.vel, delta);

        // Update buffer attributes
        positions[i3] = p.pos.x;
        positions[i3 + 1] = p.pos.y;
        positions[i3 + 2] = p.pos.z;

        const alpha = Math.max(0, p.life / p.maxLife);
        colors[i3] = p.color.r * alpha;
        colors[i3 + 1] = p.color.g * alpha;
        colors[i3 + 2] = p.color.b * alpha;

        sizes[i] = p.size * alpha;
      } else {
        // Hide dead particles
        positions[i3] = 0;
        positions[i3 + 1] = -1000;
        positions[i3 + 2] = 0;
        colors[i3] = 0;
        colors[i3 + 1] = 0;
        colors[i3 + 2] = 0;
        sizes[i] = 0;
      }
    }

    particleGeometry.attributes.position.needsUpdate = true;
    particleGeometry.attributes.color.needsUpdate = true;
    particleGeometry.attributes.size.needsUpdate = true;
  });

  return (
    <group ref={groupRef}>
      {/* Show trimmed geometry briefly before particles */}
      {activeEffects.map((effect) => (
        effect.showGeometry && (
          <group key={`geometry-${effect.tick}`}>
            {effect.trimmedPieces.map((piece, pieceIndex) => {
              const worldX = convertPosition(piece.x);
              const worldY = convertPosition(piece.y);
              const worldZ = convertPosition(piece.z ?? 0);
              const worldWidth = convertPosition(piece.width);
              const worldHeight = convertPosition(piece.height);
              const worldDepth = piece.depth !== undefined ? convertPosition(piece.depth) : worldWidth * 0.25;

              // Clone material with color transition and emission
              const materialClone = baseTrimmedMaterial.clone();

              // Dramatic color transition from bright cyan to bright orange
              const cyanColor = new THREE.Color(0x00ffff); // Bright cyan
              const orangeColor = new THREE.Color(0xff6600); // Bright orange
              const currentColor = cyanColor.clone().lerp(orangeColor, effect.transitionProgress);

              materialClone.color = currentColor;

              // Increase opacity during transition for more dramatic effect
              const baseOpacity = 0.9;
              const glowOpacity = Math.min(1.0, baseOpacity + effect.emissionIntensity * 0.3);
              materialClone.opacity = glowOpacity * effect.geometryOpacity;

              return (
                <mesh
                  key={`trimmed-${pieceIndex}`}
                  position={[worldX, worldY, worldZ]}
                >
                  <boxGeometry args={[worldWidth, worldHeight, worldDepth]} />
                  <primitive object={materialClone} />
                </mesh>
              );
            })}
          </group>
        )
      ))}

      {/* Fast particle burst */}
      <points
        ref={pointsRef}
        geometry={particleGeometry}
        material={particleMaterial}
        visible={true}
        frustumCulled={false}
        renderOrder={1}
      />
    </group>
  );
};

export default TronClearDisintegration;
