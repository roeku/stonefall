import { useState, useCallback, useEffect, useRef } from 'react';
import { TowerMapEntry } from '../../shared/types/api';
import { TowerPlacementSystem } from '../../shared/types/towerPlacement';
import { MAX_VISIBLE_TOWERS } from '../../shared/constants/towers';

const TOWER_PRELOAD_LIMIT = MAX_VISIBLE_TOWERS;
const BATCH_SIZE = 50; // Renamed to ensure fresh build
const MAX_CONCURRENT_PAGE_REQUESTS = 3;
const TOWER_CACHE_KEY = 'stonefall99:tower-cache:v1';
const TOWER_CACHE_MAX_AGE_MS = 1000 * 60 * 30; // 30 minutes
const TOWER_CACHE_VERSION = 1;
// Limit cache size to avoid localStorage quota errors (approx 5MB limit).
// 150 towers * ~50 blocks should be safely under 1MB.
const MAX_CACHE_TOWERS = 150;

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
  totalCount: number;
  preloadAndAssignTowers: (
    type?: 'all-time' | 'daily',
    reservedTower?: TowerMapEntry | null,
    cycleId?: string
  ) => Promise<void>;
  clearPreloadedTowers: () => void;
}

export const useTowerPreloader = (placementSystem: TowerPlacementSystem): TowerPreloaderHook => {
  const [preAssignedTowers, setPreAssignedTowers] = useState<TowerMapEntry[] | null>(null);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cacheHydratedRef = useRef(false);
  const cacheOccupancyRef = useRef(false);
  const latestTowersRef = useRef<TowerMapEntry[] | null>(null);
  const currentTypeRef = useRef<'all-time' | 'daily'>('all-time');
  const currentCycleIdRef = useRef<string | undefined>(undefined);
  const isLoadingRef = useRef(false);
  const loadGenerationRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const cachePersistTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      // Clear any pending cache persist operations
      if (cachePersistTimeoutRef.current !== null) {
        window.clearTimeout(cachePersistTimeoutRef.current);
      }
    };
  }, []);

  const fetchTowerMapPage = useCallback(
    async (
      limit: number,
      offset: number,
      type: 'all-time' | 'daily',
      cycleId?: string,
      signal?: AbortSignal
    ): Promise<{ towers: TowerMapEntry[]; totalCount: number } | null> => {
      // Prefer a direct fetch here so that concurrent page requests don't thrash the
      // global `useGameData` loading flag.
      const cycleParam = cycleId ? `&cycleId=${cycleId}` : '';
      const init: RequestInit | undefined = signal ? { signal } : undefined;
      const response = await fetch(
        `/api/game/tower-map?limit=${limit}&offset=${offset}&type=${type}${cycleParam}&_t=${Date.now()}`,
        init
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
        throw new Error(errorData.message || `HTTP ${response.status}`);
      }

      const data = (await response.json()) as { towers?: TowerMapEntry[]; totalCount?: number };
      return {
        towers: Array.isArray(data.towers) ? data.towers : [],
        totalCount: typeof data.totalCount === 'number' ? data.totalCount : 0,
      };
    },
    []
  );

  const yieldToBrowser = useCallback(async (): Promise<void> => {
    if (typeof window === 'undefined') {
      return;
    }
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
  }, []);

  const getGridSignature = useCallback(() => {
    const config = placementSystem.getConfiguration();
    return [config.gridSize, config.gridOffsetX, config.gridOffsetZ, config.gridRadius].join(':');
  }, [placementSystem]);

  const persistTowerCache = useCallback(
    (towers: TowerMapEntry[]) => {
      // Disabled: localStorage cache causes crashes on mobile devices
      return;

      if (typeof window === 'undefined') {
        return;
      }
      if (!towers.length) {
        return;
      }
      // Only cache all-time towers to avoid overwriting with daily/cycle data
      if (currentTypeRef.current !== 'all-time') {
        return;
      }

      try {
        // Limit the number of cached towers to substantially reduce payload size
        // and prevent QuotaExceededError on mobile devices / filled localStorage.
        const towersToCache =
          towers.length > MAX_CACHE_TOWERS ? towers.slice(0, MAX_CACHE_TOWERS) : towers;

        const payload: TowerCachePayload = {
          version: TOWER_CACHE_VERSION,
          timestamp: Date.now(),
          gridSignature: getGridSignature(),
          towers: towersToCache,
        };
        window.localStorage.setItem(TOWER_CACHE_KEY, JSON.stringify(payload));
      } catch (storageError) {
        console.warn('🏰 Unable to persist tower cache', storageError);
      }
    },
    [getGridSignature]
  );

  const loadCachedTowers = useCallback((): TowerMapEntry[] | null => {
    // Disabled: localStorage cache causes crashes on mobile devices
    return null;

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

  // Debounced cache persistence - only persist after loading is complete to avoid
  // excessive localStorage writes that cause QuotaExceededError and performance issues
  useEffect(() => {
    if (!preAssignedTowers || preAssignedTowers.length === 0) {
      return;
    }

    // Don't persist while actively loading - wait until loading is complete
    if (isLoading) {
      return;
    }

    // Clear any pending timeout
    if (cachePersistTimeoutRef.current !== null) {
      window.clearTimeout(cachePersistTimeoutRef.current);
    }

    // Debounce: only persist 2 seconds after the last update (when loading completes)
    cachePersistTimeoutRef.current = window.setTimeout(() => {
      persistTowerCache(preAssignedTowers);
      cachePersistTimeoutRef.current = null;
    }, 2000);

    return () => {
      if (cachePersistTimeoutRef.current !== null) {
        window.clearTimeout(cachePersistTimeoutRef.current);
      }
    };
  }, [persistTowerCache, preAssignedTowers, isLoading]);

  useEffect(() => {
    latestTowersRef.current = preAssignedTowers;
  }, [preAssignedTowers]);

  const preloadAndAssignTowers = useCallback(
    async (
      type: 'all-time' | 'daily' = 'all-time',
      reservedTower?: TowerMapEntry | null,
      cycleId?: string
    ) => {
      const generation = loadGenerationRef.current + 1;
      loadGenerationRef.current = generation;

      // Cancel any in-flight requests from the previous generation.
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      console.log(`🏰 Pre-loading and assigning towers (${type}) cycle=${cycleId}...`);
      currentTypeRef.current = type;
      currentCycleIdRef.current = cycleId;
      setIsLoading(true);
      isLoadingRef.current = true;
      setError(null);

      // Clear existing towers to provide visual feedback of the switch
      setPreAssignedTowers([]);
      setTotalCount(0);

      const streamedTowers: TowerMapEntry[] = [];

      // Always reset placement system when reloading to ensure clean slate for the new type
      placementSystem.reset();
      cacheOccupancyRef.current = false;

      // If we have a reserved tower (e.g. player's current tower), place it first
      if (
        reservedTower &&
        typeof reservedTower.gridX === 'number' &&
        typeof reservedTower.gridZ === 'number'
      ) {
        if (
          placementSystem.placeTower(
            reservedTower.gridX,
            reservedTower.gridZ,
            reservedTower.sessionId
          )
        ) {
          console.log('🏰 Reserved spot for player tower:', [
            reservedTower.gridX,
            reservedTower.gridZ,
          ]);
        } else {
          console.warn('⚠️ Failed to reserve spot for player tower:', [
            reservedTower.gridX,
            reservedTower.gridZ,
          ]);
        }
      }

      try {
        // Load towers from the server using a small concurrent page-fetch pipeline,
        // but process pages in order to preserve rank ordering.
        let maxOffsetExclusive = Number.POSITIVE_INFINITY;
        const seenUsers = new Set<string>();
        let currentRank = 0;

        const inFlight = new Map<
          number,
          Promise<{ towers: TowerMapEntry[]; totalCount: number } | null>
        >();
        const resolved = new Map<number, { towers: TowerMapEntry[]; totalCount: number } | null>();
        let nextFetchOffset = 0;
        let nextProcessOffset = 0;

        const scheduleFetches = () => {
          while (
            inFlight.size < MAX_CONCURRENT_PAGE_REQUESTS &&
            nextFetchOffset < maxOffsetExclusive
          ) {
            const pageLimit = BATCH_SIZE;
            const offset = nextFetchOffset;
            nextFetchOffset += pageLimit;

            if (offset >= TOWER_PRELOAD_LIMIT) {
              maxOffsetExclusive = Math.min(maxOffsetExclusive, TOWER_PRELOAD_LIMIT);
              break;
            }

            // Fire request (do not await here).
            const promise = fetchTowerMapPage(pageLimit, offset, type, cycleId, controller.signal)
              .then((page) => {
                resolved.set(offset, page);
                return page;
              })
              .finally(() => {
                inFlight.delete(offset);
              });
            inFlight.set(offset, promise);
          }
        };

        // Kick off initial fetches.
        scheduleFetches();

        while (nextProcessOffset < maxOffsetExclusive && nextProcessOffset < TOWER_PRELOAD_LIMIT) {
          if (loadGenerationRef.current !== generation) {
            console.log('🏰 Preload cancelled (new generation started)');
            return;
          }

          if (!resolved.has(nextProcessOffset)) {
            // Wait for the next page in order.
            const inFlightPromise = inFlight.get(nextProcessOffset);
            if (inFlightPromise) {
              await inFlightPromise;
            } else {
              // Nothing scheduled for this offset; attempt to schedule more.
              scheduleFetches();
              if (!inFlight.get(nextProcessOffset)) {
                break;
              }
              await inFlight.get(nextProcessOffset);
            }
          }

          const page = resolved.get(nextProcessOffset);
          resolved.delete(nextProcessOffset);

          if (!page || !page.towers) {
            break;
          }

          // First page establishes totalCount so we don't overfetch.
          if (nextProcessOffset === 0 && typeof page.totalCount === 'number') {
            setTotalCount(page.totalCount);
            maxOffsetExclusive = Math.min(
              maxOffsetExclusive,
              Math.min(page.totalCount, TOWER_PRELOAD_LIMIT)
            );
          }

          if (page.towers.length === 0) {
            break;
          }

          // Filter out non-personal bests ONLY for all-time leaderboard
          // For daily/cycle, we accept all returned towers as they are the best for that cycle
          const validTowers =
            type === 'all-time'
              ? page.towers.filter((tower) => tower.isPersonalBest !== false)
              : page.towers;

          // Deduplicate towers by user ONLY for all-time to prevent a single player from filling the top ranks
          // For daily cycles, we want to show all games played that day (multiple games per user)
          const uniqueBatch: TowerMapEntry[] = [];
          if (type === 'all-time') {
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
          } else {
            // For daily cycles, include all towers without deduplication
            uniqueBatch.push(...validTowers);
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
            // Create a new array reference to ensure React triggers a re-render
            setPreAssignedTowers([...streamedTowers]);
            // Allow UI (including the Tron HUD) to paint between batches.
            await yieldToBrowser();
          }

          // Advance to next page and keep the pipeline full.
          nextProcessOffset += BATCH_SIZE;
          scheduleFetches();
        }

        setPreAssignedTowers([...streamedTowers]);
      } catch (err) {
        if (loadGenerationRef.current === generation) {
          if (err instanceof Error && err.name === 'AbortError') {
            return;
          }
          console.error('🏰 Error preloading towers:', err);
          setError(err instanceof Error ? err.message : 'Failed to load towers');
        }
      } finally {
        if (loadGenerationRef.current === generation) {
          setIsLoading(false);
          isLoadingRef.current = false;
        }
      }
    },
    [fetchTowerMapPage, placementSystem]
  );

  const clearPreloadedTowers = useCallback(() => {
    setPreAssignedTowers(null);
    placementSystem.reset();
    cacheOccupancyRef.current = false;
    latestTowersRef.current = null;
  }, [placementSystem]);

  return {
    preAssignedTowers,
    isLoading,
    error,
    totalCount,
    preloadAndAssignTowers,
    clearPreloadedTowers,
  };
};
