import React from 'react';
import * as THREE from 'three';
import { GameState } from '../../shared/simulation';

interface DebugWireframeProps {
    gameState: GameState | null;
    convertPosition: (fixedValue: number) => number;
    enabled?: boolean;
}

/**
 * Debug wireframe component to visualize block boundaries and help debug energy segment positioning
 */
export const DebugWireframe: React.FC<DebugWireframeProps> = ({
    gameState,
    convertPosition,
    enabled = false
}) => {
    if (!enabled || !gameState?.blocks) return null;

    return (
        <group>
            {gameState.blocks.map((block, index) => {
                // Convert block properties to Three.js units using same logic as GameBlock
                const x = convertPosition(block.x);
                const y = convertPosition(block.y + block.height / 2);
                const z = convertPosition(block.z ?? 0);
                const width = convertPosition(block.width);
                const height = convertPosition(block.height);
                const depth = convertPosition(block.depth ?? block.width);

                return (
                    <group key={`debug-wireframe-${index}`} position={[x, y, z]}>
                        {/* Main wireframe outline */}
                        <mesh>
                            <boxGeometry args={[width, height, depth]} />
                            <meshBasicMaterial
                                color="#00ff00"
                                wireframe={true}
                                transparent={true}
                                opacity={0.8}
                            />
                        </mesh>

                        {/* Edge highlights for better visibility */}
                        <lineSegments>
                            <edgesGeometry args={[new THREE.BoxGeometry(width, height, depth)]} />
                            <lineBasicMaterial color="#ffff00" linewidth={2} />
                        </lineSegments>

                        {/* Block index label for identification */}
                        <mesh position={[0, height / 2 + 0.2, 0]}>
                            <planeGeometry args={[0.5, 0.3]} />
                            <meshBasicMaterial
                                color="#ffffff"
                                transparent={true}
                                opacity={0.9}
                            />
                        </mesh>

                        {/* Corner markers to show exact block boundaries */}
                        {[
                            // Bottom corners
                            [-width / 2, -height / 2, -depth / 2],
                            [width / 2, -height / 2, -depth / 2],
                            [-width / 2, -height / 2, depth / 2],
                            [width / 2, -height / 2, depth / 2],
                            // Top corners
                            [-width / 2, height / 2, -depth / 2],
                            [width / 2, height / 2, -depth / 2],
                            [-width / 2, height / 2, depth / 2],
                            [width / 2, height / 2, depth / 2],
                        ].map((pos, cornerIndex) => (
                            <mesh key={cornerIndex} position={pos}>
                                <sphereGeometry args={[0.05, 8, 8]} />
                                <meshBasicMaterial color="#ff0000" />
                            </mesh>
                        ))}

                        {/* Center marker */}
                        <mesh>
                            <sphereGeometry args={[0.08, 8, 8]} />
                            <meshBasicMaterial color="#0000ff" />
                        </mesh>
                    </group>
                );
            })}
        </group>
    );
};
