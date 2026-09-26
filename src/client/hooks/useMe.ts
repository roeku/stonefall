import { useCallback, useMemo, useState } from 'react';
import type {
  EnterResponse,
  FactionId,
  GetMeResponse,
  PlaceTowerResponse,
  PlayerGrid,
  PlayerRegion,
  RemovePlacementResponse,
  SetFactionResponse,
} from '../../shared/types/api';
import { defaultFactionFor } from '../../shared/types/factions';

/**
 * The player: who they are, where their plot is, what colour they fly.
 *
 * The server is the authority on all of it. Mutations adopt what the server returns rather than
 * patching local state, so a rejected raise can never leave the UI showing a tower that is not
 * really there.
 */
export interface MeHook {
  userId: string | null;
  username: string | null;
  grid: PlayerGrid | null;
  /** The player's plot. Null until they have entered, which happens on their first run. */
  region: PlayerRegion | null;
  faction: FactionId;
  /** True once the player has picked a colour rather than being handed one. */
  chosen: boolean;
  isLoading: boolean;
  /** Message from the last rejected mutation, for surfacing to the player. */
  error: string | null;
  clearError: () => void;
  refresh: () => Promise<void>;
  /** Claim a plot. Idempotent. Resolves with the region, or null when signed out. */
  enter: () => Promise<PlayerRegion | null>;
  /**
   * Change sides. Resolves with whether it took, and the session ids of the towers that came
   * down with it: switching colours costs everything standing on today's map.
   */
  setFaction: (faction: FactionId) => Promise<{ ok: boolean; razed: string[] }>;
  /** `day` is the day of the board the cell was picked on; see PlaceTowerRequest. */
  raise: (
    sessionId: string,
    gridX: number,
    gridZ: number,
    day?: string | null
  ) => Promise<PlaceTowerResponse>;
  remove: (sessionId: string) => Promise<boolean>;
}

export const useMe = (): MeHook => {
  const [userId, setUserId] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [grid, setGrid] = useState<PlayerGrid | null>(null);
  const [region, setRegion] = useState<PlayerRegion | null>(null);
  const [factionState, setFactionState] = useState<FactionId | null>(null);
  const [chosen, setChosen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/me');
      if (!res.ok) return;
      const data = (await res.json()) as GetMeResponse;
      setUserId(data.userId);
      setUsername(data.username);
      setGrid(data.grid);
      setRegion(data.region ?? null);
      setFactionState(data.faction);
      setChosen(data.chosen);
    } catch (e) {
      console.error('[me] Failed to load:', e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const enter = useCallback(async (): Promise<PlayerRegion | null> => {
    try {
      const res = await fetch('/api/enter', { method: 'POST' });
      if (!res.ok) return null;
      const data = (await res.json()) as EnterResponse;
      if (!data.success || !data.region) return null;
      setRegion(data.region);
      if (data.faction) setFactionState(data.faction);
      return data.region;
    } catch (e) {
      console.error('[me] Failed to enter:', e);
      return null;
    }
  }, []);

  const setFaction = useCallback(
    async (faction: FactionId): Promise<{ ok: boolean; razed: string[] }> => {
      // Optimistic: the swatch answers the tap, the server confirms behind it.
      const previous = factionState;
      setFactionState(faction);
      setChosen(true);
      try {
        const res = await fetch('/api/me/faction', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ faction }),
        });
        const data = (await res.json()) as SetFactionResponse;
        if (!res.ok || !data.success) {
          setFactionState(previous);
          return { ok: false, razed: [] };
        }
        // Everything standing came down, so the plot is empty now.
        if ((data.razed?.length ?? 0) > 0) {
          setGrid((g) => (g ? { ...g, placements: [] } : g));
        }
        return { ok: true, razed: data.razed ?? [] };
      } catch {
        setFactionState(previous);
        return { ok: false, razed: [] };
      }
    },
    [factionState]
  );

  const raise = useCallback(
    async (
      sessionId: string,
      gridX: number,
      gridZ: number,
      day?: string | null
    ): Promise<PlaceTowerResponse> => {
      setError(null);
      try {
        const res = await fetch('/api/grid/raise', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // The day of the board the cell was picked on, so a raise aimed just before the map
          // turned over is refused instead of landing on the new map.
          body: JSON.stringify({ sessionId, gridX, gridZ, ...(day ? { day } : {}) }),
        });
        const data = (await res.json()) as PlaceTowerResponse;
        if (!res.ok || !data.success) {
          // Rejections are expected gameplay outcomes -- a bar not beaten, a cell out of reach --
          // and the caller says them as a hint that fades. Only a failure to get an answer at
          // all is left standing as an error.
          return { ...data, success: false };
        }
        if (data.grid) setGrid(data.grid);
        return data;
      } catch (e) {
        console.error('[me] Failed to raise:', e);
        setError('Could not raise it there.');
        return { type: 'place_tower', success: false, message: 'Could not raise it there.' };
      }
    },
    []
  );

  const remove = useCallback(async (sessionId: string): Promise<boolean> => {
    setError(null);
    try {
      const res = await fetch('/api/grid/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      const data = (await res.json()) as RemovePlacementResponse;
      if (!res.ok || !data.success) {
        setError(data.message ?? 'Could not take that down.');
        return false;
      }
      if (data.grid) setGrid(data.grid);
      return true;
    } catch (e) {
      console.error('[me] Failed to remove:', e);
      setError('Could not take that down.');
      return false;
    }
  }, []);

  const faction = useMemo(
    () => factionState ?? defaultFactionFor(userId ?? 'anonymous'),
    [factionState, userId]
  );

  return {
    userId,
    username,
    grid,
    region,
    faction,
    chosen,
    isLoading,
    error,
    clearError,
    refresh,
    enter,
    setFaction,
    raise,
    remove,
  };
};
