import { useState, useCallback, useEffect, useRef } from 'react';
import { TowerMapEntry } from '../../shared/types/api';
import { TowerPlacementSystem } from '../../shared/types/towerPlacement';
import { useGameData } from './useGameData';
import { MAX_VISIBLE_TOWERS } from '../../shared/constants/towers';

const TOWER_PRELOAD_LIMIT = MAX_VISIBLE_TOWERS;
const TOWER_FETCH_PAGE_SIZE = 1000; // Matches legacy single-request size
const TOWER_CACHE_KEY = 'stonefall99:tower-cache:v1';
const TOWER_CACHE_MAX_AGE_MS = 1000 * 60 * 30; // 30 minutes
const TOWER_CACHE_VERSION = 1;

interface TowerCachePayload {
  version: number;
  timestamp: number;
  gridSignature: string;
  towers: TowerMapEntry[];
}

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
  const cacheHydratedRef = useRef(false);
  const cacheOccupancyRef = useRef(false);
  const latestTowersRef = useRef<TowerMapEntry[] | null>(null);

  const getGridSignature = useCallback(() => {
    const config = placementSystem.getConfiguration();
    return [config.gridSize, config.gridOffsetX, config.gridOffsetZ, config.gridRadius].join(':');
  }, [placementSystem]);

  const persistTowerCache = useCallback(
    (towers: TowerMapEntry[]) => {
      if (typeof window === 'undefined') {
        return;
      }
      if (!towers.length) {
        return;
      }
      try {
        const payload: TowerCachePayload = {
          version: TOWER_CACHE_VERSION,
          timestamp: Date.now(),
          gridSignature: getGridSignature(),
          towers,
        };
        window.localStorage.setItem(TOWER_CACHE_KEY, JSON.stringify(payload));
      } catch (storageError) {
        console.warn('🏰 Unable to persist tower cache', storageError);
      }
    },
    [getGridSignature]
  );

  const loadCachedTowers = useCallback((): TowerMapEntry[] | null => {
    if (typeof window === 'undefined') {
      return null;
    }
    try {
      const raw = window.localStorage.getItem(TOWER_CACHE_KEY);
      if (!raw) {
        return null;
      }
      const payload = JSON.parse(raw) as TowerCachePayload;
      if (!payload?.towers?.length) {
        return null;
      }
      if (payload.version !== TOWER_CACHE_VERSION) {
        return null;
      }
      if (Date.now() - payload.timestamp > TOWER_CACHE_MAX_AGE_MS) {
        window.localStorage.removeItem(TOWER_CACHE_KEY);
        return null;
      }
      if (payload.gridSignature !== getGridSignature()) {
        return null;
      }
      return payload.towers;
    } catch (storageError) {
      console.warn('🏰 Failed to parse cached tower data', storageError);
      return null;
    }
  }, [getGridSignature]);

  const hydratePlacementFromCache = useCallback(
    (towers: TowerMapEntry[]) => {
      placementSystem.reset();
      towers.forEach((tower) => {
        if (typeof tower.gridX === 'number' && typeof tower.gridZ === 'number' && tower.sessionId) {
          placementSystem.placeTower(tower.gridX, tower.gridZ, tower.sessionId);
        }
      });
    },
    [placementSystem]
  );

  useEffect(() => {
    if (cacheHydratedRef.current) {
      return;
    }
    const cached = loadCachedTowers();
    cacheHydratedRef.current = true;
    if (cached && cached.length) {
      hydratePlacementFromCache(cached);
      cacheOccupancyRef.current = true;
      setPreAssignedTowers(cached);
      console.log('🏰 Hydrated towers from local cache:', cached.length);
    }
  }, [hydratePlacementFromCache, loadCachedTowers]);

  useEffect(() => {
    if (!preAssignedTowers || preAssignedTowers.length === 0) {
      return;
    }
    persistTowerCache(preAssignedTowers);
  }, [persistTowerCache, preAssignedTowers]);

  useEffect(() => {
    latestTowersRef.current = preAssignedTowers;
  }, [preAssignedTowers]);

  const preloadAndAssignTowers = useCallback(async () => {
    if (isLoading) return; // Prevent multiple simultaneous loads

    console.log('🏰 Pre-loading and assigning towers (streaming)...');
    setIsLoading(true);
    setError(null);
    const streamedTowers: TowerMapEntry[] = [];
    const previousSnapshot = latestTowersRef.current;
    const clearedCachedPlacement = cacheOccupancyRef.current;
    if (clearedCachedPlacement) {
      placementSystem.reset();
      cacheOccupancyRef.current = false;
    }

    try {
      // Load towers from the server, paging until we fill our render budget
      let offset = 0;
      let totalCount = Number.POSITIVE_INFINITY;
      let loadedCount = 0;
      const seenUsers = new Set<string>();
      let currentRank = 0;

      while (loadedCount < TOWER_PRELOAD_LIMIT && offset < totalCount) {
        const pageLimit = Math.min(TOWER_FETCH_PAGE_SIZE, TOWER_PRELOAD_LIMIT - loadedCount);
        const page = await getTowerMap(pageLimit, offset);
        if (!page || !page.towers) {
          break;
        }

        if (typeof page.totalCount === 'number') {
          totalCount = page.totalCount;
        }

        console.log('🏰 Loaded tower page', page.towers.length, 'items. Offset:', offset);

        const validTowers = page.towers.filter((tower) => tower.isPersonalBest !== false);

        // Deduplicate towers by user to prevent a single player from filling the top ranks
        const uniqueBatch: TowerMapEntry[] = [];
        for (const tower of validTowers) {
          if (!tower.userId) {
            uniqueBatch.push(tower);
            continue;
          }
          if (!seenUsers.has(tower.userId)) {
            seenUsers.add(tower.userId);
            uniqueBatch.push(tower);
          }
        }

        // Assign positions to this batch
        const placedBatch = uniqueBatch
          .map((tower) => {
            const myRankIndex = currentRank;
            currentRank++;

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

            // Assign new coordinates if available
            const coord = placementSystem.getNextCoordinateForRank(myRankIndex + 1);
            if (coord && placementSystem.placeTower(coord.x, coord.z, tower.sessionId)) {
              return {
                ...tower,
                worldX: coord.worldX,
                worldZ: coord.worldZ,
                gridX: coord.x,
                gridZ: coord.z,
              };
            }

            // If no coordinates available, return tower without position (won't be rendered)
            console.warn('🏰 No available coordinates for tower:', tower.username);
            return tower;
          })
          .filter((t): t is TowerMapEntry => t !== undefined);
        if (placedBatch.length > 0) {
          streamedTowers.push(...placedBatch);
          setPreAssignedTowers([...streamedTowers]);
        }

        loadedCount += page.towers.length;
        offset += pageLimit;

        if (page.towers.length < pageLimit) {
          break; // No more data available
        }

        // Small delay to allow UI to update if needed, though React state updates are async anyway
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      console.log('🏰 Streaming complete. Total towers processed:', currentRank);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      console.error('🏰 Failed to pre-load towers:', errorMessage);
      setError(errorMessage);
    } finally {
      setIsLoading(false);
      if (streamedTowers.length === 0 && clearedCachedPlacement && previousSnapshot?.length) {
        hydratePlacementFromCache(previousSnapshot);
        cacheOccupancyRef.current = true;
      }
    }
  }, [getTowerMap, hydratePlacementFromCache, isLoading, placementSystem]);

  const clearPreloadedTowers = useCallback(() => {
    console.log('🏰 Clearing pre-loaded towers');
    setPreAssignedTowers(null);
    setError(null);
    // Reset the placement system
    placementSystem.reset();
    cacheOccupancyRef.current = false;
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
