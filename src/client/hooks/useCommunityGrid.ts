import { useCallback, useState } from 'react';
import type { TowerMapEntry } from '../../shared/types/api';

/**
 * Every placed tower in the shared grid.
 *
 * This replaces the old preload path, which fetched the top N towers by score and then
 * auto-assigned each one a cell by rank. That arrangement was the only thing ever displayed, so
 * a player's chosen placement never actually appeared -- their tower was positioned by score
 * before they were asked where to put it, and the grid drew that instead.
 *
 * Now the server returns towers already positioned at the cells their owners chose, so there is
 * nothing to assign on the client and no second source of truth for where a tower sits.
 */
export interface CommunityGridHook {
  towers: TowerMapEntry[];
  totalCount: number;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<TowerMapEntry[]>;
  clear: () => void;
}

export const useCommunityGrid = (): CommunityGridHook => {
  const [towers, setTowers] = useState<TowerMapEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<TowerMapEntry[]> => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/grid/community');
      if (!res.ok) {
        setError('Could not load the grid.');
        return [];
      }
      const data = (await res.json()) as { towers?: TowerMapEntry[] };
      const resolved = Array.isArray(data.towers) ? data.towers : [];
      setTowers(resolved);
      return resolved;
    } catch (e) {
      console.error('[grid] Failed to load community grid:', e);
      setError('Could not load the grid.');
      return [];
    } finally {
      setIsLoading(false);
    }
  }, []);

  const clear = useCallback(() => setTowers([]), []);

  return { towers, totalCount: towers.length, isLoading, error, refresh, clear };
};
