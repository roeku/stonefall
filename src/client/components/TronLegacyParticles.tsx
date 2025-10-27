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
    type: 'fragment' | 'energy' | 'spark';
}

interface Props {
    trimEffects: ReadonlyArray<TrimEffect>;
    convertPosition: (fixedValue: number) => number;
    currentTick: number;
}

/**
 * Authentic Tron: Legacy disintegration using efficient Points geometry
 * Digital matter streams outward from surfaces in geometric patterns
 */
export const TronLegacyParticles: React.FC<Props> = ({
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
            size: 0.05,
            color: new THREE.Color(0, 1, 1),
            type: 'fragment'
        }))
    );

    // Track spawned effects
    const spawnedEffects = useRef<Set<number>>(new Set());

    // Create geometry and material for Points
    const geometry = useMemo(() => {
        const geo = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const colors = new Float32Array(particleCount * 3);
        const sizes = new Float32Array(particleCount);

        for (let i = 0; i < particleCount; i++) {
            positions[i * 3] = 0;
            positions[i * 3 + 1] = -1000; // Start hidden
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

    // Tron: Legacy style material with custom shader for better visuals
    const material = useMemo(() => {
        return new THREE.ShaderMaterial({
            uniforms: {
                time: { value: 0 }
            },
            vertexShader: `
        attribute float size;
        attribute vec3 color;
        varying vec3 vColor;
        varying float vSize;
        uniform float time;
        
        void main() {
          vColor = color;
          vSize = size;
          
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          
          // Pulsing effect for Tron aesthetic
          float pulse = 0.8 + 0.2 * sin(time * 4.0 + position.x * 10.0);
          gl_PointSize = size * pulse * (300.0 / -mvPosition.z);
          
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
            fragmentShader: `
        varying vec3 vColor;
        varying float vSize;
        
        void main() {
          // Create circular particles with glowing edges
          vec2 center = gl_PointCoord - vec2(0.5);
          float dist = length(center);
          
          if (dist > 0.5) discard;
          
          // Glow effect - brighter in center, fading to edges
          float alpha = 1.0 - smoothstep(0.0, 0.5, dist);
          alpha = pow(alpha, 0.5); // Softer falloff
          
          // Add extra glow for Tron effect
          float glow = 1.0 - smoothstep(0.0, 0.3, dist);
          
          gl_FragColor = vec4(vColor * (1.0 + glow), alpha);
        }
      `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
    }, []);

    // Track active effects
    const activeEffects = useMemo(() => {
        return trimEffects.map(effect => {
            const age = currentTick - effect.tick;
            return {
                ...effect,
                age,
                shouldSpawn: age < 3 && age >= 0
            };
        }).filter(effect => effect.age < 90);
    }, [trimEffects, currentTick]);

    // Spawn particles with authentic Tron: Legacy surface streaming
    useEffect(() => {
        activeEffects.forEach(effect => {
            if (!effect.shouldSpawn) return;

            const effectId = effect.tick;
            if (spawnedEffects.current.has(effectId)) return;
            spawnedEffects.current.add(effectId);

            console.log(`⚡ TRON LEGACY: Digital matter disintegrating for effect ${effectId}`);

            effect.trimmedPieces.forEach(piece => {
                const worldX = convertPosition(piece.x);
                const worldY = convertPosition(piece.y);
                const worldZ = convertPosition(piece.z ?? 0);
                const worldWidth = convertPosition(piece.width);
                const worldHeight = convertPosition(piece.height);
                const worldDepth = piece.depth !== undefined ? convertPosition(piece.depth) : worldWidth * 0.25;

                // Surface-based particle spawning (like digital matter breaking apart from surfaces)
                const surfaceArea = 2 * (worldWidth * worldHeight + worldWidth * worldDepth + worldHeight * worldDepth);
                const numParticles = Math.min(250, Math.max(60, Math.floor(surfaceArea * 40)));
                let spawned = 0;

                for (let i = 0; i < pool.current.length && spawned < numParticles; i++) {
                    const p = pool.current[i];
                    if (!p || p.life > 0) continue;

                    // Spawn on surfaces with geometric precision (Tron: Legacy style)
                    const surface = Math.floor(Math.random() * 6);
                    let px, py, pz, normalX = 0, normalY = 0, normalZ = 0;

                    switch (surface) {
                        case 0: // Top face
                            px = worldX + (Math.random() - 0.5) * worldWidth;
                            py = worldY + worldHeight * 0.5;
                            pz = worldZ + (Math.random() - 0.5) * worldDepth;
                            normalY = 1;
                            break;
                        case 1: // Bottom face
                            px = worldX + (Math.random() - 0.5) * worldWidth;
                            py = worldY - worldHeight * 0.5;
                            pz = worldZ + (Math.random() - 0.5) * worldDepth;
                            normalY = -1;
                            break;
                        case 2: // Front face
                            px = worldX + (Math.random() - 0.5) * worldWidth;
                            py = worldY + (Math.random() - 0.5) * worldHeight;
                            pz = worldZ + worldDepth * 0.5;
                            normalZ = 1;
                            break;
                        case 3: // Back face
                            px = worldX + (Math.random() - 0.5) * worldWidth;
                            py = worldY + (Math.random() - 0.5) * worldHeight;
                            pz = worldZ - worldDepth * 0.5;
                            normalZ = -1;
                            break;
                        case 4: // Right face
                            px = worldX + worldWidth * 0.5;
                            py = worldY + (Math.random() - 0.5) * worldHeight;
                            pz = worldZ + (Math.random() - 0.5) * worldDepth;
                            normalX = 1;
                            break;
                        default: // Left face
                            px = worldX - worldWidth * 0.5;
                            py = worldY + (Math.random() - 0.5) * worldHeight;
                            pz = worldZ + (Math.random() - 0.5) * worldDepth;
                            normalX = -1;
                            break;
                    }

                    p.pos.set(px, py, pz);

                    // Tron: Legacy streaming - particles flow outward from surfaces
                    const streamForce = 1.5 + Math.random() * 2.5;
                    const streamDirection = new THREE.Vector3(normalX, normalY, normalZ);

                    // Add slight randomness but maintain the streaming effect
                    streamDirection.x += (Math.random() - 0.5) * 0.4;
                    streamDirection.y += (Math.random() - 0.5) * 0.4;
                    streamDirection.z += (Math.random() - 0.5) * 0.4;
                    streamDirection.normalize();

                    p.vel.copy(streamDirection).multiplyScalar(streamForce);

                    // Particle properties based on type
                    const rand = Math.random();
                    if (rand < 0.5) {
                        // Digital fragments (main effect)
                        p.type = 'fragment';
                        p.life = 2.5 + Math.random() * 1.5;
                        p.size = 0.08 + Math.random() * 0.12;
                        p.color.setRGB(0, 0.85 + Math.random() * 0.15, 1); // Bright cyan
                    } else if (rand < 0.8) {
                        // Energy streams
                        p.type = 'energy';
                        p.life = 3.0 + Math.random() * 2.0;
                        p.size = 0.06 + Math.random() * 0.08;
                        p.color.setRGB(0, 0.6 + Math.random() * 0.3, 0.9 + Math.random() * 0.1); // Blue energy
                    } else {
                        // Bright sparks
                        p.type = 'spark';
                        p.life = 1.5 + Math.random() * 1.0;
                        p.size = 0.04 + Math.random() * 0.06;
                        p.color.setRGB(0.9 + Math.random() * 0.1, 0.9 + Math.random() * 0.1, 1); // White sparks
                    }

                    p.maxLife = p.life;
                    spawned++;
                }

                console.log(`⚡ TRON LEGACY: Spawned ${spawned} digital fragments from surface area ${surfaceArea.toFixed(2)}`);
            });
        });
    }, [activeEffects, convertPosition]);

    // Update particles with Tron: Legacy physics
    useFrame((state, delta) => {
        // Update shader time
        if (material.uniforms.time) {
            material.uniforms.time.value = state.clock.elapsedTime;
        }

        if (!geometry.attributes.position || !geometry.attributes.color || !geometry.attributes.size) return;

        const positions = geometry.attributes.position.array as Float32Array;
        const colors = geometry.attributes.color.array as Float32Array;
        const sizes = geometry.attributes.size.array as Float32Array;
        const time = state.clock.elapsedTime;

        for (let i = 0; i < pool.current.length; i++) {
            const p = pool.current[i];
            if (!p) continue;

            const i3 = i * 3;

            if (p.life > 0) {
                // Age particle
                p.life -= delta;
                const lifeRatio = p.life / p.maxLife;

                // Tron: Legacy physics based on particle type
                if (p.type === 'energy') {
                    // Energy streams with flowing motion
                    p.vel.y -= 1.0 * delta;
                    p.vel.multiplyScalar(0.98);

                    // Add energy flow effect
                    const flow = Math.sin(time * 2 + i * 0.1) * 0.15;
                    p.vel.x += flow * delta;
                    p.vel.z += flow * delta;
                } else if (p.type === 'fragment') {
                    // Fragments fall with moderate gravity
                    p.vel.y -= 2.5 * delta;
                    p.vel.multiplyScalar(0.96);
                } else {
                    // Sparks have erratic movement
                    p.vel.y -= 1.8 * delta;
                    p.vel.multiplyScalar(0.97);

                    // Spark jitter
                    const jitter = 0.3;
                    p.vel.x += (Math.random() - 0.5) * jitter * delta;
                    p.vel.z += (Math.random() - 0.5) * jitter * delta;
                }

                // Update position
                p.pos.addScaledVector(p.vel, delta);

                // Update buffer attributes
                positions[i3] = p.pos.x;
                positions[i3 + 1] = p.pos.y;
                positions[i3 + 2] = p.pos.z;

                // Fade out with life
                const alpha = lifeRatio;
                colors[i3] = p.color.r * alpha;
                colors[i3 + 1] = p.color.g * alpha;
                colors[i3 + 2] = p.color.b * alpha;

                sizes[i] = p.size * (0.5 + alpha * 0.5);
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

        geometry.attributes.position.needsUpdate = true;
        geometry.attributes.color.needsUpdate = true;
        geometry.attributes.size.needsUpdate = true;
    });

    return (
        <points ref={pointsRef} geometry={geometry} material={material} />
    );
};

export default TronLegacyParticles;
