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
 * Hybrid Tron disintegration: Dissolving geometry + explosive particles
 */
export const TronHybridDisintegration: React.FC<Props> = ({
    trimEffects,
    convertPosition,
    currentTick
}) => {
    const groupRef = useRef<THREE.Group>(null);
    const pointsRef = useRef<THREE.Points>(null);
    const particleCount = 1000; // Total particle pool size

    // Particle pool
    const pool = useRef<Particle[]>(
        Array.from({ length: particleCount }).map(() => ({
            pos: new THREE.Vector3(0, 0, 0),
            vel: new THREE.Vector3(0, 0, 0),
            life: 0,
            maxLife: 1,
            size: 0.05 + Math.random() * 0.1,
            color: new THREE.Color(0, 1, 1)
        }))
    );

    // Track spawned effects
    const spawnedEffects = useRef<Set<number>>(new Set());

    // Create dissolve shader material
    const dissolveMaterial = useMemo(() => {
        return new THREE.ShaderMaterial({
            uniforms: {
                time: { value: 0 },
                dissolveAmount: { value: 0 },
                edgeColor: { value: new THREE.Color(0x00ffff) },
                edgeWidth: { value: 0.1 }
            },
            vertexShader: `
        varying vec3 vPosition;
        varying vec3 vNormal;
        
        void main() {
          vPosition = position;
          vNormal = normal;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
            fragmentShader: `
        uniform float time;
        uniform float dissolveAmount;
        uniform vec3 edgeColor;
        uniform float edgeWidth;
        
        varying vec3 vPosition;
        varying vec3 vNormal;
        
        // Simple noise function
        float noise(vec3 p) {
          return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453);
        }
        
        void main() {
          // Create noise pattern for dissolution
          float n = noise(vPosition * 8.0 + time * 0.5);
          
          // Dissolve based on noise
          if (n < dissolveAmount) {
            discard;
          }
          
          // Edge glow effect
          float edge = smoothstep(dissolveAmount, dissolveAmount + edgeWidth, n);
          vec3 color = mix(edgeColor * 3.0, edgeColor * 0.5, edge);
          
          gl_FragColor = vec4(color, edge * 0.8);
        }
      `,
            transparent: true,
            side: THREE.DoubleSide
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

    const particleMaterial = useMemo(() => {
        return new THREE.PointsMaterial({
            size: 0.15,
            vertexColors: true,
            transparent: true,
            opacity: 0.9,
            sizeAttenuation: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
    }, []);

    // Process trim effects
    const activeEffects = useMemo(() => {
        return trimEffects.map(effect => {
            const age = currentTick - effect.tick;
            const progress = Math.min(1, age / 45); // 0.75 seconds total

            return {
                ...effect,
                age,
                progress,
                dissolveAmount: progress * 1.2, // Faster dissolution
                shouldShowParticles: progress > 0.1, // Show particles early
                shouldSpawnParticles: age < 8 && age >= 0 // Spawn particles quickly
            };
        }).filter(effect => effect.age < 45);
    }, [trimEffects, currentTick]);

    // Spawn particles from trim effects
    useEffect(() => {
        activeEffects.forEach(effect => {
            if (!effect.shouldSpawnParticles) return;

            const effectId = effect.tick;
            if (spawnedEffects.current.has(effectId)) return;
            spawnedEffects.current.add(effectId);

            console.log(`🎆 HYBRID: Spawning particles for effect ${effectId}`);

            effect.trimmedPieces.forEach(piece => {
                const worldX = convertPosition(piece.x);
                const worldY = convertPosition(piece.y);
                const worldZ = convertPosition(piece.z ?? 0);
                const worldWidth = convertPosition(piece.width);
                const worldHeight = convertPosition(piece.height);
                const worldDepth = piece.depth !== undefined ? convertPosition(piece.depth) : worldWidth * 0.25;

                // More particles based on piece volume
                const volume = worldWidth * worldHeight * worldDepth;
                const numParticles = Math.min(200, Math.max(50, Math.floor(volume * 100))); // 50-200 particles per piece
                let spawned = 0;

                for (let i = 0; i < pool.current.length && spawned < numParticles; i++) {
                    const p = pool.current[i];
                    if (!p || p.life > 0) continue;

                    // Random position within piece
                    p.pos.set(
                        worldX + (Math.random() - 0.5) * worldWidth,
                        worldY + (Math.random() - 0.5) * worldHeight,
                        worldZ + (Math.random() - 0.5) * worldDepth
                    );

                    // Improved explosion physics - no upward movement
                    const force = 3 + Math.random() * 4;

                    // Create more realistic explosion pattern
                    const edgeDistance = Math.min(
                        Math.abs((p.pos.x - worldX) / (worldWidth * 0.5)),
                        Math.abs((p.pos.y - worldY) / (worldHeight * 0.5)),
                        Math.abs((p.pos.z - worldZ) / (worldDepth * 0.5))
                    );

                    const direction = new THREE.Vector3(
                        (Math.random() - 0.5) * 2,
                        -(Math.random() * 0.5 + 0.2), // Always downward
                        (Math.random() - 0.5) * 2
                    ).normalize();

                    // Stronger force for edge particles
                    const finalForce = force * (1 + edgeDistance);
                    p.vel.copy(direction).multiplyScalar(finalForce);

                    p.life = 1.5 + Math.random() * 1.0; // Shorter life for faster action
                    p.maxLife = p.life;
                    p.size = 0.1 + Math.random() * 0.2;

                    // Tron colors with more variety
                    const rand = Math.random();
                    if (rand < 0.2) {
                        p.color.setRGB(1, 0.4, 0); // Orange
                    } else if (rand < 0.4) {
                        p.color.setRGB(1, 1, 1); // White sparks
                    } else {
                        p.color.setRGB(0, 0.7 + Math.random() * 0.3, 1); // Cyan variations
                    }

                    spawned++;
                }

                console.log(`🎆 HYBRID: Spawned ${spawned} particles for piece volume ${volume.toFixed(2)}`);
            });
        });
    }, [activeEffects, convertPosition]);

    // Update shader uniforms and particles
    useFrame((state, delta) => {
        // Update dissolve shader
        if (dissolveMaterial.uniforms.time) {
            dissolveMaterial.uniforms.time.value = state.clock.elapsedTime;
        }

        // Update particles
        if (!particleGeometry.attributes.position || !particleGeometry.attributes.color || !particleGeometry.attributes.size) return;

        const positions = particleGeometry.attributes.position.array as Float32Array;
        const colors = particleGeometry.attributes.color.array as Float32Array;
        const sizes = particleGeometry.attributes.size.array as Float32Array;

        for (let i = 0; i < pool.current.length; i++) {
            const p = pool.current[i];
            if (!p) continue;

            const i3 = i * 3;

            if (p.life > 0) {
                // Update physics - much faster gravity and realistic motion
                p.life -= delta;
                p.vel.y -= 8.0 * delta; // Much stronger gravity for immediate fall
                p.vel.multiplyScalar(0.94); // More air resistance to prevent excessive speed
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
            {/* Dissolving geometry pieces */}
            {activeEffects.map((effect) => (
                <group key={`effect-${effect.tick}`}>
                    {effect.trimmedPieces.map((piece, pieceIndex) => {
                        const worldX = convertPosition(piece.x);
                        const worldY = convertPosition(piece.y);
                        const worldZ = convertPosition(piece.z ?? 0);
                        const worldWidth = convertPosition(piece.width);
                        const worldHeight = convertPosition(piece.height);
                        const worldDepth = piece.depth !== undefined ? convertPosition(piece.depth) : worldWidth * 0.25;

                        // Apply gravity to falling pieces
                        const fallDistance = effect.age * 0.2; // Faster falling
                        const currentY = worldY - fallDistance;

                        // Clone material with unique dissolve amount
                        const materialClone = dissolveMaterial.clone();
                        if (materialClone.uniforms.dissolveAmount) {
                            materialClone.uniforms.dissolveAmount.value = effect.dissolveAmount;
                        }

                        return (
                            <mesh
                                key={`piece-${pieceIndex}`}
                                position={[worldX, currentY, worldZ]}
                            >
                                <boxGeometry args={[worldWidth, worldHeight, worldDepth]} />
                                <primitive object={materialClone} />
                            </mesh>
                        );
                    })}
                </group>
            ))}

            {/* Explosive particles */}
            <points ref={pointsRef} geometry={particleGeometry} material={particleMaterial} />
        </group>
    );
};

export default TronHybridDisintegration;
