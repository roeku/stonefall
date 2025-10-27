// Particle effects for tower rising/sinking animations
import React, { useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface TowerEmergenceEffectsProps {
    position: [number, number, number];
    type: 'rising' | 'sinking';
    active: boolean;
    onComplete?: () => void;
}

export const TowerEmergenceEffects: React.FC<TowerEmergenceEffectsProps> = ({
    position,
    type,
    active,
    onComplete
}) => {
    const particlesRef = useRef<THREE.Points>(null);
    const startTimeRef = useRef(0);
    const particleCount = 50;
    const duration = 2.0;

    // Initialize particles
    const particleGeometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const velocities = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);

    useEffect(() => {
        if (active) {
            startTimeRef.current = performance.now();

            // Initialize particle positions and velocities
            for (let i = 0; i < particleCount; i++) {
                const i3 = i * 3;

                // Random positions around tower base
                const angle = Math.random() * Math.PI * 2;
                const radius = Math.random() * 3 + 1;

                positions[i3] = Math.cos(angle) * radius;
                positions[i3 + 1] = type === 'rising' ? -2 : 2; // Start below/above ground
                positions[i3 + 2] = Math.sin(angle) * radius;

                // Velocities
                if (type === 'rising') {
                    velocities[i3] = (Math.random() - 0.5) * 2;
                    velocities[i3 + 1] = Math.random() * 3 + 2; // Upward
                    velocities[i3 + 2] = (Math.random() - 0.5) * 2;
                } else {
                    velocities[i3] = (Math.random() - 0.5) * 1;
                    velocities[i3 + 1] = -(Math.random() * 2 + 1); // Downward
                    velocities[i3 + 2] = (Math.random() - 0.5) * 1;
                }

                // TRON colors - cyan for rising, orange for sinking
                const color = type === 'rising' ? new THREE.Color('#00f2fe') : new THREE.Color('#ff6600');
                colors[i3] = color.r;
                colors[i3 + 1] = color.g;
                colors[i3 + 2] = color.b;
            }

            particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            particleGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        }
    }, [active, type]);

    useFrame(() => {
        if (!active || !particlesRef.current) return;

        const elapsed = (performance.now() - startTimeRef.current) / 1000;
        if (elapsed >= duration) {
            onComplete?.();
            return;
        }

        const progress = elapsed / duration;
        const positions = particleGeometry.attributes.position.array as Float32Array;
        const colors = particleGeometry.attributes.color.array as Float32Array;

        for (let i = 0; i < particleCount; i++) {
            const i3 = i * 3;

            // Update positions
            positions[i3] += velocities[i3] * 0.016; // ~60fps
            positions[i3 + 1] += velocities[i3 + 1] * 0.016;
            positions[i3 + 2] += velocities[i3 + 2] * 0.016;

            // Fade out particles over time
            const alpha = 1 - progress;
            colors[i3] *= alpha;
            colors[i3 + 1] *= alpha;
            colors[i3 + 2] *= alpha;

            // Add some gravity/drag
            velocities[i3 + 1] -= 0.1;
            velocities[i3] *= 0.98;
            velocities[i3 + 2] *= 0.98;
        }

        particleGeometry.attributes.position.needsUpdate = true;
        particleGeometry.attributes.color.needsUpdate = true;
    });

    if (!active) return null;

    return (
        <group position={position}>
            <points ref={particlesRef} geometry={particleGeometry}>
                <pointsMaterial
                    size={0.1}
                    vertexColors
                    transparent
                    opacity={0.8}
                    blending={THREE.AdditiveBlending}
                />
            </points>

            {/* Ground impact ring for rising towers */}
            {type === 'rising' && (
                <mesh position={[0, 0.1, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                    <ringGeometry args={[2, 4, 16]} />
                    <meshBasicMaterial
                        color="#00f2fe"
                        transparent
                        opacity={0.3}
                        blending={THREE.AdditiveBlending}
                    />
                </mesh>
            )}

            {/* Sinking vortex effect */}
            {type === 'sinking' && (
                <mesh position={[0, -0.5, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                    <ringGeometry args={[1, 3, 16]} />
                    <meshBasicMaterial
                        color="#ff6600"
                        transparent
                        opacity={0.4}
                        blending={THREE.AdditiveBlending}
                    />
                </mesh>
            )}
        </group>
    );
};
