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
    rotation: number;
    rotationSpeed: number;
}

interface Props {
    trimEffects: ReadonlyArray<TrimEffect>;
    convertPosition: (fixedValue: number) => number;
    currentTick: number;
}

/**
 * Authentic Tron: Legacy disintegration - pure particle system
 * Digital matter breaks into geometric fragments and energy streams
 */
export const TronLegacyDisintegration: React.FC<Props> = ({
    trimEffects,
    convertPosition,
    currentTick
}) => {
    const groupRef = useRef<THREE.Group>(null);
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
            type: 'fragment',
            rotation: 0,
            rotationSpeed: 0
        }))
    );

    // Track spawned effects
    const spawnedEffects = useRef<Set<number>>(new Set());

    // Create geometries for different particle types
    const fragmentGeometry = useMemo(() => new THREE.BoxGeometry(0.03, 0.03, 0.03), []);
    const energyGeometry = useMemo(() => new THREE.SphereGeometry(0.015, 6, 6), []);
    const sparkGeometry = useMemo(() => new THREE.SphereGeometry(0.008, 4, 4), []);

    // Create materials with Tron: Legacy colors
    const fragmentMaterial = useMemo(() => new THREE.MeshBasicMaterial({
        color: 0x00ffff,
        transparent: true,
        opacity: 0.9,
        toneMapped: false
    }), []);

    const energyMaterial = useMemo(() => new THREE.MeshBasicMaterial({
        color: 0x00aaff,
        transparent: true,
        opacity: 0.8,
        toneMapped: false
    }), []);

    const sparkMaterial = useMemo(() => new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 1.0,
        toneMapped: false
    }), []);

    // Track active effects
    const activeEffects = useMemo(() => {
        return trimEffects.map(effect => {
            const age = currentTick - effect.tick;
            return {
                ...effect,
                age,
                shouldSpawn: age < 3 && age >= 0 // Quick spawn window
            };
        }).filter(effect => effect.age < 90); // 1.5 seconds total
    }, [trimEffects, currentTick]);

    // Spawn particles with Tron: Legacy style
    useEffect(() => {
        activeEffects.forEach(effect => {
            if (!effect.shouldSpawn) return;

            const effectId = effect.tick;
            if (spawnedEffects.current.has(effectId)) return;
            spawnedEffects.current.add(effectId);

            console.log(`⚡ TRON: Spawning disintegration for effect ${effectId}`);

            effect.trimmedPieces.forEach(piece => {
                const worldX = convertPosition(piece.x);
                const worldY = convertPosition(piece.y);
                const worldZ = convertPosition(piece.z ?? 0);
                const worldWidth = convertPosition(piece.width);
                const worldHeight = convertPosition(piece.height);
                const worldDepth = piece.depth !== undefined ? convertPosition(piece.depth) : worldWidth * 0.25;

                // Calculate particles based on surface area (like digital matter breaking apart)
                const surfaceArea = 2 * (worldWidth * worldHeight + worldWidth * worldDepth + worldHeight * worldDepth);
                const numParticles = Math.min(300, Math.max(80, Math.floor(surfaceArea * 50)));
                let spawned = 0;

                for (let i = 0; i < pool.current.length && spawned < numParticles; i++) {
                    const p = pool.current[i];
                    if (!p || p.life > 0) continue;

                    // Spawn particles on the surface of the piece (like digital matter breaking apart)
                    const surface = Math.floor(Math.random() * 6); // 6 faces of a cube
                    let px, py, pz;

                    switch (surface) {
                        case 0: // Top face
                            px = worldX + (Math.random() - 0.5) * worldWidth;
                            py = worldY + worldHeight * 0.5;
                            pz = worldZ + (Math.random() - 0.5) * worldDepth;
                            break;
                        case 1: // Bottom face
                            px = worldX + (Math.random() - 0.5) * worldWidth;
                            py = worldY - worldHeight * 0.5;
                            pz = worldZ + (Math.random() - 0.5) * worldDepth;
                            break;
                        case 2: // Front face
                            px = worldX + (Math.random() - 0.5) * worldWidth;
                            py = worldY + (Math.random() - 0.5) * worldHeight;
                            pz = worldZ + worldDepth * 0.5;
                            break;
                        case 3: // Back face
                            px = worldX + (Math.random() - 0.5) * worldWidth;
                            py = worldY + (Math.random() - 0.5) * worldHeight;
                            pz = worldZ - worldDepth * 0.5;
                            break;
                        case 4: // Right face
                            px = worldX + worldWidth * 0.5;
                            py = worldY + (Math.random() - 0.5) * worldHeight;
                            pz = worldZ + (Math.random() - 0.5) * worldDepth;
                            break;
                        default: // Left face
                            px = worldX - worldWidth * 0.5;
                            py = worldY + (Math.random() - 0.5) * worldHeight;
                            pz = worldZ + (Math.random() - 0.5) * worldDepth;
                            break;
                    }

                    p.pos.set(px, py, pz);

                    // Tron: Legacy style - particles stream outward from surfaces
                    const outwardForce = 2 + Math.random() * 3;
                    const streamDirection = new THREE.Vector3(
                        px - worldX, // Outward from center
                        py - worldY,
                        pz - worldZ
                    ).normalize();

                    // Add some randomness but keep the streaming effect
                    streamDirection.x += (Math.random() - 0.5) * 0.3;
                    streamDirection.y += (Math.random() - 0.5) * 0.3;
                    streamDirection.z += (Math.random() - 0.5) * 0.3;
                    streamDirection.normalize();

                    p.vel.copy(streamDirection).multiplyScalar(outwardForce);

                    // Particle properties
                    p.life = 2.0 + Math.random() * 1.5;
                    p.maxLife = p.life;
                    p.rotation = Math.random() * Math.PI * 2;
                    p.rotationSpeed = (Math.random() - 0.5) * 4;

                    // Tron: Legacy particle types and colors
                    const rand = Math.random();
                    if (rand < 0.6) {
                        // Digital fragments (main effect)
                        p.type = 'fragment';
                        p.size = 0.02 + Math.random() * 0.04;
                        p.color.setRGB(0, 0.8 + Math.random() * 0.2, 1); // Bright cyan
                    } else if (rand < 0.85) {
                        // Energy streams
                        p.type = 'energy';
                        p.size = 0.015 + Math.random() * 0.025;
                        p.color.setRGB(0, 0.6 + Math.random() * 0.4, 0.9 + Math.random() * 0.1); // Blue energy
                    } else {
                        // Bright sparks
                        p.type = 'spark';
                        p.size = 0.008 + Math.random() * 0.012;
                        p.color.setRGB(0.9 + Math.random() * 0.1, 0.9 + Math.random() * 0.1, 1); // White/blue sparks
                    }

                    spawned++;
                }

                console.log(`⚡ TRON: Spawned ${spawned} particles for surface area ${surfaceArea.toFixed(2)}`);
            });
        });
    }, [activeEffects, convertPosition]);

    // Update particles with Tron: Legacy physics
    useFrame((state, delta) => {
        const time = state.clock.elapsedTime;

        for (let i = 0; i < pool.current.length; i++) {
            const p = pool.current[i];
            if (!p || p.life <= 0) continue;

            // Age particle
            p.life -= delta;
            const lifeRatio = p.life / p.maxLife;

            // Tron: Legacy physics - energy streams with some gravity
            if (p.type === 'energy') {
                // Energy particles have flowing motion
                p.vel.y -= 1.5 * delta; // Light gravity
                p.vel.multiplyScalar(0.98); // Slight air resistance

                // Add energy flow effect
                const flow = Math.sin(time * 3 + i * 0.1) * 0.1;
                p.vel.x += flow * delta;
                p.vel.z += flow * delta;
            } else if (p.type === 'fragment') {
                // Fragments fall with more gravity
                p.vel.y -= 4.0 * delta;
                p.vel.multiplyScalar(0.95);
            } else {
                // Sparks have erratic movement
                p.vel.y -= 2.0 * delta;
                p.vel.multiplyScalar(0.97);

                // Add spark jitter
                const jitter = 0.5;
                p.vel.x += (Math.random() - 0.5) * jitter * delta;
                p.vel.z += (Math.random() - 0.5) * jitter * delta;
            }

            // Update position
            p.pos.addScaledVector(p.vel, delta);

            // Update rotation
            p.rotation += p.rotationSpeed * delta;
        }
    });

    // Render particles as individual meshes for authentic Tron look
    const renderParticles = () => {
        const elements: React.ReactElement[] = [];

        pool.current.forEach((p, i) => {
            if (p.life <= 0) return;

            const lifeRatio = p.life / p.maxLife;
            const scale = p.size * (0.3 + lifeRatio * 0.7); // Fade out by shrinking

            let geometry, material;
            switch (p.type) {
                case 'fragment':
                    geometry = fragmentGeometry;
                    material = fragmentMaterial.clone();
                    break;
                case 'energy':
                    geometry = energyGeometry;
                    material = energyMaterial.clone();
                    break;
                default:
                    geometry = sparkGeometry;
                    material = sparkMaterial.clone();
                    break;
            }

            // Update material properties
            material.opacity = lifeRatio * (p.type === 'spark' ? 1.0 : 0.9);
            material.color.copy(p.color);

            elements.push(
                <mesh
                    key={`tron-particle-${i}`}
                    position={[p.pos.x, p.pos.y, p.pos.z]}
                    rotation={[p.rotation, p.rotation * 0.7, p.rotation * 1.3]}
                    scale={[scale, scale, scale]}
                    geometry={geometry}
                    material={material}
                />
            );
        });

        return elements;
    };

    return (
        <group ref={groupRef}>
            {renderParticles()}
        </group>
    );
};

export default TronLegacyDisintegration;
