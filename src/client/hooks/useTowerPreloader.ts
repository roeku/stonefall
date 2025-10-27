import { useState, useCallback, useEffect } from 'react';
import { TowerMapEntry } from '../../shared/types/api';
import { TowerPlacementSystem } from '../../shared/types/towerPlacement';
import { useGameData } from './useGameData';

interface TowerPreloaderHook {
  preAssignedTowers: TowerMapEntry[] | null;
  isLoading: boolean;
  error: string | null;
  preloadAndAssignTowers: () => Promise<void>;
  clearPreloadedTowers: () => void;
}

export const useTowerPreloader = (placementSystem: TowerPlacementSystem): TowerPreloaderHook => {
  const { getTowerMap } = useGameData();
  const [preAssignedTowers, setPreAssignedTowers] = useState<TowerMapEntry[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preloadAndAssignTowers = useCallback(async () => {
    if (isLoading) return; // Prevent multiple simultaneous loads

    console.log('🏰 Pre-loading and assigning towers...');
    setIsLoading(true);
    setError(null);

    try {
      // Load towers from the server
      const result = await getTowerMap(50, 0); // Load top 50 towers
      if (!result || !result.towers) {
        throw new Error('No towers data received');
      }

      const towers = result.towers;
      console.log('🏰 Loaded', towers.length, 'towers for pre-assignment');

      // Get available coordinates for placement
      const availableCoords = placementSystem.getAvailableCoordinates();
      console.log('🏰 Available coordinates:', availableCoords.length);

      // Sort towers by score (highest first) for better placement
      const sortedTowers = [...towers].sort((a, b) => b.score - a.score);

      // Assign positions to towers that don't already have them
      let assignedCount = 0;
      const towersWithPositions = sortedTowers.map((tower) => {
        // If tower already has coordinates, keep them
        if (tower.worldX !== undefined && tower.worldZ !== undefined) {
          return tower;
        }

        // Assign new coordinates if available
        if (assignedCount < availableCoords.length) {
          const coord = availableCoords[assignedCount];
          if (coord) {
            const towerWithPosition = {
              ...tower,
              worldX: coord.worldX,
              worldZ: coord.worldZ,
              gridX: coord.x,
              gridZ: coord.z,
            };

            // Mark the coordinate as occupied in the placement system
            placementSystem.placeTower(coord.x, coord.z, tower.sessionId);

            console.log('🏰 Pre-assigned tower:', tower.username, 'to position:', [
              coord.worldX,
              coord.worldZ,
            ]);
            assignedCount++;

            return towerWithPosition;
          }
        }

        // If no coordinates available, return tower without position (won't be rendered)
        console.warn('🏰 No available coordinates for tower:', tower.username);
        return tower;
      });

      setPreAssignedTowers(towersWithPositions);
      console.log('🏰 Pre-assignment complete. Assigned:', assignedCount, 'towers');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      console.error('🏰 Failed to pre-load towers:', errorMessage);
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [getTowerMap, placementSystem, isLoading]);

  const clearPreloadedTowers = useCallback(() => {
    console.log('🏰 Clearing pre-loaded towers');
    setPreAssignedTowers(null);
    setError(null);
    // Reset the placement system
    placementSystem.reset();
  }, [placementSystem]);

  // Auto-clear when component unmounts or placement system changes
  useEffect(() => {
    return () => {
      // Don't auto-clear on unmount to preserve data
    };
  }, []);

  return {
    preAssignedTowers,
    isLoading,
    error,
    preloadAndAssignTowers,
    clearPreloadedTowers,
  };
};
