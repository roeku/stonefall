import React, { useRef, useEffect, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { TowerMapEntry } from '../../shared/types/api';
import { TowerPlacementSystem } from '../../shared/types/towerPlacement';
// Removed unused ChunkManager import
import { TowerAnimationManager } from './TowerAnimationManager';
import { TowerEmergenceEffects } from './TowerEmergenceEffects';


interface UnifiedTowerSystemProps {
  isGameOver: boolean;
  playerTower?: TowerMapEntry | null;
  placementSystem: TowerPlacementSystem;
  selectedTower?: TowerMapEntry | null;
  onTowerClick?: (tower: TowerMapEntry, position: [number, number, number], rank?: number) => void;
  cameraPosition?: { x: number; y: number; z: number } | undefined;
  onTowersLoaded?: (towers: TowerMapEntry[]) => void; // Callback to expose towers data
  preAssignedTowers?: TowerMapEntry[] | null | undefined; // Pre-loaded towers with assigned positions
}

interface TowerInstanceProps {
  tower: TowerMapEntry;
  position: [number, number, number];
  isPlayerTower?: boolean;
  isSelected?: boolean;
  rank?: number | undefined;
  onTowerClick?: (tower: TowerMapEntry, position: [number, number, number], rank?: number) => void;
  hasSelectedTower?: boolean; // New prop to know if any tower is selected
}

const TowerInstance: React.FC<TowerInstanceProps> = ({
  tower,
  position,
  isPlayerTower = false,
  isSelected = false,
  rank,
  onTowerClick,
  hasSelectedTower = false
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const beaconRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);

  // Animate player tower beacon
  useFrame((state) => {
    if (isPlayerTower && beaconRef.current && ringRef.current) {
      const time = state.clock.getElapsedTime();
      // Pulse the beacon opacity
      const beaconMaterial = beaconRef.current.material as THREE.MeshBasicMaterial;
      beaconMaterial.opacity = 0.2 + Math.sin(time * 2) * 0.1;

      // Pulse the ring
      const ringMaterial = ringRef.current.material as THREE.MeshBasicMaterial;
      ringMaterial.opacity = 0.3 + Math.sin(time * 2) * 0.2;

      // Scale the ring
      ringRef.current.scale.setScalar(1 + Math.sin(time * 3) * 0.1);
    }
  });

  // Convert tower blocks to full scale (1:1)
  const towerBlocks = tower.towerBlocks.map(block => ({
    x: (block.x / 1000),
    y: (block.y / 1000),
    z: ((block.z || 0) / 1000),
    width: (block.width / 1000),
    height: (block.height / 1000),
    depth: ((block.depth || block.width) / 1000),
    rotation: (block.rotation || 0) / 1000,
  }));

  // Simplified color scheme - only selected towers get colored, highscores are uncolored when ANY tower is selected
  const isTopFive = rank !== undefined && rank < 5;
  const shouldShowHighscoreColor = isTopFive && !hasSelectedTower; // Don't show highscore color when ANY tower is selected
  const edgeColor = isSelected ? '#ffffff' : (isPlayerTower ? '#00f2fe' : (shouldShowHighscoreColor ? '#ffff00' : '#333333'));
  const baseColor = '#0a0a0a'; // Very dark base for all towers

  // Track mouse/pointer movement to prevent accidental clicks during navigation
  const [pointerStart, setPointerStart] = React.useState<{ x: number; y: number } | null>(null);

  return (
    <group
      ref={groupRef}
      position={position}
      onPointerDown={(e) => {
        e.stopPropagation();
        setPointerStart({ x: e.clientX, y: e.clientY });
      }}
      onClick={(e) => {
        e.stopPropagation();

        // Prevent click if this was a drag operation
        if (pointerStart) {
          const distance = Math.sqrt(
            Math.pow(e.clientX - pointerStart.x, 2) +
            Math.pow(e.clientY - pointerStart.y, 2)
          );

          // If pointer moved more than 5 pixels, consider it a drag
          if (distance > 5) {
            setPointerStart(null);
            return;
          }
        }

        setPointerStart(null);
        onTowerClick?.(tower, position, rank);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={(e) => {
        e.stopPropagation();
        document.body.style.cursor = 'default';
      }}
    >
      {/* Tower base glow */}
      <mesh position={[0, -0.1, 0]}>
        <cylinderGeometry args={[2, 2, 0.2, 16]} />
        <meshBasicMaterial
          color={edgeColor}
          transparent
          opacity={0.2}
        />
      </mesh>

      {/* Player tower beacon - pulsing vertical beam */}
      {isPlayerTower && (
        <>
          {/* Vertical beacon beam */}
          <mesh ref={beaconRef} position={[0, 25, 0]}>
            <cylinderGeometry args={[0.5, 0.5, 50, 8]} />
            <meshBasicMaterial
              color="#00f2fe"
              transparent
              opacity={0.3}
              toneMapped={false}
            />
          </mesh>

          {/* Pulsing rings at base */}
          <mesh ref={ringRef} position={[0, 0.1, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[2, 3, 32]} />
            <meshBasicMaterial
              color="#00f2fe"
              transparent
              opacity={0.4}
              side={THREE.DoubleSide}
              toneMapped={false}
            />
          </mesh>

          {/* Top marker */}
          <mesh position={[0, 50, 0]}>
            <sphereGeometry args={[1, 8, 8]} />
            <meshBasicMaterial
              color="#00f2fe"
              transparent
              opacity={0.6}
              toneMapped={false}
            />
          </mesh>
        </>
      )}

      {/* Tower blocks - simplified without animations */}
      {towerBlocks.map((block, index) => {
        return (
          <group key={index} position={[block.x, block.y + block.height / 2, block.z]}>
            {/* Tower block */}
            <mesh rotation={[0, block.rotation, 0]}>
              <boxGeometry args={[block.width, block.height, block.depth]} />
              <meshBasicMaterial
                color={baseColor}
                transparent={false}
                toneMapped={false}
              />
            </mesh>

            {/* Edge lines - show for selected towers or highscore towers (when not overridden) */}
            {(isSelected || shouldShowHighscoreColor) && (
              <lineSegments rotation={[0, block.rotation, 0]}>
                <edgesGeometry attach="geometry" args={[new THREE.BoxGeometry(block.width, block.height, block.depth)]} />
                <lineBasicMaterial
                  attach="material"
                  color={edgeColor}
                  opacity={0.8}
                  transparent={true}
                  toneMapped={false}
                />
              </lineSegments>
            )}

            {/* Selection glow - only when selected */}
            {isSelected && (
              <mesh rotation={[0, block.rotation, 0]}>
                <boxGeometry args={[block.width + 0.1, block.height + 0.1, block.depth + 0.1]} />
                <meshBasicMaterial
                  color="#00ffff"
                  transparent
                  opacity={0.05}
                  toneMapped={false}
                />
              </mesh>
            )}
          </group>
        );
      })}

      {/* Tower position number - large and visible */}
      {rank !== undefined && (
        <group position={[0, towerBlocks.length * 1.5 + 1.5, 0]}>
          <mesh position={[0, 0, 0.05]}>
            <planeGeometry args={[2, 2]} />
            <meshBasicMaterial
              map={(() => {
                const canvas = document.createElement('canvas');
                canvas.width = 256;
                canvas.height = 256;
                const ctx = canvas.getContext('2d')!;

                // Clear background
                ctx.fillStyle = 'rgba(0, 0, 0, 0)';
                ctx.fillRect(0, 0, 256, 256);

                // Position number styling
                ctx.font = 'bold 120px "Orbitron", monospace';
                ctx.fillStyle = isSelected ? '#ffffff' : (shouldShowHighscoreColor ? '#ffff00' : '#666666');
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';

                // Glow effect
                ctx.shadowColor = ctx.fillStyle;
                ctx.shadowBlur = 10;
                ctx.fillText((rank + 1).toString(), 128, 128);

                // Sharp text on top
                ctx.shadowBlur = 0;
                ctx.fillText((rank + 1).toString(), 128, 128);

                const texture = new THREE.CanvasTexture(canvas);
                texture.needsUpdate = true;
                return texture;
              })()}
              transparent
              opacity={0.9}
            />
          </mesh>
        </group>
      )}

      {/* Player tower indicator - subtle cyan glow */}
      {isPlayerTower && (
        <mesh position={[0, towerBlocks.length * 1.5 + 1, 0]}>
          <sphereGeometry args={[0.3]} />
          <meshBasicMaterial color="#00f2fe" transparent opacity={0.4} />
        </mesh>
      )}

      {/* Selected tower username projection - 3D holographic display */}
      {isSelected && (
        <group position={[0, towerBlocks.length * 1.5 + 2, 0]}>
          {/* Username text projection */}
          <mesh position={[0, 0, 0.05]}>
            <planeGeometry args={[3.5, 0.8]} />
            <meshBasicMaterial
              map={(() => {
                const canvas = document.createElement('canvas');
                canvas.width = 512;
                canvas.height = 128;
                const ctx = canvas.getContext('2d')!;

                // Clear background
                ctx.fillStyle = 'rgba(0, 0, 0, 0)';
                ctx.fillRect(0, 0, 512, 128);

                // Text styling
                ctx.font = 'bold 48px "Orbitron", monospace';
                ctx.fillStyle = '#00ffff';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';

                // Glow effect
                ctx.shadowColor = '#00ffff';
                ctx.shadowBlur = 15;
                ctx.fillText(tower.username.toUpperCase(), 256, 64);

                // Sharp text on top
                ctx.shadowBlur = 0;
                ctx.fillText(tower.username.toUpperCase(), 256, 64);

                const texture = new THREE.CanvasTexture(canvas);
                texture.needsUpdate = true;
                return texture;
              })()}
              transparent
              opacity={0.9}
            />
          </mesh>

        </group>
      )}
    </group>
  );
};
// Removed PlacementMarker component - no longer needed for manual selection
export const UnifiedTowerSystem: React.FC<UnifiedTowerSystemProps> = ({
  isGameOver,
  playerTower,
  placementSystem,
  selectedTower: externalSelectedTower,
  onTowerClick,
  cameraPosition: externalCameraPosition,
  onTowersLoaded,
  preAssignedTowers,
}) => {
  // Use pre-assigned towers if provided, otherwise fall back to loading
  const [towers, setTowers] = useState<TowerMapEntry[]>(preAssignedTowers || []);

  // Handle tower click for info popup with focus system
  const handleTowerClick = (tower: TowerMapEntry, position: [number, number, number], rank?: number) => {
    console.log('🎯 Tower clicked!', tower.username, 'at position:', position, 'rank:', rank);
    onTowerClick?.(tower, position, rank);
  };

  // Dynamic loading system - reduced for performance
  const animationManagerRef = useRef(new TowerAnimationManager());
  const [cameraPosition, setCameraPosition] = useState({ x: 0, z: 0 });
  const [emergenceEffects, setEmergenceEffects] = useState<Array<{
    id: string;
    position: [number, number, number];
    type: 'rising' | 'sinking';
  }>>([]);

  // Update towers when preAssignedTowers changes
  useEffect(() => {
    if (preAssignedTowers) {
      console.log('🏰 Using pre-assigned towers:', preAssignedTowers.length);
      setTowers(preAssignedTowers);
      onTowersLoaded?.(preAssignedTowers);
    }
  }, [preAssignedTowers, onTowersLoaded]);

  // Reset when game is not over
  useEffect(() => {
    if (!isGameOver) {
      if (!preAssignedTowers) {
        setTowers([]);
      }
    }
  }, [isGameOver, preAssignedTowers]);

  // Animation update loop
  useFrame((state, delta) => {
    if (!isGameOver) return;

    animationManagerRef.current.updateAnimations(delta);

    // Update camera position for chunk loading (throttled)
    const camera = state.camera;
    const currentPos = externalCameraPosition || { x: camera.position.x, z: camera.position.z };

    // Only update if camera moved significantly (avoid constant chunk checks)
    if (Math.abs(currentPos.x - cameraPosition.x) > 25 || Math.abs(currentPos.z - cameraPosition.z) > 25) {
      setCameraPosition({ x: currentPos.x, z: currentPos.z });
    }
  });

  // Prepare tower positions - simplified since towers already have assigned positions
  const towerPositions: Array<{
    tower: TowerMapEntry;
    position: [number, number, number];
    isPlayer: boolean;
    rank?: number;
  }> = [];

  // Player tower - automatically assign position if not already assigned
  if (playerTower) {
    // If player tower doesn't have coordinates, assign them automatically
    if (playerTower.worldX === undefined || playerTower.worldZ === undefined) {
      const availableCoords = placementSystem.getAvailableCoordinates();
      if (availableCoords.length > 0) {
        const coord = availableCoords[0]; // Take the first available spot
        if (coord) {
          playerTower.worldX = coord.worldX;
          playerTower.worldZ = coord.worldZ;
          placementSystem.placeTower(coord.x, coord.z, playerTower.sessionId);
          console.log('🏰 Auto-assigned player tower to:', [coord.worldX, coord.worldZ]);
        }
      }
    }

    if (playerTower.worldX !== undefined && playerTower.worldZ !== undefined) {
      towerPositions.push({
        tower: playerTower,
        position: [playerTower.worldX, 0, playerTower.worldZ],
        isPlayer: true,
      });
    }
  }

  // Sort towers by score to determine rankings (excluding player tower)
  const sortedTowers = towers
    .filter(tower => tower.sessionId !== playerTower?.sessionId)
    .sort((a, b) => b.score - a.score);

  // Add all towers with their pre-assigned positions
  sortedTowers.forEach((tower, index) => {
    const rank = index; // 0-based rank (0 = highest score)

    // Towers should already have assigned coordinates from pre-processing
    if (tower.worldX !== undefined && tower.worldZ !== undefined) {
      towerPositions.push({
        tower,
        position: [tower.worldX, 0, tower.worldZ],
        isPlayer: false,
        rank,
      });
    }
  });

  // Debug logging (only when state changes)
  // Simplified debug logging
  // if (isGameOver && loaded && towersPlaced && towerPositions.length > 0) {
  //   console.log('🏰 Rendering', towerPositions.length, 'towers');
  // }

  // Don't render anything if game is not over (moved to end after all hooks and computations)
  if (!isGameOver) {
    return null;
  }

  return (
    <>
      {/* Render towers - limited for performance */}
      {towerPositions
        .slice(0, 25) // Limit to 25 towers maximum for performance
        .map(({ tower, position, isPlayer, rank }) => (
          <TowerInstance
            key={tower.sessionId}
            tower={tower}
            position={position}
            isPlayerTower={isPlayer}
            isSelected={externalSelectedTower?.sessionId === tower.sessionId}
            rank={rank}
            onTowerClick={handleTowerClick}
            hasSelectedTower={externalSelectedTower !== null && externalSelectedTower !== undefined}
          />
        ))}

      {/* Tower emergence effects - temporarily disabled to fix errors */}
      {false && emergenceEffects.map((effect) => (
        <TowerEmergenceEffects
          key={effect.id}
          position={effect.position}
          type={effect.type}
          active={true}
          onComplete={() => {
            setEmergenceEffects(prev => prev.filter(e => e.id !== effect.id));
          }}
        />
      ))}

      {/* Placement grid removed - no longer needed for manual selection */}


    </>
  );
};
