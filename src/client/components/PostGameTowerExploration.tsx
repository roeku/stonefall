import React, { useRef, useEffect, useState, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { TowerMapEntry } from '../../shared/types/api';
import { useGameData } from '../hooks/useGameData';

interface PostGameTowerExplorationProps {
  playerTower: TowerMapEntry | null;
  onClose: () => void;
}

interface TowerCellProps {
  tower: TowerMapEntry;
  position: [number, number, number];
  isPlayerTower?: boolean;
  animationDelay: number;
}

const TowerCell: React.FC<TowerCellProps> = ({ tower, position, isPlayerTower = false, animationDelay }) => {
  const meshRef = useRef<THREE.Group>(null);
  const [animationProgress, setAnimationProgress] = useState(0);
  const [startTime, setStartTime] = useState<number | null>(null);

  useFrame((state) => {
    if (!meshRef.current) return;

    if (startTime === null) {
      setStartTime(state.clock.elapsedTime + animationDelay);
      return;
    }

    const elapsed = state.clock.elapsedTime - startTime;
    if (elapsed > 0 && animationProgress < 1) {
      const progress = Math.min(elapsed / 2, 1); // 2 second animation
      const eased = 1 - Math.pow(1 - progress, 3); // Ease out cubic
      setAnimationProgress(eased);

      // Rise up animation
      meshRef.current.position.y = -10 + (eased * 10);
      meshRef.current.scale.setScalar(1.0 + (eased * 0.7));
    }

    // Gentle floating animation after emergence
    if (animationProgress >= 1) {
      const float = Math.sin(state.clock.elapsedTime * 0.5 + position[0] * 0.1) * 0.1;
      meshRef.current.position.y = float;
    }
  });

  // Calculate tower height for scaling
  const towerHeight = Math.max(1, tower.blockCount * 0.15);
  const towerColor = isPlayerTower ? '#4facfe' : `hsl(${(tower.score * 137) % 360}, 70%, 60%)`;

  return (
    <group ref={meshRef} position={position}>
      {/* Tower blocks */}
      {tower.towerBlocks.map((block, index) => {
        const displayX = block.x / 1000 * 0.1;
        const displayY = block.y / 1000 * 0.1;
        const displayZ = (block.z || 0) / 1000 * 0.1;
        const displayWidth = block.width / 1000 * 0.1;
        const displayHeight = block.height / 1000 * 0.1;
        const displayDepth = (block.depth || block.width) / 1000 * 0.1;

        return (
          <mesh
            key={index}
            position={[displayX, displayY + displayHeight / 2, displayZ]}
            rotation={[0, (block.rotation || 0) / 1000, 0]}
          >
            <boxGeometry args={[displayWidth, displayHeight, displayDepth]} />
            <meshStandardMaterial
              color={towerColor}
              transparent
              opacity={0.8}
              roughness={0.3}
              metalness={0.1}
            />
            <lineSegments>
              <edgesGeometry attach="geometry" args={[new THREE.BoxGeometry(displayWidth, displayHeight, displayDepth)]} />
              <lineBasicMaterial attach="material" color="#ffffff" opacity={0.2} transparent />
            </lineSegments>
          </mesh>
        );
      })}

      {/* Info panel */}
      <mesh position={[0, towerHeight + 1, 0]} rotation={[-Math.PI / 6, 0, 0]}>
        <planeGeometry args={[2, 1]} />
        <meshBasicMaterial
          color="#000000"
          transparent
          opacity={0.7}
        />
      </mesh>

      {/* Player indicator for own tower */}
      {isPlayerTower && (
        <mesh position={[0, towerHeight + 2, 0]}>
          <sphereGeometry args={[0.2]} />
          <meshBasicMaterial color="#4facfe" />
        </mesh>
      )}
    </group>
  );
};

const GridFloor: React.FC = () => {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (meshRef.current) {
      // Subtle grid animation
      const time = state.clock.elapsedTime;
      meshRef.current.material.opacity = 0.3 + Math.sin(time * 0.5) * 0.1;
    }
  });

  return (
    <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.1, 0]}>
      <planeGeometry args={[100, 100]} />
      <meshBasicMaterial
        color="#ff4500"
        transparent
        opacity={0.3}
        wireframe
      />
    </mesh>
  );
};

const TowerExplorationScene: React.FC<{ towers: TowerMapEntry[]; playerTower: TowerMapEntry | null }> = ({
  towers,
  playerTower
}) => {
  const { camera } = useThree();

  // Position towers in a grid layout
  const towerPositions = useMemo(() => {
    const gridSize = 8; // Distance between towers
    const positions: Array<{ tower: TowerMapEntry; position: [number, number, number]; isPlayer: boolean; delay: number }> = [];

    // Place player tower at center
    if (playerTower) {
      positions.push({
        tower: playerTower,
        position: [0, 0, 0],
        isPlayer: true,
        delay: 0
      });
    }

    // Place other towers in a spiral pattern around the center
    let angle = 0;
    let radius = gridSize;
    let towersPerRing = 6;
    let currentRing = 0;
    let towerInRing = 0;

    towers.forEach((tower, index) => {
      if (tower.sessionId === playerTower?.sessionId) return; // Skip player tower

      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;

      positions.push({
        tower,
        position: [x, 0, z],
        isPlayer: false,
        delay: index * 0.2 // Stagger animations
      });

      towerInRing++;
      angle += (Math.PI * 2) / towersPerRing;

      // Move to next ring
      if (towerInRing >= towersPerRing) {
        currentRing++;
        radius += gridSize;
        towersPerRing = Math.floor(6 + currentRing * 2); // More towers in outer rings
        towerInRing = 0;
        angle = (currentRing % 2) * (Math.PI / towersPerRing); // Offset alternate rings
      }
    });

    return positions;
  }, [towers, playerTower]);

  // Set initial camera position
  useEffect(() => {
    camera.position.set(10, 15, 10);
    camera.lookAt(0, 0, 0);
  }, [camera]);

  return (
    <>
      <ambientLight intensity={0.4} />
      <directionalLight
        position={[20, 20, 10]}
        intensity={0.8}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />
      <pointLight position={[-10, 10, -10]} intensity={0.3} color="#4facfe" />

      <GridFloor />

      {towerPositions.map(({ tower, position, isPlayer, delay }, index) => (
        <TowerCell
          key={tower.sessionId}
          tower={tower}
          position={position}
          isPlayerTower={isPlayer}
          animationDelay={delay}
        />
      ))}

      <OrbitControls
        enablePan={true}
        enableZoom={true}
        enableRotate={true}
        maxDistance={50}
        minDistance={5}
        maxPolarAngle={Math.PI / 2.2}
        target={[0, 0, 0]}
      />
    </>
  );
};

export const PostGameTowerExploration: React.FC<PostGameTowerExplorationProps> = ({
  playerTower,
  onClose
}) => {
  const { getTowerMap } = useGameData();
  const [towers, setTowers] = useState<TowerMapEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadTowers = async () => {
      try {
        const result = await getTowerMap(20, 0); // Load 20 towers
        if (result) {
          setTowers(result.towers);
        }
      } catch (error) {
        console.error('Failed to load towers:', error);
      } finally {
        setLoading(false);
      }
    };

    loadTowers();
  }, [getTowerMap]);

  if (loading) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-80 z-50">
        <div className="text-white text-xl">Loading tower world...</div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 z-40">
      {/* 3D Tower Exploration */}
      <Canvas
        camera={{
          position: [10, 15, 10],
          fov: 60,
          near: 0.1,
          far: 1000
        }}
        style={{
          width: '100%',
          height: '100%',
          background: 'linear-gradient(to bottom, #0a0a0a, #1a1a2e)'
        }}
      >
        <TowerExplorationScene towers={towers} playerTower={playerTower} />
      </Canvas>

      {/* UI Overlay */}
      <div className="absolute top-5 left-5 text-white">
        <h2 className="text-2xl font-bold mb-2">Tower World</h2>
        <p className="text-sm opacity-80">Explore other players' towers</p>
        <p className="text-xs opacity-60 mt-1">Drag to look around • Scroll to zoom</p>
      </div>

      {/* Stats Panel */}
      <div className="absolute top-5 right-5 bg-black bg-opacity-60 p-4 rounded-lg text-white">
        <div className="text-sm">
          <div>Towers Found: {towers.length}</div>
          {playerTower && (
            <>
              <div className="mt-2 pt-2 border-t border-gray-600">
                <div className="text-blue-400 font-semibold">Your Tower</div>
                <div>Score: {playerTower.score.toLocaleString()}</div>
                <div>Height: {playerTower.blockCount} blocks</div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Close Button */}
      <button
        onClick={onClose}
        className="absolute bottom-5 left-1/2 transform -translate-x-1/2 px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold transition-colors"
      >
        Return to Game
      </button>
    </div>
  );
};

export default PostGameTowerExploration;
