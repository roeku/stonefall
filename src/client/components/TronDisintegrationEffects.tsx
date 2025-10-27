import React, { useRef, useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { TrimEffect } from '../../shared/simulation';

// Enhanced noise function for more organic particle movement
function hash(n: number) {
    return Math.sin(n) * 43758.5453123 - Math.floor(Math.sin(n) * 43758.5453123);
}

function valueNoise3(x: number, y: number, z: number) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const zi = Math.floor(z);
    const xf = x - xi;
    const yf = y - yi;
    const zf = z - zi;

    // 8 corner samples
    const s000 = hash(xi + yi * 57 + zi * 113);
    const s100 = hash(xi + 1 + yi * 57 + zi * 113);
    const s010 = hash(xi + (yi + 1) * 57 + zi * 113);
    const s110 = hash(xi + 1 + (yi + 1) * 57 + zi * 113);
    const s001 = hash(xi + yi * 57 + (zi + 1) * 113);
    const s101 = hash(xi + 1 + yi * 57 + (zi + 1) * 113);
    const s011 = hash(xi + (yi + 1) * 57 + (zi + 1) * 113);
    const s111 = hash(xi + 1 + (yi + 1) * 57 + (zi + 1) * 113);

    // smoothstep interpolation
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const w = zf * zf * (3 - 2 * zf);

    // trilinear interpolation
    const a00 = s000 * (1 - u) + s100 * u;
    const a10 = s010 * (1 - u) + s110 * u;
    const a01 = s001 * (1 - u) + s101 * u;
    const a11 = s011 * (1 - u) + s111 * u;

    const b0 = a00 * (1 - v) + a10 * v;
    const b1 = a01 * (1 - v) + a11 * v;

    return b0 * (1 - w) + b1 * w;
}

interface Particle {
    pos: THREE.Vector3;
    vel: THREE.Vector3;
    life: number;
    maxLife: number;
    size: number;
    color: THREE.Color;
    rotationSpeed: number;
    rotation: number;
    opacity: number;
    fragmentType: 'cube' | 'shard' | 'spark';
    initialVelocity: THREE.Vector3;
}

interface Props {
    trimEffects: ReadonlyArray<TrimEffect>;
    convertPosition: (fixedValue: number) => number;
    currentTick: number;
}

/**
 * Tron: Legacy-style disintegration effects for trimmed block pieces.
 * Creates explosive particle effects with:
 * - Dramatic cyan/orange color scheme
 * - Electrical spark effects
 * - Organic turbulence movement
 * - Pulsing opacity for digital feel
 */
export const TronDisintegrationEffects: React.FC<Props> = ({
    trimEffects,
    convertPosition,
    currentTick
}) => {
    const groupRef = useRef<THREE.Group>(null);
    const particleCount = 300; // Reduced for better performance

    // Particle pool for reuse
    const pool = useRef<Particle[]>(
        Array.from({ length: particleCount }).map(() => ({
            pos: new THREE.Vector3(0, 0, 0),
            vel: new THREE.Vector3(0, 0, 0),
            life: 0,
            maxLife: 1,
            size: 0.02 + Math.random() * 0.08,
            color: new THREE.Color(),
            rotationSpeed: (Math.random() - 0.5) * 8,
            rotation: 0,
            opacity: 1,
            fragmentType: Math.random() < 0.6 ? 'cube' : (Math.random() < 0.8 ? 'shard' : 'spark'),
            initialVelocity: new THREE.Vector3()
        }))
    );

    // Track spawned effects to avoid duplicates
    const spawnedEffects = useRef<Set<number>>(new Set());

    // Geometry for different particle types
    const cubeGeometry = useMemo(() => new THREE.BoxGeometry(0.02, 0.02, 0.02), []);
    const shardGeometry = useMemo(() => {
        const geo = new THREE.ConeGeometry(0.01, 0.04, 4);
        return geo;
    }, []);
    const sparkGeometry = useMemo(() => new THREE.SphereGeometry(0.005, 4, 4), []);

    // Materials for different particle types
    const cubeMaterial = useMemo(() => new THREE.MeshStandardMaterial({
        color: 0x00ffff,
        transparent: true,
        opacity: 0.8,
        emissive: 0x003333,
        toneMapped: false
    }), []);

    const shardMaterial = useMemo(() => new THREE.MeshStandardMaterial({
        color: 0x0088ff,
        transparent: true,
        opacity: 0.9,
        emissive: 0x002244,
        toneMapped: false
    }), []);

    const sparkMaterial = useMemo(() => new THREE.MeshStandardMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 1.0,
        emissive: 0x4488ff,
        emissiveIntensity: 2.0,
        toneMapped: false
    }), []);

    // Track active effects and spawn particles
    const activeEffects = useMemo(() => {
        const effects = trimEffects.map(effect => {
            const age = currentTick - effect.tick;
            const progress = Math.min(1, age / 60); // 1 second total effect duration

            return {
                ...effect,
                age,
                progress,
                shouldSpawn: age < 15 && progress < 0.3 // Spawn particles quickly at the start
            };
        }).filter(effect => effect.age < 60);

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

    // Spawn particles from trim effects
    useEffect(() => {
        activeEffects.forEach(effect => {
            if (!effect.shouldSpawn) return;

            // Prevent duplicate spawning for the same effect
            const effectId = effect.tick;
            if (spawnedEffects.current.has(effectId)) return;
            spawnedEffects.current.add(effectId);

            effect.trimmedPieces.forEach(piece => {
                const worldX = convertPosition(piece.x);
                const worldY = convertPosition(piece.y);
                const worldZ = convertPosition(piece.z ?? 0);
                const worldWidth = convertPosition(piece.width);
                const worldHeight = convertPosition(piece.height);
                const worldDepth = piece.depth !== undefined ? convertPosition(piece.depth) : worldWidth * 0.25;

                // Calculate number of particles based on piece volume
                const volume = worldWidth * worldHeight * worldDepth;
                const particleCount = Math.min(150, Math.max(20, Math.floor(volume * 80)));

                console.log(`🎆 Spawning ${particleCount} particles for piece at (${worldX.toFixed(2)}, ${worldY.toFixed(2)}, ${worldZ.toFixed(2)})`);

                // Spawn particles throughout the piece volume
                let spawned = 0;
                for (let i = 0; i < pool.current.length && spawned < particleCount; i++) {
                    const p = pool.current[i];
                    if (!p || p.life > 0) continue;

                    // Random position within the piece
                    const px = worldX + (Math.random() - 0.5) * worldWidth;
                    const py = worldY + (Math.random() - 0.5) * worldHeight;
                    const pz = worldZ + (Math.random() - 0.5) * worldDepth;

                    p.pos.set(px, py, pz);

                    // Explosive velocity - stronger for pieces closer to edges
                    const edgeDistance = Math.min(
                        Math.abs(px - worldX) / (worldWidth * 0.5),
                        Math.abs(py - worldY) / (worldHeight * 0.5),
                        Math.abs(pz - worldZ) / (worldDepth * 0.5)
                    );

                    // More dramatic explosion force for Tron effect
                    const explosionForce = 5 + Math.random() * 8 + edgeDistance * 4;
                    const direction = new THREE.Vector3(
                        (Math.random() - 0.5) * 2,
                        Math.random() * 0.8 + 0.3, // More upward bias for dramatic effect
                        (Math.random() - 0.5) * 2
                    ).normalize();

                    p.vel.copy(direction).multiplyScalar(explosionForce);
                    p.initialVelocity.copy(p.vel);

                    // Particle properties - longer life for more dramatic effect
                    p.life = 2.0 + Math.random() * 1.5;
                    p.maxLife = p.life;
                    p.size = 0.02 + Math.random() * 0.06;
                    p.rotationSpeed = (Math.random() - 0.5) * 15;
                    p.rotation = Math.random() * Math.PI * 2;
                    p.opacity = 0.9 + Math.random() * 0.1;

                    // Tron-style color variation - more dramatic cyan/orange contrast
                    const rand = Math.random();
                    if (rand < 0.15) {
                        // Bright white/blue sparks
                        p.color.setRGB(0.8 + Math.random() * 0.2, 0.9 + Math.random() * 0.1, 1);
                        p.fragmentType = 'spark';
                    } else if (rand < 0.4) {
                        // Bright cyan (classic Tron)
                        p.color.setRGB(0, 0.8 + Math.random() * 0.2, 1);
                        p.fragmentType = 'cube';
                    } else if (rand < 0.6) {
                        // Orange accents (Tron Legacy style)
                        p.color.setRGB(1, 0.3 + Math.random() * 0.4, 0);
                        p.fragmentType = 'shard';
                    } else {
                        // Deep blue variations
                        p.color.setRGB(0, 0.2 + Math.random() * 0.4, 0.8 + Math.random() * 0.2);
                        p.fragmentType = Math.random() < 0.7 ? 'cube' : 'shard';
                    }

                    spawned++;
                }

                console.log(`🎆 Actually spawned ${spawned} particles`);
            });
        });
    }, [activeEffects, convertPosition]);

    // Update particles
    useFrame((state, delta) => {
        const now = state.clock.getElapsedTime();

        for (let i = 0; i < pool.current.length; i++) {
            const p = pool.current[i];
            if (!p || p.life <= 0) continue;

            // Age the particle
            p.life -= delta;
            const lifeRatio = p.life / p.maxLife;

            // Physics update with enhanced Tron-style effects
            // Add noise-based turbulence for organic movement
            const turbulence = 0.8;
            const nx = valueNoise3(p.pos.x * 3 + now * 2, p.pos.y * 3, p.pos.z * 3) * turbulence;
            const ny = valueNoise3(p.pos.x * 3, p.pos.y * 3 + now * 2, p.pos.z * 3) * turbulence;
            const nz = valueNoise3(p.pos.x * 3, p.pos.y * 3, p.pos.z * 3 + now * 2) * turbulence;

            p.vel.x += nx * delta;
            p.vel.y += ny * delta - 1.5 * delta; // Reduced gravity for more floating effect
            p.vel.z += nz * delta;

            // Less air resistance for more dramatic trails
            p.vel.multiplyScalar(0.985);

            // Add some electrical-style jitter for sparks
            if (p.fragmentType === 'spark') {
                const jitter = 0.2;
                p.vel.x += (Math.random() - 0.5) * jitter;
                p.vel.y += (Math.random() - 0.5) * jitter;
                p.vel.z += (Math.random() - 0.5) * jitter;
            }

            // Update position
            p.pos.addScaledVector(p.vel, delta);

            // Update rotation
            p.rotation += p.rotationSpeed * delta;

            // Update opacity with pulsing effect for Tron style
            const pulse = 0.8 + 0.2 * Math.sin(now * 8 + i * 0.1);
            p.opacity = Math.max(0, lifeRatio * 0.9 * pulse);
        }
    });

    // Use instanced rendering for better performance
    const instancedMeshes = useMemo(() => {
        const cubes: React.ReactElement[] = [];
        const shards: React.ReactElement[] = [];
        const sparks: React.ReactElement[] = [];

        // Pre-create a reasonable number of mesh instances
        for (let i = 0; i < 50; i++) {
            cubes.push(
                <mesh
                    key={`cube-${i}`}
                    geometry={cubeGeometry}
                    material={cubeMaterial}
                    visible={false}
                />
            );
            shards.push(
                <mesh
                    key={`shard-${i}`}
                    geometry={shardGeometry}
                    material={shardMaterial}
                    visible={false}
                />
            );
            sparks.push(
                <mesh
                    key={`spark-${i}`}
                    geometry={sparkGeometry}
                    material={sparkMaterial}
                    visible={false}
                />
            );
        }

        return { cubes, shards, sparks };
    }, [cubeGeometry, shardGeometry, sparkGeometry, cubeMaterial, shardMaterial, sparkMaterial]);

    // Update mesh positions and visibility
    useFrame(() => {
        if (!groupRef.current) return;

        const meshes = groupRef.current.children as THREE.Mesh[];
        let cubeIndex = 0;
        let shardIndex = 0;
        let sparkIndex = 0;

        // Hide all meshes first
        meshes.forEach(mesh => {
            mesh.visible = false;
        });

        // Update visible particles
        pool.current.forEach((p) => {
            if (p.life <= 0) return;

            let meshIndex = 0;
            if (p.fragmentType === 'cube' && cubeIndex < 50) {
                meshIndex = cubeIndex++;
            } else if (p.fragmentType === 'shard' && shardIndex < 50) {
                meshIndex = 50 + shardIndex++; // Offset for shards
            } else if (p.fragmentType === 'spark' && sparkIndex < 50) {
                meshIndex = 100 + sparkIndex++; // Offset for sparks
            } else {
                return; // Skip if we've run out of mesh instances
            }

            if (meshIndex < meshes.length) {
                const mesh = meshes[meshIndex];
                if (mesh) {
                    mesh.visible = true;
                    mesh.position.set(p.pos.x, p.pos.y, p.pos.z);
                    mesh.rotation.set(p.rotation, p.rotation * 0.7, p.rotation * 1.3);

                    const scale = p.size * (0.5 + (p.life / p.maxLife) * 0.5);
                    mesh.scale.set(scale, scale, scale);

                    // Update material properties
                    const material = mesh.material as THREE.MeshStandardMaterial;
                    if (material) {
                        material.opacity = p.opacity;
                        material.color.copy(p.color);

                        if (p.fragmentType === 'spark') {
                            material.emissiveIntensity = 1 + Math.sin(p.rotation * 4) * 0.5;
                        }
                    }
                }
            }
        });
    });

    return (
        <group ref={groupRef}>
            {instancedMeshes.cubes}
            {instancedMeshes.shards}
            {instancedMeshes.sparks}
        </group>
    );
};

export default TronDisintegrationEffects;
