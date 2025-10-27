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
  saveGameSession: (sessionData: SaveGameSessionRequest['sessionData']) => Promise<string | null>;
  getUserStats: () => Promise<{
    stats: UserStats | null;
    recentSessions: GameSessionData[];
  } | null>;
  getTowerMap: (
    limit?: number,
    offset?: number
  ) => Promise<{ towers: TowerMapEntry[]; totalCount: number } | null>;
  getLeaderboard: (limit?: number) => Promise<{ highScores: any[]; perfectStreaks: any[] } | null>;
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

export const useGameData = (): GameDataHook => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const handleApiCall = useCallback(
    async <T>(
      apiCall: () => Promise<Response>,
      successHandler: (data: any) => T
    ): Promise<T | null> => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await apiCall();

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
          throw new Error(errorData.message || `HTTP ${response.status}`);
        }

        const data = await response.json();
        return successHandler(data);
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
    async (sessionData: SaveGameSessionRequest['sessionData']): Promise<string | null> => {
      return handleApiCall(
        () =>
          fetch('/api/game/save-session', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ sessionData }),
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
      limit: number = 100,
      offset: number = 0
    ): Promise<{ towers: TowerMapEntry[]; totalCount: number } | null> => {
      return handleApiCall(
        () => fetch(`/api/game/tower-map?limit=${limit}&offset=${offset}`),
        (data: GetTowerMapResponse) => ({
          towers: data.towers,
          totalCount: data.totalCount,
        })
      );
    },
    [handleApiCall]
  );

  const getLeaderboard = useCallback(
    async (limit: number = 10): Promise<{ highScores: any[]; perfectStreaks: any[] } | null> => {
      return handleApiCall(
        () => fetch(`/api/game/leaderboard?limit=${limit}`),
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
