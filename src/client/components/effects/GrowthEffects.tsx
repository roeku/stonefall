import React, { useRef, useMemo, useLayoutEffect } from 'react';
import * as THREE from 'three';
import { GrowthEffect } from '../../shared/simulation';

interface GrowthEffectsProps {
    growthEffects: ReadonlyArray<GrowthEffect>;
    convertPosition: (fixedValue: number) => number;
    currentTick: number;
}

const GrowthEffectItem: React.FC<{
    effect: GrowthEffect;
    convertPosition: (v: number) => number;
    currentTick: number;
}> = ({ effect, convertPosition, currentTick }) => {
    const age = currentTick - effect.tick;
    if (age > 60) return null;

    const { x, y, z, width, height, depth } = useMemo(() => ({
        x: convertPosition(effect.block.x),
        y: convertPosition(effect.block.y),
        z: convertPosition(effect.block.z ?? 0),
        width: convertPosition(effect.block.width),
        height: convertPosition(effect.block.height),
        depth: convertPosition(effect.block.depth ?? effect.block.width),
    }), [effect, convertPosition]);

    const argsOuter = useMemo(() => [width * 1.05, height * 1.05, depth * 1.05] as [number, number, number], [width, height, depth]);
    const argsInner = useMemo(() => [width, height, depth] as [number, number, number], [width, height, depth]);

    const opacity = Math.max(0, 1 - age / 40);

    const outerMatRef = useRef<THREE.MeshBasicMaterial>(null);
    const innerMatRef = useRef<THREE.MeshBasicMaterial>(null);

    useLayoutEffect(() => {
        if (outerMatRef.current) outerMatRef.current.opacity = opacity;
        if (innerMatRef.current) innerMatRef.current.opacity = opacity * 0.3;
    }, [opacity]);

    return (
        <group position={[x, y + height / 2, z]}>
            {/* Glowing wireframe box */}
            <mesh>
                <boxGeometry args={argsOuter} />
                <meshBasicMaterial
                    ref={outerMatRef}
                    color="#00ff00"
                    wireframe
                    transparent
                    depthTest={false}
                />
            </mesh>
            {/* Inner glow */}
            <mesh>
                <boxGeometry args={argsInner} />
                <meshBasicMaterial
                    ref={innerMatRef}
                    color="#00ff00"
                    transparent
                    depthTest={false}
                    blending={THREE.AdditiveBlending}
                />
            </mesh>
        </group>
    );
};

export const GrowthEffects: React.FC<GrowthEffectsProps> = ({
    growthEffects,
    convertPosition,
    currentTick
}) => {
    return (
        <group>
            {growthEffects.map((effect, index) => (
                <GrowthEffectItem
                    key={`${effect.tick}-${index}`}
                    effect={effect}
                    convertPosition={convertPosition}
                    currentTick={currentTick}
                />
            ))}
        </group>
    );
};
