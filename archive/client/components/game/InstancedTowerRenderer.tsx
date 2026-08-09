/**
 * Instanced Tower Renderer
 * 
 * High-performance tower rendering using GPU instancing.
 * Reduces thousands of draw calls to just a few.
 */

import React, { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { TowerMapEntry } from '../../../shared/types/api';

interface InstancedTowerRendererProps {
    towers: TowerMapEntry[];
    playerTowerSessionId?: string | null;
    selectedTowerSessionId?: string | null;
    hasSelectedTower?: boolean;
    onTowerClick?: (tower: TowerMapEntry, position: [number, number, number], rank?: number) => void;
}

interface BlockInstance {
    matrix: THREE.Matrix4;
    color: THREE.Color;
    edgeColor: THREE.Color;
    towerIndex: number;
    blockIndex: number;
    isPlayerTower: boolean;
    isSelected: boolean;
    isTopFive: boolean;
}

/**
 * Instanced renderer for all tower blocks
 * Uses a single draw call for all blocks of the same type
 */
export const InstancedTowerRenderer: React.FC<InstancedTowerRendererProps> = ({
    towers,
    playerTowerSessionId,
    selectedTowerSessionId,
    hasSelectedTower,
    onTowerClick,
}) => {
    const blockMeshRef = useRef<THREE.InstancedMesh>(null);
    const edgeMeshRef = useRef<THREE.LineSegments>(null);

    // Pre-calculate all block instances
    const blockInstances = useMemo(() => {
        const instances: BlockInstance[] = [];
        const tempMatrix = new THREE.Matrix4();
        const tempPosition = new THREE.Vector3();
        const tempRotation = new THREE.Euler();
        const tempScale = new THREE.Vector3();

        towers.forEach((tower, towerIndex) => {
            const isPlayerTower = tower.sessionId === playerTowerSessionId;
            const isSelected = tower.sessionId === selectedTowerSessionId;
            const rank = towerIndex; // Assuming towers are pre-sorted by rank
            const isTopFive = rank < 5;

            // Calculate tower world position
            const towerWorldPos = new THREE.Vector3(
                tower.worldX ?? 0,
                0,
                tower.worldZ ?? 0
            );

            tower.towerBlocks.forEach((block, blockIndex) => {
                // Convert fixed-point to float
                const blockX = block.x / 1000;
                const blockY = block.y / 1000;
                const blockZ = (block.z || 0) / 1000;
                const width = block.width / 1000;
                const height = block.height / 1000;
                const depth = (block.depth || block.width) / 1000;
                const rotation = ((block.rotation || 0) / 1000) * (Math.PI / 180);

                // World position
                tempPosition.set(
                    towerWorldPos.x + blockX,
                    blockY + height / 2, // Center on Y
                    towerWorldPos.z + blockZ
                );

                // Rotation
                tempRotation.set(0, rotation, 0);

                // Scale
                tempScale.set(width, height, depth);

                // Build matrix
                tempMatrix.compose(tempPosition, new THREE.Quaternion().setFromEuler(tempRotation), tempScale);

                // Determine colors
                const baseColor = new THREE.Color('#0a0a0a');
                let edgeColor: THREE.Color;

                if (isSelected) {
                    edgeColor = new THREE.Color('#ffffff');
                } else if (isPlayerTower) {
                    edgeColor = new THREE.Color('#00f2fe');
                } else if (isTopFive && !hasSelectedTower) {
                    edgeColor = new THREE.Color('#ffff00');
                } else {
                    edgeColor = new THREE.Color('#333333');
                }

                instances.push({
                    matrix: tempMatrix.clone(),
                    color: baseColor.clone(),
                    edgeColor: edgeColor.clone(),
                    towerIndex,
                    blockIndex,
                    isPlayerTower,
                    isSelected,
                    isTopFive,
                });
            });
        });

        return instances;
    }, [towers, playerTowerSessionId, selectedTowerSessionId, hasSelectedTower]);

    // Update instanced mesh
    useEffect(() => {
        const mesh = blockMeshRef.current;
        if (!mesh || blockInstances.length === 0) return;

        // Update instance count if needed
        if (mesh.count !== blockInstances.length) {
            mesh.count = blockInstances.length;
        }

        // Update matrices and colors
        blockInstances.forEach((instance, i) => {
            mesh.setMatrixAt(i, instance.matrix);
            mesh.setColorAt(i, instance.color);
        });

        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) {
            mesh.instanceColor.needsUpdate = true;
        }
    }, [blockInstances]);

    // Animate player tower beacons
    useFrame((state) => {
        // Future: Add beacon animation here
    });

    // Maximum instance count (pre-allocate)
    const maxInstances = useMemo(() => {
        return Math.max(1000, blockInstances.length);
    }, [blockInstances.length]);

    return (
        <group>
            {/* Instanced blocks - single draw call */}
            <instancedMesh
                ref={blockMeshRef}
                args={[undefined, undefined, maxInstances]}
                frustumCulled={true}
                castShadow={false}
                receiveShadow={false}
            >
                <boxGeometry args={[1, 1, 1]} />
                <meshStandardMaterial
                    color="#0a0a0a"
                    roughness={0.2}
                    metalness={0.65}
                    emissive="#00f2fe"
                    emissiveIntensity={0.1}
                    toneMapped={false}
                    vertexColors={true}
                />
            </instancedMesh>

            {/* Edge glow rendering - we'll optimize this next */}
            {blockInstances.map((instance, i) => (
                <InstancedEdges
                    key={i}
                    matrix={instance.matrix}
                    edgeColor={instance.edgeColor}
                    isSelected={instance.isSelected}
                    isTopFive={instance.isTopFive}
                />
            ))}
        </group>
    );
};

/**
 * Optimized edge rendering for a single block instance
 * TODO: This will be further optimized with instanced line rendering
 */
interface InstancedEdgesProps {
    matrix: THREE.Matrix4;
    edgeColor: THREE.Color;
    isSelected: boolean;
    isTopFive: boolean;
}

const InstancedEdges: React.FC<InstancedEdgesProps> = ({
    matrix,
    edgeColor,
    isSelected,
    isTopFive,
}) => {
    const groupRef = useRef<THREE.Group>(null);

    useEffect(() => {
        if (groupRef.current) {
            groupRef.current.applyMatrix4(matrix);
        }
    }, [matrix]);

    // Only render edges for selected or top five towers
    if (!isSelected && !isTopFive) {
        return null;
    }

    return (
        <group ref={groupRef}>
            <lineSegments>
                <edgesGeometry args={[new THREE.BoxGeometry(1, 1, 1)]} />
                <lineBasicMaterial
                    color={edgeColor}
                    opacity={0.8}
                    transparent
                    toneMapped={false}
                />
            </lineSegments>
        </group>
    );
};
