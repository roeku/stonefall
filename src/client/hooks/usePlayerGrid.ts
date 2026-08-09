import { useCallback, useState } from 'react';
import type {
  GetPlayerGridResponse,
  PlaceTowerResponse,
  PlayerGrid,
  RemovePlacementResponse,
  TowerMapEntry,
} from '../../shared/types/api';

/**
 * The player's home grid: which of their towers are placed where.
 *
 * The server is the authority on placement rules -- ownership, bounds, stack cap and the
 * per-player placement cap are all enforced in PlayerGridService. Mutations here return the
 * updated grid, and this hook adopts that rather than optimistically patching local state, so
 * a rejected placement can never leave the UI showing a tower that isn't really there.
 */
export interface PlayerGridHook {
  grid: PlayerGrid | null;
  towers: TowerMapEntry[];
  isLoading: boolean;
  /** Message from the last rejected mutation, for surfacing to the player. */
  error: string | null;
  clearError: () => void;
  fetchGrid: () => Promise<PlayerGrid | null>;
  /**
   * Loads placements together with the towers they reference, ready to render.
   *
   * Returns both halves because callers entering placement mode need the grid (for cell
   * occupancy) and the towers (to draw the player's own board) from a single round trip.
   */
  fetchGridTowers: () => Promise<{ grid: PlayerGrid | null; towers: TowerMapEntry[] }>;
  placeTower: (sessionId: string, gridX: number, gridZ: number) => Promise<boolean>;
  removePlacement: (sessionId: string) => Promise<boolean>;
}

export const usePlayerGrid = (): PlayerGridHook => {
  const [grid, setGrid] = useState<PlayerGrid | null>(null);
  const [towers, setTowers] = useState<TowerMapEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const fetchGrid = useCallback(async (): Promise<PlayerGrid | null> => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/grid/mine');
      if (!res.ok) return null;
      const data = (await res.json()) as GetPlayerGridResponse;
      setGrid(data.grid);
      return data.grid;
    } catch (e) {
      console.error('[grid] Failed to fetch grid:', e);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchGridTowers = useCallback(async (): Promise<{
    grid: PlayerGrid | null;
    towers: TowerMapEntry[];
  }> => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/grid/mine/towers');
      if (!res.ok) return { grid: null, towers: [] };
      const data = (await res.json()) as {
        grid: PlayerGrid | null;
        towers: TowerMapEntry[];
      };
      const resolvedGrid = data.grid ?? null;
      const resolved = Array.isArray(data.towers) ? data.towers : [];
      setGrid(resolvedGrid);
      setTowers(resolved);
      return { grid: resolvedGrid, towers: resolved };
    } catch (e) {
      console.error('[grid] Failed to resolve grid towers:', e);
      return { grid: null, towers: [] };
    } finally {
      setIsLoading(false);
    }
  }, []);

  const placeTower = useCallback(
    async (sessionId: string, gridX: number, gridZ: number): Promise<boolean> => {
      setError(null);
      try {
        const res = await fetch('/api/grid/place', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, gridX, gridZ }),
        });
        const data = (await res.json()) as PlaceTowerResponse;

        if (!res.ok || !data.success) {
          // Rejections here are expected gameplay outcomes -- cell full, grid full, not yours --
          // so they surface as a message rather than a thrown error.
          setError(data.message ?? 'Could not place that tower.');
          return false;
        }

        if (data.grid) setGrid(data.grid);
        return true;
      } catch (e) {
        console.error('[grid] Failed to place tower:', e);
        setError('Could not place that tower.');
        return false;
      }
    },
    []
  );

  const removePlacement = useCallback(async (sessionId: string): Promise<boolean> => {
    setError(null);
    try {
      const res = await fetch('/api/grid/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      const data = (await res.json()) as RemovePlacementResponse;

      if (!res.ok || !data.success) {
        setError(data.message ?? 'Could not remove that tower.');
        return false;
      }

      if (data.grid) setGrid(data.grid);
      setTowers((prev) => prev.filter((t) => t.sessionId !== sessionId));
      return true;
    } catch (e) {
      console.error('[grid] Failed to remove placement:', e);
      setError('Could not remove that tower.');
      return false;
    }
  }, []);

  return {
    grid,
    towers,
    isLoading,
    error,
    clearError,
    fetchGrid,
    fetchGridTowers,
    placeTower,
    removePlacement,
  };
};
