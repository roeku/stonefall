import React, { useMemo } from 'react';
import { TrimEffect } from '../../shared/simulation';

interface VaporParticlesProps {
    trimEffects: ReadonlyArray<TrimEffect>;
    convertPosition: (fixedValue: number) => number;
    currentTick: number;
}

export const VaporParticles: React.FC<VaporParticlesProps> = ({ trimEffects, convertPosition, currentTick }) => {
    const particles = useMemo(() => {
        const list: { x: number; y: number; z: number; size: number; age: number }[] = [];

        trimEffects.forEach((effect) => {
            const age = currentTick - effect.tick;
            if (age < 0 || age > 60) return;

            effect.trimmedPieces.forEach((piece) => {
                const px = convertPosition(piece.x);
                const py = convertPosition(piece.y);
                const count = Math.max(6, Math.round(convertPosition(piece.width) * 0.4));
                for (let i = 0; i < count; i++) {
                    list.push({
                        x: px + (Math.random() - 0.5) * convertPosition(piece.width),
                        y: py + (Math.random() - 0.5) * convertPosition(piece.height),
                        z: (Math.random() - 0.5) * 1.2,
                        size: 0.02 + Math.random() * 0.06,
                        age,
                    });
                }
            });
        });

        return list;
    }, [trimEffects, convertPosition, currentTick]);

    if (!particles.length) return null;

    return (
        <group>
            {particles.map((p, i) => (
                <mesh key={`v-${i}`} position={[p.x, p.y, p.z]}>
                    <sphereGeometry args={[p.size, 6, 6]} />
                    <meshBasicMaterial color="#66ffff" transparent opacity={Math.max(0.05, 1 - p.age / 60)} depthWrite={false} />
                </mesh>
            ))}
        </group>
    );
};
