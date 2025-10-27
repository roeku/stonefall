import React, { useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { TowerMapEntry } from '../../shared/types/api';

interface TowerCameraControllerProps {
  selectedTower?: TowerMapEntry | null | undefined;
  isGameOver: boolean;
  onCameraDebugUpdate?: ((debug: any) => void) | undefined;
  getTowersData?: () => TowerMapEntry[]; // Function to get current towers data
}

export const TowerCameraController: React.FC<TowerCameraControllerProps> = ({
  selectedTower,
  isGameOver,
  onCameraDebugUpdate,
  getTowersData
}) => {
  const { camera } = useThree();
  const rotationRef = useRef(0);
  const overviewRotationRef = useRef(0); // Separate rotation for overview mode
  const targetPositionRef = useRef(new THREE.Vector3(0, 0, 0));
  const currentPositionRef = useRef(new THREE.Vector3(40, 28, 40));
  const targetLookAtRef = useRef(new THREE.Vector3(0, 4, 0));
  const currentLookAtRef = useRef(new THREE.Vector3(0, 4, 0));
  const frameCountRef = useRef(0);

  // Calculate optimal overview parameters based on actual tower data
  const calculateOverviewParams = () => {
    const towers = getTowersData ? getTowersData() : [];
    if (!towers || towers.length === 0) {
      return {
        radius: 250,
        height: 200,
        centerX: 0,
        centerZ: 0,
        lookAtY: 25
      };
    }

    // Calculate tower heights and positions
    const towerData = towers
      .filter(tower => tower.worldX !== undefined && tower.worldZ !== undefined)
      .map(tower => {
        const height = tower.towerBlocks.reduce((maxY, block) => {
          const blockTop = (block.y + block.height) / 1000;
          return Math.max(maxY, blockTop);
        }, 0);
        return {
          x: tower.worldX!,
          z: tower.worldZ!,
          height
        };
      });

    if (towerData.length === 0) {
      return {
        radius: 250,
        height: 200,
        centerX: 0,
        centerZ: 0,
        lookAtY: 25
      };
    }

    // Calculate center of tower area
    const centerX = towerData.reduce((sum, t) => sum + t.x, 0) / towerData.length;
    const centerZ = towerData.reduce((sum, t) => sum + t.z, 0) / towerData.length;

    // Calculate furthest distance from center
    const maxDistance = Math.max(...towerData.map(t =>
      Math.sqrt(Math.pow(t.x - centerX, 2) + Math.pow(t.z - centerZ, 2))
    ));

    // Calculate median height
    const heights = towerData.map(t => t.height).sort((a, b) => a - b);
    const medianHeight = heights[Math.floor(heights.length / 2)] || 50; // Default to 50 if undefined

    // Set radius to be outside the furthest tower with some margin
    const radius = Math.max(maxDistance * 3, 150); // At least 150 units radius

    // Set height based on median tower height with good viewing angle
    const height = Math.max(medianHeight * 2, 100); // At least 100 units high

    // Look at point should be at median height level
    const lookAtY = medianHeight * 0.6;

    //console.log('🎥 OVERVIEW-PARAMS - Center:', [centerX, centerZ], 'Radius:', radius, 'Height:', height, 'MedianHeight:', medianHeight);

    return {
      radius,
      height,
      centerX,
      centerZ,
      lookAtY
    };
  };

  // Calculate dynamic overview camera position that pans around the tower area
  const calculateOverviewPosition = (rotation: number = 0) => {
    const { radius, height, centerX, centerZ, lookAtY } = calculateOverviewParams();

    const cameraX = centerX + Math.cos(rotation) * radius;
    const cameraZ = centerZ + Math.sin(rotation) * radius;
    const cameraY = height;

    return {
      position: new THREE.Vector3(cameraX, cameraY, cameraZ),
      lookAt: new THREE.Vector3(centerX, lookAtY, centerZ)
    };
  };

  // Calculate optimal camera position for a tower
  const calculateCameraPosition = (tower: TowerMapEntry | null, rotation: number = 0) => {
    if (!tower || tower.worldX === undefined || tower.worldZ === undefined) {
      // Return overview position if no tower specified
      return calculateOverviewPosition(overviewRotationRef.current);
    }

    // Calculate tower height from blocks (already scaled down by /1000)
    const towerHeight = tower.towerBlocks.reduce((maxY, block) => {
      const blockTop = (block.y + block.height) / 1000;
      return Math.max(maxY, blockTop);
    }, 0);

    //console.log('🎥 TOWER-SCALE - Tower height:', towerHeight, 'blocks:', tower.towerBlocks.length);

    // Position camera to show FULL tower from base to top with RTS angle
    const towerMid = towerHeight / 1.4;

    // Calculate proper distance and height to see ENTIRE tower
    // For a 90-unit tower, we need to be much farther and higher
    const distance = Math.max(120, towerHeight * 2.5); // Much farther back
    const height = Math.max(towerHeight * 1.8, towerHeight + 30); // Much higher - above the tower!

    // Rotate around the tower
    const cameraX = tower.worldX + Math.cos(rotation) * distance;
    const cameraZ = tower.worldZ + Math.sin(rotation) * distance;
    const cameraY = height;

    console.log('🎥 TOWER-CAMERA - Distance:', distance, 'Height:', height, 'Tower height:', towerHeight, 'Mid:', towerMid);

    return {
      position: new THREE.Vector3(cameraX, cameraY, cameraZ),
      lookAt: new THREE.Vector3(tower.worldX, towerMid, tower.worldZ) // Look at middle of tower
    };
  };

  // Update target when selected tower changes
  useEffect(() => {
    if (!isGameOver) return; // Only handle camera during game over

    if (selectedTower && selectedTower.worldX !== undefined && selectedTower.worldZ !== undefined) {
      const { position, lookAt } = calculateCameraPosition(selectedTower, rotationRef.current);
      targetPositionRef.current.copy(position);
      targetLookAtRef.current.copy(lookAt);
      console.log('🎥 TOWER-FOCUS - Targeting tower:', selectedTower.username, 'at', [selectedTower.worldX, selectedTower.worldZ]);
    } else {
      // Dynamic overview mode - start the panning motion
      const { position, lookAt } = calculateOverviewPosition(overviewRotationRef.current);
      targetPositionRef.current.copy(position);
      targetLookAtRef.current.copy(lookAt);
      rotationRef.current = 0; // Reset tower rotation when no tower selected
      console.log('🎥 OVERVIEW - Starting dynamic overview mode');
    }
  }, [selectedTower, isGameOver]);

  // Initialize camera controller when game over starts
  useEffect(() => {
    if (isGameOver) {
      // Set initial position from current camera position for smooth transition
      currentPositionRef.current.copy(camera.position);

      // Set target based on selection state
      if (!selectedTower) {
        // Start dynamic overview
        const { position, lookAt } = calculateOverviewPosition(overviewRotationRef.current);
        targetPositionRef.current.copy(position);
        targetLookAtRef.current.copy(lookAt);
        console.log('🎥 GAME-OVER - Starting dynamic overview');
      }
    }
  }, [isGameOver, camera.position, selectedTower]);

  // TowerCameraController should NOT handle gameplay camera - that's handled by GameScene

  useFrame((_, delta) => {
    frameCountRef.current++;

    // ONLY handle camera during game over - never during gameplay
    if (!isGameOver) {
      return;
    }

    // Smooth camera transitions
    const lerpFactor = 0.03; // Slightly faster for better responsiveness
    currentPositionRef.current.lerp(targetPositionRef.current, lerpFactor);
    currentLookAtRef.current.lerp(targetLookAtRef.current, lerpFactor);

    // Handle rotation based on mode
    if (selectedTower && selectedTower.worldX !== undefined && selectedTower.worldZ !== undefined) {
      // Auto-rotate around selected tower
      rotationRef.current += delta * 0.5; // Moderate rotation speed
      const { position } = calculateCameraPosition(selectedTower, rotationRef.current);
      targetPositionRef.current.copy(position);
    } else {
      // Dynamic overview panning - slow rotation to show all towers
      overviewRotationRef.current += delta * 0.15; // Slow panoramic rotation
      const { position, lookAt } = calculateOverviewPosition(overviewRotationRef.current);
      targetPositionRef.current.copy(position);
      targetLookAtRef.current.copy(lookAt);
    }

    // Apply camera position and look-at - override the existing camera logic
    camera.position.copy(currentPositionRef.current);
    camera.lookAt(currentLookAtRef.current);

    // Update debug info (throttled)
    if (frameCountRef.current % 10 === 0 && onCameraDebugUpdate) {
      const debugInfo = {
        position: {
          x: parseFloat(camera.position.x.toFixed(2)),
          y: parseFloat(camera.position.y.toFixed(2)),
          z: parseFloat(camera.position.z.toFixed(2))
        },
        distance: parseFloat(camera.position.distanceTo(currentLookAtRef.current).toFixed(2)),
        lookAt: {
          x: parseFloat(currentLookAtRef.current.x.toFixed(2)),
          y: parseFloat(currentLookAtRef.current.y.toFixed(2)),
          z: parseFloat(currentLookAtRef.current.z.toFixed(2))
        },
        isGameOver,
        selectedTower: selectedTower?.username || null
      };
      onCameraDebugUpdate(debugInfo);
    }
  });

  return null; // This component only controls the camera, no visual output
};
