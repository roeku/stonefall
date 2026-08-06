import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  TournamentStatusResponse,
  FindMatchResponse,
  ReportMatchResponse,
  TournamentLeaderboardResponse,
  ReplayData,
  TowerMapEntry,
} from '../../shared/types/api';

interface UseTournament {
  status: TournamentStatusResponse | null;
  loading: boolean;
  error: string | null;
  currentMatch: FindMatchResponse | null;
  isFindingMatch: boolean;
  fetchStatus: () => Promise<void>;
  findMatch: () => Promise<FindMatchResponse | null>;
  reportMatch: (result: 'win' | 'loss', score: number) => Promise<ReportMatchResponse | null>;
  submitGhost: (replayData: ReplayData, score: number, sessionId?: string) => Promise<boolean>;
  clearMatch: () => void;
  fetchTournamentTowers: (limit?: number) => Promise<TournamentTower[]>;
  fetchMyTournamentTowers: () => Promise<TowerMapEntry[]>;
  fetchOpponentTowers: (opponentUserId: string) => Promise<TowerMapEntry[]>;
  fetchChallengeTower: (towerId: string) => Promise<any | null>;
  fetchEloLeaderboard: (options?: {
    view?: 'top' | 'around';
    page?: number;
    pageSize?: number;
  }) => Promise<TournamentLeaderboardResponse | null>;
}

interface TournamentTower {
  userId: string;
  elo: number;
  ghostData: string | null;
  isDefeated: boolean;
}

const opponentTowersInFlight = new Map<string, Promise<TowerMapEntry[]>>();
const opponentTowersRecentCache = new Map<string, { towers: TowerMapEntry[]; at: number }>();
const OPPONENT_TOWERS_CACHE_TTL_MS = 5000;
const reportMatchInFlight = new Map<string, Promise<ReportMatchResponse | null>>();
const reportMatchCompleted = new Map<string, ReportMatchResponse>();

export const useTournament = (): UseTournament => {
  const [status, setStatus] = useState<TournamentStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentMatch, setCurrentMatch] = useState<FindMatchResponse | null>(null);
  const [isFindingMatch, setIsFindingMatch] = useState(false);

  // Poll status occasionally or on mount
  const fetchStatus = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/tournament/status');
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      } else {
        // If not authenticated or other error, might just be null
        const err = await res.text();
        console.warn('Failed to fetch tournament status:', err);
      }
    } catch (e) {
      console.error('Error fetching tournament status:', e);
      setError('Connection error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const findMatch = useCallback(async () => {
    if (!status) {
      console.warn('[MATCHMAKING] status not loaded yet - blocking findMatch');
      setError('Status not ready');
      return null;
    }
    if (status.tickets <= 0) {
      console.warn('[MATCHMAKING] No tickets available - blocking findMatch');
      setError('No tickets available');
      return null;
    }

    setIsFindingMatch(true);
    setError(null);

    try {
      console.log('[MATCHMAKING] findMatch POST /api/tournament/find-match');
      // Add a small artificial delay for UX if the API is instant
      const [res] = await Promise.all([
        fetch('/api/tournament/find-match', { method: 'POST' }),
        new Promise((r) => setTimeout(r, 1500)),
      ]);

      if (res.ok) {
        const data: FindMatchResponse = await res.json();
        console.log('[MATCHMAKING] findMatch success', {
          matchId: data.matchId,
          opponentUserId: data.opponent?.userId,
          opponentUsername: data.opponent?.username,
        });
        setCurrentMatch(data);
        // Note: Ticket is NOT deducted here - only when match is reported
        return data;
      } else {
        const txt = await res.text();
        console.warn('[MATCHMAKING] findMatch failed', txt);
        setError(`Failed to find match: ${txt}`);
        return null; // Or throw
      }
    } catch (e) {
      console.error('[MATCHMAKING] Network error during matchmaking', e);
      setError('Network error during matchmaking');
      return null;
    } finally {
      setIsFindingMatch(false);
    }
  }, [status]);

  const reportMatch = useCallback(
    async (result: 'win' | 'loss', score: number, defeatedSessionId?: string) => {
      if (!currentMatch) return null;

      const matchId = currentMatch.matchId;
      const completed = reportMatchCompleted.get(matchId);
      if (completed) {
        return completed;
      }

      const inFlight = reportMatchInFlight.get(matchId);
      if (inFlight) {
        return inFlight;
      }

      const requestPromise = (async (): Promise<ReportMatchResponse | null> => {
        try {
          const res = await fetch('/api/tournament/report-match', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              matchId,
              result,
              score,
              ...(defeatedSessionId && { defeatedSessionId }),
            }),
          });

          if (res.ok) {
            const data: ReportMatchResponse = await res.json();
            reportMatchCompleted.set(matchId, data);
            // Update local status with new Elo/Tickets/Rank
            setStatus((prev) =>
              prev
                ? {
                    ...prev,
                    elo: data.newElo,
                    tickets: data.newTickets,
                    rank: data.newRank,
                  }
                : null
            );
            return data;
          } else {
            console.error('Failed to report match');
            return null;
          }
        } catch (e) {
          console.error(e);
          return null;
        } finally {
          reportMatchInFlight.delete(matchId);
        }
      })();

      reportMatchInFlight.set(matchId, requestPromise);
      return requestPromise;
    },
    [currentMatch]
  );

  const submitGhost = useCallback(
    async (replayData: ReplayData, score: number, sessionId?: string) => {
      try {
        const res = await fetch('/api/tournament/submit-ghost', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ replayData, score, sessionId }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.success) {
            // status update might involve rank change
            fetchStatus();
            return true;
          }
        }
        return false;
      } catch (e) {
        console.error(e);
        return false;
      }
    },
    [fetchStatus]
  );

  const clearMatch = useCallback(() => {
    setCurrentMatch(null);
  }, []);

  const fetchTournamentTowers = useCallback(
    async (limit: number = 50): Promise<TournamentTower[]> => {
      try {
        const res = await fetch(`/api/tournament/towers?limit=${limit}`);
        if (res.ok) {
          const data = await res.json();
          return data.towers || [];
        } else {
          console.error('Failed to fetch tournament towers');
          return [];
        }
      } catch (e) {
        console.error('Error fetching tournament towers:', e);
        return [];
      }
    },
    []
  );

  const fetchMyTournamentTowers = useCallback(async (): Promise<TowerMapEntry[]> => {
    try {
      // Use challenge towers endpoint which has all towers submitted in matchmaking
      const res = await fetch('/api/challenge/my-towers');
      if (res.ok) {
        const data = await res.json();
        // Data may be simplified tower format OR full TowerMapEntry format (from game session fallback)
        const towers = data.towers || [];
        return towers;
      } else {
        console.error('Failed to fetch user challenge towers');
        return [];
      }
    } catch (e) {
      console.error('Error fetching user challenge towers:', e);
      return [];
    }
  }, []);

  const fetchOpponentTowers = useCallback(
    async (opponentUserId: string): Promise<TowerMapEntry[]> => {
      if (!opponentUserId) {
        return [];
      }

      const now = Date.now();
      const cached = opponentTowersRecentCache.get(opponentUserId);
      if (cached && now - cached.at < OPPONENT_TOWERS_CACHE_TTL_MS) {
        return cached.towers;
      }

      const inFlight = opponentTowersInFlight.get(opponentUserId);
      if (inFlight) {
        return inFlight;
      }

      const requestPromise = (async (): Promise<TowerMapEntry[]> => {
        try {
          // Use challenge towers endpoint which has all towers submitted in matchmaking
          const res = await fetch(
            `/api/challenge/opponent-towers?userId=${encodeURIComponent(opponentUserId)}`
          );
          if (res.ok) {
            const data = await res.json();
            // Data may be simplified tower format OR full TowerMapEntry format (from game session fallback)
            const towers = data.towers || [];
            opponentTowersRecentCache.set(opponentUserId, { towers, at: Date.now() });
            return towers;
          } else {
            console.error('Failed to fetch opponent challenge towers');
            return [];
          }
        } catch (e) {
          console.error('Error fetching opponent challenge towers:', e);
          return [];
        } finally {
          opponentTowersInFlight.delete(opponentUserId);
        }
      })();

      opponentTowersInFlight.set(opponentUserId, requestPromise);
      return requestPromise;
    },
    []
  );

  const fetchChallengeTower = useCallback(async (towerId: string): Promise<any | null> => {
    try {
      const res = await fetch(`/api/challenge/tower/${encodeURIComponent(towerId)}`);
      if (res.ok) {
        const data = await res.json();
        return data;
      } else {
        console.error('Failed to fetch challenge tower details');
        return null;
      }
    } catch (e) {
      console.error('Error fetching challenge tower:', e);
      return null;
    }
  }, []);

  const fetchEloLeaderboard = useCallback(
    async (options?: {
      view?: 'top' | 'around';
      page?: number;
      pageSize?: number;
    }): Promise<TournamentLeaderboardResponse | null> => {
      try {
        const params = new URLSearchParams();
        if (options?.view) params.set('view', options.view);
        if (typeof options?.page === 'number') params.set('page', String(options.page));
        if (typeof options?.pageSize === 'number') params.set('pageSize', String(options.pageSize));

        const query = params.toString();
        const url = query ? `/api/tournament/leaderboard?${query}` : '/api/tournament/leaderboard';
        const res = await fetch(url);
        if (!res.ok) {
          return null;
        }
        const data = (await res.json()) as TournamentLeaderboardResponse;
        return data;
      } catch (e) {
        console.error('Error fetching tournament leaderboard:', e);
        return null;
      }
    },
    []
  );

  return useMemo(
    () => ({
      status,
      loading,
      error,
      currentMatch,
      isFindingMatch,
      fetchStatus,
      findMatch,
      reportMatch,
      submitGhost,
      clearMatch,
      fetchTournamentTowers,
      fetchMyTournamentTowers,
      fetchOpponentTowers,
      fetchOpponentTowers,
      fetchChallengeTower,
      fetchEloLeaderboard,
    }),
    [
      status,
      loading,
      error,
      currentMatch,
      isFindingMatch,
      fetchStatus,
      findMatch,
      reportMatch,
      submitGhost,
      clearMatch,
      fetchTournamentTowers,
      fetchMyTournamentTowers,
      fetchOpponentTowers,
      fetchChallengeTower,
      fetchEloLeaderboard,
    ]
  );
};

export type { TournamentTower };
