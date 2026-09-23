import { useCallback, useMemo, useState } from 'react';
import type { GetBoardResponse, KeepRecord, MapInfo, TowerMapEntry } from '../../shared/types/api';
import { landHoldsFrom, type Holdings } from '../../shared/types/territory';

/**
 * Everything standing on the shared grid, and who holds what.
 *
 * The server returns towers already positioned at the cells their owners chose and the keeps
 * of everyone who has raised anything. Holds are derived from the towers on land cells rather
 * than sent separately, so the map can never show a hold with no tower on it.
 */
export interface BoardHook {
  towers: TowerMapEntry[];
  keeps: KeepRecord[];
  holdings: Holdings;
  /** Which day's map this is and whether it is still open. Null until the first load. */
  map: MapInfo | null;
  totalCount: number;
  isLoading: boolean;
  /** True once the first load has returned, so an empty board is known to be empty. */
  loaded: boolean;
  error: string | null;
  refresh: () => Promise<TowerMapEntry[]>;
}

export const useBoard = (): BoardHook => {
  const [towers, setTowers] = useState<TowerMapEntry[]>([]);
  const [keeps, setKeeps] = useState<KeepRecord[]>([]);
  const [map, setMap] = useState<MapInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<TowerMapEntry[]> => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/board');
      if (!res.ok) {
        setError('Could not load the grid.');
        return [];
      }
      const data = (await res.json()) as GetBoardResponse;
      const resolved = Array.isArray(data.towers) ? data.towers : [];
      setTowers(resolved);
      setKeeps(Array.isArray(data.keeps) ? data.keeps : []);
      setMap(data.map ?? null);
      setLoaded(true);
      return resolved;
    } catch (e) {
      console.error('[board] Failed to load:', e);
      setError('Could not load the grid.');
      return [];
    } finally {
      setIsLoading(false);
    }
  }, []);

  const holdings = useMemo<Holdings>(
    () => ({ keeps, land: landHoldsFrom(towers) }),
    [keeps, towers]
  );

  return {
    towers,
    keeps,
    holdings,
    map,
    totalCount: towers.length,
    isLoading,
    loaded,
    error,
    refresh,
  };
};
