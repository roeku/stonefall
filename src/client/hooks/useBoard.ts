import { useCallback, useMemo, useRef, useState } from 'react';
import type { GetBoardResponse, KeepRecord, MapInfo, TowerMapEntry } from '../../shared/types/api';
import { landHoldsFrom, type Holdings } from '../../shared/types/territory';

/**
 * Everything standing on the shared grid, and who holds what.
 *
 * The server returns towers already positioned at the cells their owners chose and the keeps
 * of everyone who has raised anything. Holds are derived from the towers on land cells rather
 * than sent separately, so the map can never show a hold with no tower on it.
 *
 * Which day's grid: the post's own, until the player starts playing, and today's from then on.
 * An older post opens on its day as it ended; a run is always on today's map.
 */
export interface BoardHook {
  towers: TowerMapEntry[];
  keeps: KeepRecord[];
  holdings: Holdings;
  /** Which day's map this is and whether it is the live one. Null until the first load. */
  map: MapInfo | null;
  totalCount: number;
  isLoading: boolean;
  /** True once the first load has returned, so an empty board is known to be empty. */
  loaded: boolean;
  error: string | null;
  /**
   * Re-read the board. Resolves with what arrived, so a caller that needs the new holdings in
   * the same breath (the standings line after a raise) does not have to wait for a render.
   */
  refresh: () => Promise<BoardSnapshot | null>;
  /**
   * Read today's map from now on, for good: the player has started playing, and whatever this
   * post showed before, what they build is on today's. Nothing is read until the next refresh.
   */
  followLive: () => void;
}

export interface BoardSnapshot {
  towers: TowerMapEntry[];
  holdings: Holdings;
  map: MapInfo | null;
}

export const useBoard = (): BoardHook => {
  const [towers, setTowers] = useState<TowerMapEntry[]>([]);
  const [keeps, setKeeps] = useState<KeepRecord[]>([]);
  const [map, setMap] = useState<MapInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Whether reads are of today's map, or of whatever day the post shows. */
  const live = useRef(false);
  /**
   * Only the latest read is kept. Two reads can be in flight across the move to today's map, and
   * the post's own day answering last would put the player back on a map they cannot build on.
   */
  const latest = useRef(0);

  const refresh = useCallback(async (): Promise<BoardSnapshot | null> => {
    const read = ++latest.current;
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(live.current ? '/api/board' : '/api/board?view=post');
      if (!res.ok) {
        if (read === latest.current) setError('Could not load the grid.');
        return null;
      }
      const data = (await res.json()) as GetBoardResponse;
      const resolved = Array.isArray(data.towers) ? data.towers : [];
      const nextKeeps = Array.isArray(data.keeps) ? data.keeps : [];
      const snapshot = {
        towers: resolved,
        holdings: { keeps: nextKeeps, land: landHoldsFrom(resolved) },
        map: data.map ?? null,
      };
      if (read !== latest.current) return snapshot;
      setTowers(resolved);
      setKeeps(nextKeeps);
      setMap(data.map ?? null);
      setLoaded(true);
      return snapshot;
    } catch (e) {
      console.error('[board] Failed to load:', e);
      if (read === latest.current) setError('Could not load the grid.');
      return null;
    } finally {
      if (read === latest.current) setIsLoading(false);
    }
  }, []);

  const followLive = useCallback(() => {
    live.current = true;
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
    followLive,
  };
};
