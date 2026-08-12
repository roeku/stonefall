import { useState, useCallback } from 'react';
import {
  GameSessionData,
  UserStats,
  TowerMapEntry,
  SaveGameSessionRequest,
  SaveGameSessionResponse,
  GetUserStatsResponse,
  GetTowerMapResponse,
  GetLeaderboardResponse,
  UpdateTowerPlacementRequest,
  UpdateTowerPlacementResponse,
} from '../../shared/types/api';

interface GameDataHook {
  // State
  isLoading: boolean;
  error: string | null;

  // Actions
  saveGameSession: (
    sessionData: SaveGameSessionRequest['sessionData'],
    replayData: SaveGameSessionRequest['replayData']
  ) => Promise<string | null>;
  getUserStats: () => Promise<{
    stats: UserStats | null;
    recentSessions: GameSessionData[];
  } | null>;
  getTowerMap: (
    limit?: number,
    offset?: number,
    type?: 'all-time' | 'daily',
    cycleId?: string
  ) => Promise<{ towers: TowerMapEntry[]; totalCount: number } | null>;
  getLeaderboard: (
    limit?: number,
    type?: 'all-time' | 'daily'
  ) => Promise<{ highScores: any[]; perfectStreaks: any[] } | null>;
  getGameSession: (sessionId: string) => Promise<GameSessionData | null>;
  updateTowerPlacement: (
    sessionId: string,
    worldX: number,
    worldZ: number,
    gridX: number,
    gridZ: number
  ) => Promise<boolean>;

  // Clear error
  clearError: () => void;
}

// Simple in-memory cache for tower map
const towerMapCache: {
  [key: string]: { data: { towers: TowerMapEntry[]; totalCount: number }; timestamp: number };
} = {};
const CACHE_TTL_MS = 30000; // 30 seconds

export const useGameData = (): GameDataHook => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const handleApiCall = useCallback(
    async <T>(
      apiCall: () => Promise<Response>,
      successHandler: (data: any) => T,
      cacheKey?: string
    ): Promise<T | null> => {
      // Check cache
      if (cacheKey) {
        const cached = towerMapCache[cacheKey];
        if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
          return cached.data as T;
        }
      }

      setIsLoading(true);
      setError(null);

      try {
        const response = await apiCall();

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
          throw new Error(errorData.message || `HTTP ${response.status}`);
        }

        const data = await response.json();
        const result = successHandler(data);

        // Update cache
        if (cacheKey && result) {
          towerMapCache[cacheKey] = { data: result as any, timestamp: Date.now() };
        }

        return result;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'An unexpected error occurred';
        setError(errorMessage);
        console.error('API call failed:', err);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const saveGameSession = useCallback(
    async (
      sessionData: SaveGameSessionRequest['sessionData'],
      replayData: SaveGameSessionRequest['replayData']
    ): Promise<string | null> => {
      return handleApiCall(
        () =>
          fetch('/api/game/save-session', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ sessionData, replayData }),
          }),
        (data: SaveGameSessionResponse) => {
          if (!data.success) {
            throw new Error(data.message || 'Failed to save game session');
          }
          return data.sessionId;
        }
      );
    },
    [handleApiCall]
  );

  const getUserStats = useCallback(async (): Promise<{
    stats: UserStats | null;
    recentSessions: GameSessionData[];
  } | null> => {
    return handleApiCall(
      () => fetch('/api/game/user-stats'),
      (data: GetUserStatsResponse) => ({
        stats: data.stats,
        recentSessions: data.recentSessions,
      })
    );
  }, [handleApiCall]);

  const getTowerMap = useCallback(
    async (
      limit: number = 300,
      offset: number = 0,
      type: 'all-time' | 'daily' = 'all-time',
      cycleId?: string
    ): Promise<{ towers: TowerMapEntry[]; totalCount: number } | null> => {
      const cacheKey = `tower-map-${limit}-${offset}-${type}-${cycleId || ''}`;
      const cycleParam = cycleId ? `&cycleId=${cycleId}` : '';
      return handleApiCall(
        () =>
          fetch(
            `/api/game/tower-map?limit=${limit}&offset=${offset}&type=${type}${cycleParam}&_t=${Date.now()}`
          ),
        (data: GetTowerMapResponse) => ({
          towers: data.towers,
          totalCount: data.totalCount,
        }),
        cacheKey
      );
    },
    [handleApiCall]
  );

  const getLeaderboard = useCallback(
    async (
      limit: number = 10,
      type: 'all-time' | 'daily' = 'all-time'
    ): Promise<{ highScores: any[]; perfectStreaks: any[] } | null> => {
      return handleApiCall(
        () => fetch(`/api/game/leaderboard?limit=${limit}&type=${type}`),
        (data: GetLeaderboardResponse) => ({
          highScores: data.highScores,
          perfectStreaks: data.perfectStreaks,
        })
      );
    },
    [handleApiCall]
  );

  const getGameSession = useCallback(
    async (sessionId: string): Promise<GameSessionData | null> => {
      return handleApiCall(
        () => fetch(`/api/game/session/${sessionId}`),
        (data: GameSessionData) => data
      );
    },
    [handleApiCall]
  );

  const updateTowerPlacement = useCallback(
    async (
      sessionId: string,
      worldX: number,
      worldZ: number,
      gridX: number,
      gridZ: number
    ): Promise<boolean> => {
      const result = await handleApiCall(
        () =>
          fetch('/api/game/update-tower-placement', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              sessionId,
              worldX,
              worldZ,
              gridX,
              gridZ,
            } as UpdateTowerPlacementRequest),
          }),
        (data: UpdateTowerPlacementResponse) => data.success
      );
      return result || false;
    },
    [handleApiCall]
  );

  return {
    isLoading,
    error,
    saveGameSession,
    getUserStats,
    getTowerMap,
    getLeaderboard,
    getGameSession,
    updateTowerPlacement,
    clearError,
  };
};
