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
 * Simplified Tron-style disintegration effects using Points geometry for better performance
 */
export const TronDisintegrationEffectsSimple: React.FC<Props> = ({
  trimEffects,
  convertPosition,
  currentTick
}) => {
  const pointsRef = useRef<THREE.Points>(null);
  const particleCount = 1000;

  // Particle pool
  const pool = useRef<Particle[]>(
    Array.from({ length: particleCount }).map(() => ({
      pos: new THREE.Vector3(0, 0, 0),
      vel: new THREE.Vector3(0, 0, 0),
      life: 0,
      maxLife: 1,
      size: 0.05 + Math.random() * 0.1,
      color: new THREE.Color(0, 1, 1) // Cyan default
    }))
  );

  // Track spawned effects
  const spawnedEffects = useRef<Set<number>>(new Set());

  // Create geometry and material
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    const sizes = new Float32Array(particleCount);

    // Initialize with zeros
    for (let i = 0; i < particleCount; i++) {
      positions[i * 3] = 0;
      positions[i * 3 + 1] = 0;
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

  const material = useMemo(() => {
    return new THREE.PointsMaterial({
      size: 0.6, // Reasonable size
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true
    });
  }, []);

  // Track active effects with better timing
  const activeEffects = useMemo(() => {
    const effects = trimEffects.map(effect => {
      const age = currentTick - effect.tick;
      return {
        ...effect,
        age,
        shouldSpawn: age >= 15 && age < 25 // Delay spawn to show what got cut first
      };
    }).filter(effect => effect.age < 90); // Shorter total duration

    // Clean up old spawned effects
    const activeTicks = new Set(effects.map(e => e.tick));
    const toRemove: number[] = [];
    spawnedEffects.current.forEach(tick => {
      if (!activeTicks.has(tick)) {
        toRemove.push(tick);
      }
    });
    toRemove.forEach(tick => spawnedEffects.current.delete(tick));

    return effects;
  }, [trimEffects, currentTick]);

  // Component initialization with camera-relative test particles
  useEffect(() => {
    console.log('💥 TRON: Fast disintegration system ready');
  }, []);

  // Spawn particles
  useEffect(() => {
    activeEffects.forEach(effect => {
      if (!effect.shouldSpawn) return;

      const effectId = effect.tick;
      if (spawnedEffects.current.has(effectId)) return;
      spawnedEffects.current.add(effectId);

      console.log(`⚡ TRON: Digital matter disintegrating for effect ${effectId}`);

      effect.trimmedPieces.forEach(piece => {
        const worldX = convertPosition(piece.x);
        const worldY = convertPosition(piece.y);
        const worldZ = convertPosition(piece.z ?? 0);
        const worldWidth = convertPosition(piece.width);
        const worldHeight = convertPosition(piece.height);

        // Focused particle burst from trimmed piece
        const volume = worldWidth * worldHeight * (worldWidth * 0.5);
        const numParticles = Math.min(120, Math.max(30, Math.floor(volume * 80))); // Fewer but more focused
        let spawned = 0;

        for (let i = 0; i < pool.current.length && spawned < numParticles; i++) {
          const p = pool.current[i];
          if (!p || p.life > 0) continue;

          // Tron: Legacy style - spawn on surfaces and stream outward
          const surface = Math.floor(Math.random() * 6);
          let px, py, pz, normalX = 0, normalY = 0, normalZ = 0;

          switch (surface) {
            case 0: // Top face
              px = worldX + (Math.random() - 0.5) * worldWidth;
              py = worldY + worldHeight * 0.5;
              pz = worldZ + (Math.random() - 0.5) * worldWidth * 0.5;
              normalY = 1;
              break;
            case 1: // Bottom face
              px = worldX + (Math.random() - 0.5) * worldWidth;
              py = worldY - worldHeight * 0.5;
              pz = worldZ + (Math.random() - 0.5) * worldWidth * 0.5;
              normalY = -1;
              break;
            case 2: // Front face
              px = worldX + (Math.random() - 0.5) * worldWidth;
              py = worldY + (Math.random() - 0.5) * worldHeight;
              pz = worldZ + worldWidth * 0.25;
              normalZ = 1;
              break;
            case 3: // Back face
              px = worldX + (Math.random() - 0.5) * worldWidth;
              py = worldY + (Math.random() - 0.5) * worldHeight;
              pz = worldZ - worldWidth * 0.25;
              normalZ = -1;
              break;
            case 4: // Right face
              px = worldX + worldWidth * 0.5;
              py = worldY + (Math.random() - 0.5) * worldHeight;
              pz = worldZ + (Math.random() - 0.5) * worldWidth * 0.5;
              normalX = 1;
              break;
            default: // Left face
              px = worldX - worldWidth * 0.5;
              py = worldY + (Math.random() - 0.5) * worldHeight;
              pz = worldZ + (Math.random() - 0.5) * worldWidth * 0.5;
              normalX = -1;
              break;
          }

          p.pos.set(px, py, pz);

          // Fast, focused disintegration burst
          const burstForce = 4 + Math.random() * 6;

          // Create outward direction from piece center
          const outwardDir = new THREE.Vector3(
            px - worldX, // Direction from piece center
            py - worldY,
            pz - worldZ
          ).normalize();

          // Add slight randomness but keep focused
          outwardDir.x += (Math.random() - 0.5) * 0.4;
          outwardDir.y += (Math.random() - 0.5) * 0.4;
          outwardDir.z += (Math.random() - 0.5) * 0.4;
          outwardDir.normalize();

          p.vel.copy(outwardDir).multiplyScalar(burstForce);

          p.life = 0.8 + Math.random() * 0.7; // Much shorter, snappy life
          p.maxLife = p.life;
          p.size = 0.4 + Math.random() * 0.4; // Consistent medium size

          // Authentic Tron: Legacy colors
          const rand = Math.random();
          if (rand < 0.15) {
            p.color.setRGB(1, 0.4, 0); // Orange accents (Tron Legacy)
          } else if (rand < 0.25) {
            p.color.setRGB(1, 1, 1); // White sparks
          } else {
            p.color.setRGB(0, 0.85 + Math.random() * 0.15, 1); // Bright cyan (classic Tron)
          }

          spawned++;
        }

        console.log(`⚡ TRON: Spawned ${spawned} digital fragments from volume ${volume.toFixed(2)} at (${worldX.toFixed(1)}, ${worldY.toFixed(1)}, ${worldZ.toFixed(1)})`);
      });
    });
  }, [activeEffects, convertPosition]);

  // Update particles
  useFrame((_state, delta) => {
    if (!geometry.attributes.position || !geometry.attributes.color || !geometry.attributes.size) return;

    const positions = geometry.attributes.position.array as Float32Array;
    const colors = geometry.attributes.color.array as Float32Array;
    const sizes = geometry.attributes.size.array as Float32Array;

    // Minimal logging for major events only

    for (let i = 0; i < pool.current.length; i++) {
      const p = pool.current[i];
      if (!p) continue;

      const i3 = i * 3;

      if (p.life > 0) {
        // Update physics - fast and snappy
        p.life -= delta * 2; // Age faster for quicker effect

        p.vel.y -= 12.0 * delta; // Very strong gravity for fast fall
        p.vel.multiplyScalar(0.88); // Strong air resistance to prevent excessive speed
        p.pos.addScaledVector(p.vel, delta);

        // Update buffer attributes with debug logging
        positions[i3] = p.pos.x;
        positions[i3 + 1] = p.pos.y;
        positions[i3 + 2] = p.pos.z;

        const alpha = Math.max(0, p.life / p.maxLife);
        colors[i3] = p.color.r * alpha;
        colors[i3 + 1] = p.color.g * alpha;
        colors[i3 + 2] = p.color.b * alpha;

        sizes[i] = Math.max(2.0, p.size * alpha); // Large minimum size

        // Particles updated
      } else {
        // Hide dead particles
        positions[i3] = 0;
        positions[i3 + 1] = -1000; // Move far away
        positions[i3 + 2] = 0;
        colors[i3] = 0;
        colors[i3 + 1] = 0;
        colors[i3 + 2] = 0;
        sizes[i] = 0;
      }
    }

    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
    geometry.attributes.size.needsUpdate = true;
  });

  // Debug: Log Points object info
  useEffect(() => {
    if (pointsRef.current) {
      console.log('💥 Points object created:', pointsRef.current);
      console.log('💥 Geometry:', geometry);
      console.log('💥 Material:', material);
      console.log('💥 Particle count:', particleCount);
    }
  }, [geometry, material]);

  return (
    <points
      ref={pointsRef}
      geometry={geometry}
      material={material}
      visible={true}
      frustumCulled={false}
      renderOrder={1}
    />
  );
};

export default TronDisintegrationEffectsSimple;
