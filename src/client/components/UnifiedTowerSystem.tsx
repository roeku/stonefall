import React, { useRef, useEffect, useState, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { TowerMapEntry } from '../../shared/types/api';
import { TowerPlacementSystem } from '../../shared/types/towerPlacement';
// Removed unused ChunkManager import
import { TowerAnimationManager } from './TowerAnimationManager';


interface UnifiedTowerSystemProps {
  isGameOver: boolean;
  playerTower?: TowerMapEntry | null;
  placementSystem: TowerPlacementSystem;
  selectedTower?: TowerMapEntry | null;
  onTowerClick?: (tower: TowerMapEntry, position: [number, number, number], rank?: number) => void;
  cameraPosition?: { x: number; y: number; z: number } | undefined;
  onTowersLoaded?: (towers: TowerMapEntry[]) => void;
  preAssignedTowers?: TowerMapEntry[] | null | undefined;
}

interface TowerInstanceProps {
  tower: TowerMapEntry;
  position: [number, number, number];
  isPlayerTower?: boolean;
  isSelected?: boolean;
  rank?: number | undefined;
  onTowerClick?: (tower: TowerMapEntry, position: [number, number, number], rank?: number) => void;
  hasSelectedTower?: boolean;
}

const TowerInstance: React.FC<TowerInstanceProps> = ({
  tower,
  position,
  isPlayerTower = false,
  isSelected = false,
  rank,
  onTowerClick,
  hasSelectedTower = false,
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const beaconRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);

  // Animate player tower beacon
  useFrame((state) => {
    if (isPlayerTower && beaconRef.current && ringRef.current) {
      const time = state.clock.getElapsedTime();
      const beaconMaterial = beaconRef.current.material as THREE.MeshBasicMaterial;
      beaconMaterial.opacity = 0.2 + Math.sin(time * 2) * 0.1;

      const ringMaterial = ringRef.current.material as THREE.MeshBasicMaterial;
      ringMaterial.opacity = 0.3 + Math.sin(time * 2) * 0.2;
      ringRef.current.scale.setScalar(1 + Math.sin(time * 3) * 0.1);
    }
  });

  const towerBlocks = tower.towerBlocks.map((block) => ({
    x: block.x / 1000,
    y: block.y / 1000,
    z: (block.z || 0) / 1000,
    width: block.width / 1000,
    height: block.height / 1000,
    depth: (block.depth || block.width) / 1000,
    rotation: (block.rotation || 0) / 1000,
  }));

  const isTopFive = rank !== undefined && rank < 5;
  const shouldShowHighscoreColor = isTopFive && !hasSelectedTower;
  const labelColor = isSelected ? '#ffffff' : shouldShowHighscoreColor ? '#ffff00' : '#666666';
  const edgeColor = isSelected ? '#ffffff' : isPlayerTower ? '#00f2fe' : shouldShowHighscoreColor ? '#ffff00' : '#333333';
  const baseColor = '#0a0a0a';

  const towerHeight = towerBlocks.reduce((max, block) => {
    const blockTop = block.y + block.height;
    return blockTop > max ? blockTop : max;
  }, 0);

  const horizontalBounds = towerBlocks.reduce(
    (acc, block) => {
      const halfWidth = block.width / 2;
      const halfDepth = block.depth / 2;
      const blockMinX = block.x - halfWidth;
      const blockMaxX = block.x + halfWidth;
      const blockMinZ = block.z - halfDepth;
      const blockMaxZ = block.z + halfDepth;

      if (blockMinX < acc.minX) acc.minX = blockMinX;
      if (blockMaxX > acc.maxX) acc.maxX = blockMaxX;
      if (blockMinZ < acc.minZ) acc.minZ = blockMinZ;
      if (blockMaxZ > acc.maxZ) acc.maxZ = blockMaxZ;
      return acc;
    },
    { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity }
  );

  const horizontalSpan = horizontalBounds.minX === Infinity
    ? 0
    : Math.max(horizontalBounds.maxX - horizontalBounds.minX, horizontalBounds.maxZ - horizontalBounds.minZ);

  const sizeMetric = Math.max(towerHeight, horizontalSpan * 1.2);
  const labelScale = Math.min(5, Math.max(1, sizeMetric / 12 + 0.5));
  const labelAnchorHeight = towerHeight > 0 ? towerHeight : 2;
  const rankLabelHeight = labelAnchorHeight + 0.8 * labelScale;
  const usernameLabelHeight = rankLabelHeight;
  const playerMarkerHeight = labelAnchorHeight + 0.5 * labelScale;
  const usernamePlaneWidth = 4 * labelScale;
  const usernamePlaneHeight = 1.3 * labelScale;
  const labelPlaneAspect = usernamePlaneWidth / usernamePlaneHeight;
  const uppercaseUsername = tower.username ? tower.username.toUpperCase() : '';
  const showLabelCard = Boolean(uppercaseUsername || rank !== undefined);

  const usernameTexture = useMemo(() => {
    const canvas = document.createElement('canvas');
    const canvasWidth = Math.max(512, Math.round(512 * labelScale));
    const canvasHeight = Math.max(160, Math.round(160 * labelScale));
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      return new THREE.CanvasTexture(canvas);
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const baseFontSize = Math.round(72 * labelScale);
    const minFontSize = Math.round(40 * labelScale);
    const maxTextWidth = canvasWidth * 0.88;
    let fontSize = baseFontSize;

    ctx.font = `bold ${fontSize}px "Orbitron", monospace`;
    let textMetrics = ctx.measureText(uppercaseUsername);
    while (textMetrics.width > maxTextWidth && fontSize > minFontSize) {
      fontSize = Math.max(minFontSize, fontSize - Math.max(2, Math.round(2 * labelScale)));
      ctx.font = `bold ${fontSize}px "Orbitron", monospace`;
      textMetrics = ctx.measureText(uppercaseUsername);
    }

    ctx.fillStyle = labelColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const centerX = canvasWidth / 2;
    const centerY = canvasHeight / 2;

    if (uppercaseUsername) {
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 14 * labelScale;
      ctx.fillText(uppercaseUsername, centerX, centerY);

      ctx.shadowBlur = 0;
      ctx.lineWidth = Math.max(3, 6 * labelScale);
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
      ctx.strokeText(uppercaseUsername, centerX, centerY);
      ctx.lineWidth = Math.max(1, 2 * labelScale);
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.strokeText(uppercaseUsername, centerX, centerY);

      ctx.fillText(uppercaseUsername, centerX, centerY);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    texture.anisotropy = 4;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    return texture;
  }, [labelScale, labelColor, uppercaseUsername]);

  const rankTexture = useMemo(() => {
    if (rank === undefined) {
      return null;
    }

    const canvas = document.createElement('canvas');
    const canvasHeight = Math.max(256, Math.round(256 * labelScale));
    const canvasWidth = Math.max(256, Math.round(canvasHeight * labelPlaneAspect));
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      return new THREE.CanvasTexture(canvas);
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const baseFontSize = Math.round(canvasHeight * 0.65);
    const minFontSize = Math.round(canvasHeight * 0.4);
    let fontSize = baseFontSize;
    const rankText = (rank + 1).toString();

    ctx.font = `bold ${fontSize}px "Orbitron", monospace`;
    let textMetrics = ctx.measureText(rankText);
    const maxTextWidth = canvasWidth * 0.8;
    while (textMetrics.width > maxTextWidth && fontSize > minFontSize) {
      fontSize -= 2;
      ctx.font = `bold ${fontSize}px "Orbitron", monospace`;
      textMetrics = ctx.measureText(rankText);
    }

    ctx.fillStyle = labelColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const centerX = canvasWidth / 2;
    const centerY = canvasHeight / 2;

    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 10 * labelScale;
    ctx.fillText(rankText, centerX, centerY);
    ctx.shadowBlur = 0;
    ctx.fillText(rankText, centerX, centerY);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    texture.anisotropy = 4;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    return texture;
  }, [rank, labelScale, labelColor]);

  useEffect(() => {
    return () => {
      usernameTexture.dispose();
    };
  }, [usernameTexture]);

  useEffect(() => {
    return () => {
      rankTexture?.dispose();
    };
  }, [rankTexture]);

  const [pointerStart, setPointerStart] = useState<{ x: number; y: number } | null>(null);

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

        if (pointerStart) {
          const distance = Math.sqrt(
            Math.pow(e.clientX - pointerStart.x, 2) +
            Math.pow(e.clientY - pointerStart.y, 2)
          );

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
        <meshBasicMaterial color={edgeColor} transparent opacity={0.2} />
      </mesh>

      {/* Player tower beacon - pulsing vertical beam */}
      {isPlayerTower && (
        <>
          <mesh ref={beaconRef} position={[0, 25, 0]}>
            <cylinderGeometry args={[0.5, 0.5, 50, 8]} />
            <meshBasicMaterial color="#00f2fe" transparent opacity={0.3} toneMapped={false} />
          </mesh>

          <mesh ref={ringRef} position={[0, 0.1, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[2, 3, 32]} />
            <meshBasicMaterial color="#00f2fe" transparent opacity={0.4} side={THREE.DoubleSide} toneMapped={false} />
          </mesh>

          <mesh position={[0, 50, 0]}>
            <sphereGeometry args={[1, 8, 8]} />
            <meshBasicMaterial color="#00f2fe" transparent opacity={0.6} toneMapped={false} />
          </mesh>
        </>
      )}

      {towerBlocks.map((block, index) => (
        <group key={index} position={[block.x, block.y + block.height / 2, block.z]}>
          <mesh rotation={[0, block.rotation, 0]}>
            <boxGeometry args={[block.width, block.height, block.depth]} />
            <meshBasicMaterial color={baseColor} transparent={false} toneMapped={false} />
          </mesh>

          {(isSelected || shouldShowHighscoreColor) && (
            <lineSegments rotation={[0, block.rotation, 0]}>
              <edgesGeometry attach="geometry" args={[new THREE.BoxGeometry(block.width, block.height, block.depth)]} />
              <lineBasicMaterial attach="material" color={edgeColor} opacity={0.8} transparent toneMapped={false} />
            </lineSegments>
          )}

          {isSelected && (
            <mesh rotation={[0, block.rotation, 0]}>
              <boxGeometry args={[block.width + 0.1, block.height + 0.1, block.depth + 0.1]} />
              <meshBasicMaterial color="#00ffff" transparent opacity={0.05} toneMapped={false} />
            </mesh>
          )}
        </group>
      ))}

      {isPlayerTower && (
        <mesh position={[0, playerMarkerHeight, 0]}>
          <sphereGeometry args={[0.3]} />
          <meshBasicMaterial color="#00f2fe" transparent opacity={0.4} />
        </mesh>
      )}

      {showLabelCard && (
        <group position={[0, usernameLabelHeight, 0]}>
          <mesh position={[0, 0, 0.05]}>
            <planeGeometry args={[usernamePlaneWidth, usernamePlaneHeight]} />
            <meshBasicMaterial map={usernameTexture} transparent opacity={1} toneMapped={false} />
          </mesh>
          <mesh position={[0, 0, -0.05]} rotation={[0, Math.PI, 0]}>
            <planeGeometry args={[usernamePlaneWidth, usernamePlaneHeight]} />
            <meshBasicMaterial map={rankTexture ?? usernameTexture} transparent opacity={1} toneMapped={false} />
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
  // Update towers when preAssignedTowers changes
  useEffect(() => {
    if (preAssignedTowers) {
      console.log('🏰 Using pre-assigned towers:', preAssignedTowers.length);

      // Debug: Check if player tower position is in the list
      const playerTowerInList = preAssignedTowers.find(t => t.sessionId === playerTower?.sessionId);
      if (playerTowerInList) {
        console.log('🏰 Player tower in pre-assigned list:', {
          worldX: playerTowerInList.worldX,
          worldZ: playerTowerInList.worldZ,
          sessionId: playerTowerInList.sessionId
        });
      }

      setTowers(preAssignedTowers);
      onTowersLoaded?.(preAssignedTowers);
    }
  }, [preAssignedTowers, onTowersLoaded, playerTower?.sessionId]);

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

  // Debug: Track player tower changes
  useEffect(() => {
    if (playerTower) {
      console.log('🏰 Player tower updated:', {
        sessionId: playerTower.sessionId,
        worldX: playerTower.worldX,
        worldZ: playerTower.worldZ,
        username: playerTower.username
      });
    }
  }, [playerTower]);

  // Prepare tower positions - simplified since towers already have assigned positions
  const towerPositions: Array<{
    tower: TowerMapEntry;
    position: [number, number, number];
    isPlayer: boolean;
    rank?: number;
  }> = [];

  // Player tower - use assigned position or skip if not available
  // IMPORTANT: Do NOT mutate the playerTower object to avoid triggering rerenders
  if (playerTower && playerTower.worldX !== undefined && playerTower.worldZ !== undefined) {
    towerPositions.push({
      tower: playerTower,
      position: [playerTower.worldX, 0, playerTower.worldZ],
      isPlayer: true,
    });
  }

  // Sort towers by score to determine rankings (excluding player tower)
  const sortedTowers = towers
    .filter(tower => tower.sessionId !== playerTower?.sessionId && tower.isPersonalBest !== false)
    .sort((a, b) => b.score - a.score);

  const seenUsers = new Set<string>();
  const uniqueSortedTowers = sortedTowers.filter((tower) => {
    if (!tower.userId) {
      return true;
    }
    if (seenUsers.has(tower.userId)) {
      return false;
    }
    seenUsers.add(tower.userId);
    return true;
  });

  // Add all towers with their pre-assigned positions
  uniqueSortedTowers.forEach((tower, index) => {
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

    </>
  );
};
