import { useCallback, useMemo, useRef, useState } from 'react';
import type { GetBoardResponse, KeepRecord, MapInfo, TowerMapEntry } from '../../shared/types/api';
import {
  KEEP_RADIUS,
  keepRadiusOr,
  landHoldsFrom,
  type Holdings,
} from '../../shared/types/territory';
import { unpackTower } from '../../shared/types/packedBlocks';
import { EARLY, fetchEarly } from '../utils/early';

/**
 * The keep size of the map a board shows. A map stores the size it opened with; before the first
 * read there is no map yet, and anything drawn then is on today's rules.
 */
export const keepRadiusOf = (map: MapInfo | null): number =>
  map ? keepRadiusOr(map.keepRadius) : KEEP_RADIUS;

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
  /** How big this map's keeps are: 0 is one cell, 1 the 3x3 of maps opened before it shrank. */
  keepRadius: number;
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
      const res = await (live.current ? fetch('/api/board') : fetchEarly(EARLY.board));
      if (!res.ok) {
        if (read === latest.current) setError('Could not load the grid.');
        return null;
      }
      const data = (await res.json()) as GetBoardResponse;
      const resolved = Array.isArray(data.towers) ? data.towers.map(unpackTower) : [];
      const nextKeeps = Array.isArray(data.keeps) ? data.keeps : [];
      const snapshot = {
        towers: resolved,
        holdings: {
          keeps: nextKeeps,
          land: landHoldsFrom(resolved, keepRadiusOf(data.map ?? null)),
        },
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

  const keepRadius = keepRadiusOf(map);
  const holdings = useMemo<Holdings>(
    () => ({ keeps, land: landHoldsFrom(towers, keepRadius) }),
    [keeps, towers, keepRadius]
  );

  return {
    towers,
    keeps,
    holdings,
    map,
    keepRadius,
    totalCount: towers.length,
    isLoading,
    loaded,
    error,
    refresh,
    followLive,
  };
};
