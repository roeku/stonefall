import React, { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { TowerBlock } from '../../shared/types/api';
import { calculateTowerStats } from '../../shared/utils/gameDataConverter';

interface TowerVisualizationProps {
    towerBlocks: TowerBlock[];
    width?: number;
    height?: number;
    showStats?: boolean;
    interactive?: boolean;
}

interface BlockMeshProps {
    block: TowerBlock;
    color?: string;
}

const BlockMesh: React.FC<BlockMeshProps> = ({ block, color = '#4a9eff' }) => {
    const meshRef = useRef<any>(null);

    useFrame(() => {
        if (meshRef.current) {
            // Optional: Add subtle animation
            meshRef.current.rotation.y += 0.001;
        }
    });

    // Convert fixed-point coordinates to display coordinates
    const displayX = block.x / 1000;
    const displayY = block.y / 1000;
    const displayZ = (block.z || 0) / 1000;
    const displayWidth = block.width / 1000;
    const displayHeight = block.height / 1000;
    const displayDepth = (block.depth || block.width) / 1000;

    return (
        <mesh
            ref={meshRef}
            position={[displayX, displayY + displayHeight / 2, displayZ]}
            rotation={[0, (block.rotation || 0) / 1000, 0]}
        >
            <boxGeometry args={[displayWidth, displayHeight, displayDepth]} />
            <meshStandardMaterial
                color={color}
                transparent
                opacity={0.8}
                roughness={0.3}
                metalness={0.1}
            />
            <lineSegments>
                <edgesGeometry attach="geometry" args={[new THREE.BoxGeometry(displayWidth, displayHeight, displayDepth)]} />
                <lineBasicMaterial attach="material" color="#ffffff" opacity={0.3} transparent />
            </lineSegments>
        </mesh>
    );
};

const TowerScene: React.FC<{ towerBlocks: TowerBlock[] }> = ({ towerBlocks }) => {
    const stats = calculateTowerStats(towerBlocks);

    return (
        <>
            <ambientLight intensity={0.4} />
            <directionalLight
                position={[10, 10, 5]}
                intensity={0.8}
                castShadow
                shadow-mapSize-width={1024}
                shadow-mapSize-height={1024}
            />
            <pointLight position={[-10, -10, -5]} intensity={0.3} />

            {/* Ground plane */}
            <mesh position={[0, -0.1, 0]} receiveShadow>
                <planeGeometry args={[20, 20]} />
                <meshStandardMaterial color="#2a2a2a" opacity={0.5} transparent />
            </mesh>

            {/* Tower blocks */}
            {towerBlocks.map((block, index) => (
                <BlockMesh
                    key={index}
                    block={block}
                    color={`hsl(${(index * 137.5) % 360}, 70%, 60%)`}
                />
            ))}

            {/* Grid helper */}
            <gridHelper args={[20, 20, '#444444', '#222222']} />

            <OrbitControls
                enablePan={true}
                enableZoom={true}
                enableRotate={true}
                maxDistance={50}
                minDistance={2}
                target={[0, stats.height / 2000, 0]}
            />
        </>
    );
};

export const TowerVisualization: React.FC<TowerVisualizationProps> = ({
    towerBlocks,
    width = 300,
    height = 200,
    showStats = true,
    interactive = true,
}) => {
    const stats = calculateTowerStats(towerBlocks);

    if (towerBlocks.length === 0) {
        return (
            <div
                style={{
                    width,
                    height,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: '#1a1a1a',
                    color: '#888',
                    borderRadius: '8px'
                }}
            >
                No tower data
            </div>
        );
    }

    return (
        <div style={{ width, height, position: 'relative' }}>
            <Canvas
                camera={{
                    position: [5, 5, 5],
                    fov: 60,
                    near: 0.1,
                    far: 1000
                }}
                style={{
                    width: '100%',
                    height: '100%',
                    borderRadius: '8px',
                    background: 'linear-gradient(to bottom, #1a1a2e, #16213e)'
                }}
            >
                <TowerScene towerBlocks={towerBlocks} />
            </Canvas>

            {showStats && (
                <div style={{
                    position: 'absolute',
                    top: 8,
                    left: 8,
                    background: 'rgba(0, 0, 0, 0.7)',
                    color: 'white',
                    padding: '6px 8px',
                    borderRadius: '4px',
                    fontSize: '11px',
                    lineHeight: '1.3'
                }}>
                    <div>Blocks: {towerBlocks.length}</div>
                    <div>Height: {(stats.height / 1000).toFixed(1)}</div>
                    <div>Width: {(stats.width / 1000).toFixed(1)}</div>
                </div>
            )}

            {!interactive && (
                <div style={{
                    position: 'absolute',
                    bottom: 4,
                    right: 4,
                    fontSize: '10px',
                    color: '#888',
                    background: 'rgba(0, 0, 0, 0.5)',
                    padding: '2px 4px',
                    borderRadius: '2px'
                }}>
                    {interactive ? 'Interactive' : 'Preview'}
                </div>
            )}
        </div>
    );
};

export default TowerVisualization;
