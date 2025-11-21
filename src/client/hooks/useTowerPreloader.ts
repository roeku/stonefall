import { useState, useCallback, useEffect } from 'react';
import { TowerMapEntry } from '../../shared/types/api';
import { TowerPlacementSystem } from '../../shared/types/towerPlacement';
import { useGameData } from './useGameData';
import { MAX_VISIBLE_TOWERS } from '../../shared/constants/towers';

const TOWER_PRELOAD_LIMIT = MAX_VISIBLE_TOWERS;
const TOWER_FETCH_PAGE_SIZE = 100; // Matches legacy single-request size

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
      // Load towers from the server, paging until we fill our render budget
      const fetchedTowers: TowerMapEntry[] = [];
      let offset = 0;
      let totalCount = Number.POSITIVE_INFINITY;

      while (fetchedTowers.length < TOWER_PRELOAD_LIMIT && offset < totalCount) {
        const pageLimit = Math.min(
          TOWER_FETCH_PAGE_SIZE,
          TOWER_PRELOAD_LIMIT - fetchedTowers.length
        );
        const page = await getTowerMap(pageLimit, offset);
        if (!page || !page.towers) {
          break;
        }

        fetchedTowers.push(...page.towers);
        if (typeof page.totalCount === 'number') {
          totalCount = page.totalCount;
        }

        console.log('🏰 Loaded tower page', fetchedTowers.length, 'of', TOWER_PRELOAD_LIMIT);

        if (page.towers.length < pageLimit) {
          break; // No more data available
        }

        offset += pageLimit;
      }

      if (fetchedTowers.length === 0) {
        throw new Error('No towers data received');
      }

      const towers = fetchedTowers.filter((tower) => tower.isPersonalBest !== false);
      console.log('🏰 Loaded', towers.length, 'towers for pre-assignment');

      // Deduplicate towers by user to prevent a single player from filling the top ranks
      const seenUsers = new Set<string>();
      const uniqueTowers = [...towers]
        .sort((a, b) => b.score - a.score)
        .filter((tower) => {
          if (!tower.userId) {
            return true;
          }
          if (seenUsers.has(tower.userId)) {
            return false;
          }
          seenUsers.add(tower.userId);
          return true;
        });

      console.log('🏰 Unique towers after user filter:', uniqueTowers.length);

      // DON'T reset placement system - preserve any towers already placed (like player tower)
      // placementSystem.reset();

      // Assign positions to towers that don't already have them
      const towersWithPositions = uniqueTowers.map((tower, index) => {
        const tryExistingPlacement = () => {
          // If tower has explicit grid coordinates, attempt to reserve them
          if (typeof tower.gridX === 'number' && typeof tower.gridZ === 'number') {
            const coord = placementSystem.getCoordinate(tower.gridX, tower.gridZ);
            if (coord && placementSystem.placeTower(coord.x, coord.z, tower.sessionId)) {
              return {
                ...tower,
                worldX: coord.worldX,
                worldZ: coord.worldZ,
                gridX: coord.x,
                gridZ: coord.z,
              } as TowerMapEntry;
            }
          }

          // Fall back to existing world coordinates if available
          if (typeof tower.worldX === 'number' && typeof tower.worldZ === 'number') {
            const coord = placementSystem.getCoordinateByWorldPos(tower.worldX, tower.worldZ);
            if (coord && placementSystem.placeTower(coord.x, coord.z, tower.sessionId)) {
              return {
                ...tower,
                worldX: coord.worldX,
                worldZ: coord.worldZ,
                gridX: coord.x,
                gridZ: coord.z,
              } as TowerMapEntry;
            }
          }

          return undefined;
        };

        const existingPlacement = tryExistingPlacement();
        if (existingPlacement) {
          return existingPlacement;
        }

        // If tower already has coordinates, keep them
        // Assign new coordinates if available
        const coord = placementSystem.getNextCoordinateForRank(index + 1);
        if (coord && placementSystem.placeTower(coord.x, coord.z, tower.sessionId)) {
          const towerWithPosition = {
            ...tower,
            worldX: coord.worldX,
            worldZ: coord.worldZ,
            gridX: coord.x,
            gridZ: coord.z,
          };

          console.log('🏰 Pre-assigned tower:', tower.username, 'to position:', [
            coord.worldX,
            coord.worldZ,
          ]);

          return towerWithPosition;
        }

        // If no coordinates available, return tower without position (won't be rendered)
        console.warn('🏰 No available coordinates for tower:', tower.username);
        return tower;
      });

      setPreAssignedTowers(towersWithPositions);
      console.log(
        '🏰 Pre-assignment complete. Total towers processed:',
        towersWithPositions.length
      );
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
