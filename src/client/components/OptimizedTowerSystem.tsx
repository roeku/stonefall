import React, { useRef, useEffect, useState, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { TowerMapEntry } from '../../shared/types/api';
import { useGameData } from '../hooks/useGameData';
import { TowerPlacementSystem, TowerCoordinate } from '../../shared/types/towerPlacement';

// Optimized tower instance using instancing for better performance
interface OptimizedTowerSystemProps {
  isGameOver: boolean;
  playerTower?: TowerMapEntry | null;
  placementSystem: TowerPlacementSystem;
  selectedCoordinate?: TowerCoordinate | null;
  selectedTower?: TowerMapEntry | null;
  onCoordinateSelect?: (coordinate: TowerCoordinate) => void;
  onTowerClick?: (tower: TowerMapEntry, position: [number, number, number]) => void;
  cameraPosition?: { x: number; y: number; z: number } | undefined;
}

// Memoized tower block component to prevent unnecessary re-renders
const TowerBlock = React.memo<{
  block: any;
  index: number;
  isSelected: boolean;
  edgeColor: string;
  baseColor: string;
}>(({ block, index, isSelected, edgeColor, baseColor }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const lineRef = useRef<THREE.LineSegments>(null);

  // Memoize geometry to prevent recreation
  const geometry = useMemo(() =>
    new THREE.BoxGeometry(block.width, block.height, block.depth),
    [block.width, block.height, block.depth]
  );

  const edgesGeometry = useMemo(() =>
    new THREE.EdgesGeometry(geometry),
    [geometry]
  );

  // Memoize materials to prevent recreation
  const material = useMemo(() =>
    new THREE.MeshBasicMaterial({
      color: baseColor,
      transparent: false,
      toneMapped: false,
    }),
    [baseColor]
  );

  const lineMaterial = useMemo(() =>
    new THREE.LineBasicMaterial({
      color: isSelected ? "#ffffff" : edgeColor,
      opacity: 1.0,
      transparent: false,
      toneMapped: false,
    }),
    [isSelected, edgeColor]
  );

  return (
    <group
      key={index}
      position={[block.x, block.y + block.height / 2, block.z]}
      rotation={[0, block.rotation, 0]}
    >
      {/* Dark solid tower block */}
      <mesh ref={meshRef} geometry={geometry} material={material} />

      {/* TRON: Legacy glowing edges */}
      <lineSegments ref={lineRef} geometry={edgesGeometry} material={lineMaterial} />

      {/* Selected tower glow effect */}
      {isSelected && (
        <mesh>
          <boxGeometry args={[block.width + 0.2, block.height + 0.2, block.depth + 0.2]} />
          <meshBasicMaterial
            color="#00ffff"
            transparent
            opacity={0.1}
            toneMapped={false}
          />
        </mesh>
      )}
    </group>
  );
});

// Optimized tower instance with reduced re-renders
const OptimizedTowerInstance = React.memo<{
  tower: TowerMapEntry;
  position: [number, number, number];
  isPlayerTower?: boolean;
  isSelected?: boolean;
  rank?: number | undefined;
  onTowerClick?: (tower: TowerMapEntry, position: [number, number, number]) => void;
}>(({ tower, position, isPlayerTower = false, isSelected = false, rank, onTowerClick }) => {
  const groupRef = useRef<THREE.Group>(null);

  // Memoize tower blocks conversion to prevent recalculation
  const towerBlocks = useMemo(() =>
    tower.towerBlocks.map(block => ({
      x: (block.x / 1000),
      y: (block.y / 1000),
      z: ((block.z || 0) / 1000),
      width: (block.width / 1000),
      height: (block.height / 1000),
      depth: ((block.depth || block.width) / 1000),
      rotation: (block.rotation || 0) / 1000,
    })),
    [tower.towerBlocks]
  );

  // Memoize colors to prevent recalculation
  const { edgeColor, baseColor } = useMemo(() => {
    const isTopFive = rank !== undefined && rank < 5;
    return {
      edgeColor: isPlayerTower ? '#00f2fe' : (isTopFive ? '#ffff00' : '#ff6600'),
      baseColor: '#0a0a0a'
    };
  }, [isPlayerTower, rank]);

  // Track mouse/pointer movement to prevent accidental clicks during navigation
  const [pointerStart, setPointerStart] = useState<{ x: number; y: number } | null>(null);

  // Memoize click handlers to prevent recreation
  const handlePointerDown = useMemo(() => (e: any) => {
    e.stopPropagation();
    setPointerStart({ x: e.clientX, y: e.clientY });
  }, []);

  const handleClick = useMemo(() => (e: any) => {
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
    onTowerClick?.(tower, position);
  }, [pointerStart, onTowerClick, tower, position]);

  const handlePointerOver = useMemo(() => (e: any) => {
    e.stopPropagation();
    document.body.style.cursor = 'pointer';
  }, []);

  const handlePointerOut = useMemo(() => (e: any) => {
    e.stopPropagation();
    document.body.style.cursor = 'default';
  }, []);

  return (
    <group
      ref={groupRef}
      position={position}
      onPointerDown={handlePointerDown}
      onClick={handleClick}
      onPointerOver={handlePointerOver}
      onPointerOut={handlePointerOut}
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

      {/* Tower blocks - with clipping to prevent showing under grid */}
      {towerBlocks.map((block, index) => {
        // Calculate world position for clipping
        const worldY = position[1] + block.y + block.height / 2;
        const isUnderGrid = worldY < -0.4; // Grid is at -0.5, so clip slightly above

        if (isUnderGrid) return null; // Don't render blocks under the grid

        return (
          <TowerBlock
            key={index}
            block={block}
            index={index}
            isSelected={isSelected}
            edgeColor={edgeColor}
            baseColor={baseColor}
          />
        );
      })}

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

          {/* Projection border */}
          <lineSegments position={[0, 0, 0]}>
            <edgesGeometry attach="geometry" args={[new THREE.BoxGeometry(4, 1, 0.1)]} />
            <lineBasicMaterial
              color="#00ffff"
              transparent
              opacity={0.6}
            />
          </lineSegments>

          {/* Corner brackets */}
          {[[-1.8, 0.4], [1.8, 0.4], [-1.8, -0.4], [1.8, -0.4]].map(([x, y], i) => (
            <mesh key={i} position={[x ?? 0, y ?? 0, 0.05]}>
              <boxGeometry args={[0.3, 0.1, 0.02]} />
              <meshBasicMaterial color="#00ffff" transparent opacity={0.9} />
            </mesh>
          ))}

          {/* Scanning line effect */}
          <mesh position={[0, 0.6, 0.05]}>
            <boxGeometry args={[4, 0.02, 0.01]} />
            <meshBasicMaterial
              color="#00ffff"
              transparent
              opacity={0.6}
            />
          </mesh>
        </group>
      )}
    </group>
  );
});

// Optimized placement marker with reduced animations
const OptimizedPlacementMarker = React.memo<{
  coordinate: TowerCoordinate;
  isSelected: boolean;
  onClick: () => void;
}>(({ coordinate, isSelected, onClick }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const lastPulseUpdateRef = useRef(0);

  // Only animate if not occupied and reduce frequency
  useFrame((state) => {
    if (meshRef.current && !coordinate.isOccupied) {
      // Throttle pulse animation to reduce performance impact
      if (state.clock.elapsedTime - lastPulseUpdateRef.current > 0.1) { // 10fps for pulse
        const pulse = Math.sin(state.clock.elapsedTime * 2) * 0.1 + 0.9;
        meshRef.current.scale.setScalar(pulse);
        lastPulseUpdateRef.current = state.clock.elapsedTime;
      }
    }
  });

  // Early return after all hooks
  if (coordinate.isOccupied && coordinate.towerId !== 'player') {
    return null;
  }

  const isPlayerSpot = coordinate.towerId === 'player';
  const color = isPlayerSpot ? '#00f2fe' : isSelected ? '#ff6600' : '#333333';

  // Memoize click handler
  const handleClick = useMemo(() => (e: any) => {
    e.stopPropagation();

    // Don't place towers if shift is held (camera panning)
    if (e.nativeEvent.shiftKey) {
      return;
    }

    // Don't place if this was a drag operation
    if (e.nativeEvent.detail === 0) {
      return; // This was likely a drag end, not a click
    }

    if (!coordinate.isOccupied) {
      console.log('🎯 PLAYER CLICKED GRID POSITION:', [coordinate.x, coordinate.z], 'world:', [coordinate.worldX, coordinate.worldZ]);
      onClick();
    } else {
      console.log('🚫 Position occupied by:', coordinate.towerId);
    }
  }, [coordinate, onClick]);

  const handlePointerOver = useMemo(() => (e: any) => {
    e.stopPropagation();
    if (!coordinate.isOccupied) {
      document.body.style.cursor = 'pointer';
    }
  }, [coordinate.isOccupied]);

  const handlePointerOut = useMemo(() => (e: any) => {
    e.stopPropagation();
    document.body.style.cursor = 'default';
  }, []);

  return (
    <group position={[coordinate.worldX, 0.1, coordinate.worldZ]}>
      {/* Large invisible clickable area */}
      <mesh
        onClick={handleClick}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
        position={[0, 2, 0]}
      >
        <boxGeometry args={[8, 4, 8]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>

      {/* Visual grid marker - only show when needed */}
      <mesh
        ref={meshRef}
        position={[0, 0.05, 0]}
        visible={false} // Hidden for performance
      >
        <cylinderGeometry args={[3.5, 3.5, 0.1, 8]} />
        <meshBasicMaterial color={color} transparent opacity={0.4} />
      </mesh>

      {isPlayerSpot && (
        <mesh position={[0, 0.5, 0]}>
          <coneGeometry args={[0.3, 0.8, 6]} />
          <meshBasicMaterial color="#00f2fe" transparent opacity={0.7} />
        </mesh>
      )}
    </group>
  );
});

export const OptimizedTowerSystem: React.FC<OptimizedTowerSystemProps> = ({
  isGameOver,
  playerTower,
  placementSystem,
  selectedCoordinate,
  selectedTower: externalSelectedTower,
  onCoordinateSelect,
  onTowerClick,
}) => {
  const { getTowerMap } = useGameData();
  const [towers, setTowers] = useState<TowerMapEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [towersPlaced, setTowersPlaced] = useState(false);

  // Removed debug logging to prevent excessive console output

  // Reduce state updates for better performance
  const [hiddenTowers, setHiddenTowers] = useState<Set<string>>(new Set());

  // Sync with external selected tower state - throttled
  useEffect(() => {
    if (externalSelectedTower) {

      // Simplified hiding logic - no staggered animations for performance
      const nearbyTowers = towers.filter(t => {
        if (t.sessionId === externalSelectedTower.sessionId) return false;
        const towerX = t.worldX ?? 0;
        const towerZ = t.worldZ ?? 0;
        const selectedX = externalSelectedTower.worldX ?? 0;
        const selectedZ = externalSelectedTower.worldZ ?? 0;
        const distance = Math.sqrt(
          Math.pow(towerX - selectedX, 2) +
          Math.pow(towerZ - selectedZ, 2)
        );
        return distance < 50;
      });

      // Immediate hiding for performance
      setHiddenTowers(new Set(nearbyTowers.map(t => t.sessionId)));
    } else {
      setHiddenTowers(new Set());
    }
  }, [externalSelectedTower, towers]);

  // Handle tower click
  const handleTowerClick = useMemo(() => (tower: TowerMapEntry, position: [number, number, number]) => {
    console.log('🎯 Tower clicked!', tower.username, 'at position:', position);
    onTowerClick?.(tower, position);
  }, [onTowerClick]);

  // Load towers when game is over - throttled
  useEffect(() => {
    if (isGameOver && !loaded) {
      console.log('🏰 OptimizedTowerSystem - Loading towers...');
      const loadTowers = async () => {
        try {
          const result = await getTowerMap(50, 0); // Reduced from 100 to 50 for performance
          if (result) {
            setTowers(result.towers);
            console.log('🏰 OptimizedTowerSystem - Loaded', result.towers.length, 'towers');
          }
        } catch (error) {
          console.error('Failed to load towers:', error);
        } finally {
          setLoaded(true);
        }
      };
      loadTowers();
    }
  }, [isGameOver, loaded, getTowerMap]);

  // Reset when game is not over
  useEffect(() => {
    if (!isGameOver) {
      setLoaded(false);
      setTowers([]);
      setTowersPlaced(false);
    }
  }, [isGameOver]);

  // Place towers only once when first loaded
  useEffect(() => {
    if (isGameOver && loaded && towers.length > 0 && !towersPlaced) {
      console.log('🏰 Placing towers...');

      const availableCoords = placementSystem.getAvailableCoordinates();
      let placedCount = 0;

      towers.forEach((tower) => {
        if (tower.sessionId === playerTower?.sessionId) return;

        if (tower.worldX === undefined || tower.worldZ === undefined) {
          if (placedCount >= availableCoords.length) return;

          const coord = availableCoords[placedCount];
          if (!coord) return;

          placementSystem.placeTower(coord.x, coord.z, tower.sessionId);
          placedCount++;
        }
      });

      setTowersPlaced(true);
      console.log('🏰 Finished placing towers. Placed:', placedCount);
    }
  }, [isGameOver, loaded, towers.length, towersPlaced, playerTower?.sessionId, placementSystem]);

  // Memoize tower positions to prevent recalculation
  const towerPositions = useMemo(() => {
    const positions: Array<{
      tower: TowerMapEntry;
      position: [number, number, number];
      isPlayer: boolean;
      rank?: number;
    }> = [];

    // Player tower at selected coordinate (when selected)
    if (playerTower && selectedCoordinate) {
      positions.push({
        tower: playerTower,
        position: [selectedCoordinate.worldX, 0, selectedCoordinate.worldZ],
        isPlayer: true,
      });
    }

    // Build tower positions for rendering
    const occupiedCoords = placementSystem.getOccupiedCoordinates();

    // Sort towers by score to determine top 5 (excluding player tower)
    const sortedTowers = towers
      .filter(tower => tower.sessionId !== playerTower?.sessionId)
      .sort((a, b) => b.score - a.score);

    sortedTowers.forEach((tower, index) => {
      const rank = index; // 0-based rank (0 = highest score)

      // Check if tower has saved coordinates
      if (tower.worldX !== undefined && tower.worldZ !== undefined) {
        positions.push({
          tower,
          position: [tower.worldX, 0, tower.worldZ],
          isPlayer: false,
          rank,
        });
      } else {
        // Find where this tower was placed in the grid
        const placedCoord = occupiedCoords.find(coord => coord.towerId === tower.sessionId);
        if (placedCoord) {
          positions.push({
            tower,
            position: [placedCoord.worldX, 0, placedCoord.worldZ],
            isPlayer: false,
            rank,
          });
        }
      }
    });

    return positions;
  }, [towers, playerTower, selectedCoordinate, placementSystem]);

  // Memoize visible coordinates to prevent recalculation
  const visibleCoordinates = useMemo(() => {
    return placementSystem.getAllCoordinates()
      .filter((coord) => {
        // Simplified distance calculation for better performance
        const distance = Math.sqrt(coord.x * coord.x + coord.z * coord.z);
        return distance <= 10; // Reduced from 15 to 10 for performance
      });
  }, [placementSystem]);

  // Don't render anything if game is not over or towers aren't ready
  if (!isGameOver || !loaded || !towersPlaced) {
    return null;
  }

  return (
    <>
      {/* Render towers - only visible ones */}
      {towerPositions
        .filter(({ tower }) => !hiddenTowers.has(tower.sessionId))
        .slice(0, 20) // Limit to 20 towers initially for performance
        .map(({ tower, position, isPlayer, rank }) => (
          <OptimizedTowerInstance
            key={tower.sessionId}
            tower={tower}
            position={position}
            isPlayerTower={isPlayer}
            isSelected={externalSelectedTower?.sessionId === tower.sessionId}
            rank={rank}
            onTowerClick={handleTowerClick}
          />
        ))}

      {/* Render placement grid - heavily reduced for performance */}
      {visibleCoordinates
        .slice(0, 25) // Limit to 25 markers for performance
        .map((coordinate) => (
          <OptimizedPlacementMarker
            key={`${coordinate.x},${coordinate.z}`}
            coordinate={coordinate}
            isSelected={selectedCoordinate?.x === coordinate.x && selectedCoordinate?.z === coordinate.z}
            onClick={() => onCoordinateSelect?.(coordinate)}
          />
        ))}
    </>
  );
};
