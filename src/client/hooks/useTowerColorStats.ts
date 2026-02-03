import * as React from 'react';
import { GetTowerColorStatsResponse } from '../../shared/types/api';

const DEFAULT_POLL_INTERVAL_MS = 45000;

const LOCAL_CACHE_PREFIX = 'stonefall99:tower-color-stats:';
// Keep a longer-lived cache so the UI can choose colors immediately while data streams in.
const LOCAL_CACHE_MAX_AGE_MS = 1000 * 60 * 60 * 6; // 6 hours

// Simple in-memory cache
const statsCache: { [key: string]: { data: GetTowerColorStatsResponse; timestamp: number } } = {};
const CACHE_TTL_MS = 30000; // 30 seconds cache validity

export const useTowerColorStats = (
  pollIntervalMs: number = DEFAULT_POLL_INTERVAL_MS,
  type: 'all-time' | 'daily' = 'all-time',
  cycleId?: string,
  enabled: boolean = true
): GetTowerColorStatsResponse | null => {
  const [stats, setStats] = React.useState<GetTowerColorStatsResponse | null>(() => {
    if (!enabled) return null;
    const cacheKey = `${type}-${cycleId || ''}`;
    const cached = statsCache[cacheKey];
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.data;
    }

    // Fallback to localStorage to keep colors stable during streaming / cold starts.
    if (typeof window !== 'undefined') {
      try {
        const raw = window.localStorage.getItem(`${LOCAL_CACHE_PREFIX}${cacheKey}`);
        if (raw) {
          const parsed = JSON.parse(raw) as { timestamp: number; data: GetTowerColorStatsResponse };
          if (
            parsed?.data &&
            typeof parsed.timestamp === 'number' &&
            Date.now() - parsed.timestamp < LOCAL_CACHE_MAX_AGE_MS
          ) {
            return parsed.data;
          }
        }
      } catch {
        // ignore
      }
    }
    return null;
  });

  const nextFetchAtRef = React.useRef(0);
  const backoffMsRef = React.useRef(pollIntervalMs);
  const lastLoggedAtRef = React.useRef(0);

  React.useEffect(() => {
    if (!enabled) return;

    // Reset backoff / gating whenever the query key changes.
    // Without this, a previous backoff (e.g. after a 503) can delay updates when switching views.
    nextFetchAtRef.current = 0;
    backoffMsRef.current = pollIntervalMs;

    let isMounted = true;
    const fetchStats = async (): Promise<void> => {
      const now = Date.now();
      if (now < nextFetchAtRef.current) {
        return;
      }

      // Check cache again before fetching
      const cacheKey = `${type}-${cycleId || ''}`;
      const cached = statsCache[cacheKey];
      if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        if (isMounted) {
          setStats(cached.data);
        }
        // If cached data is fresh enough, we might skip fetch,
        // but since this is a polling hook, we probably want to fetch eventually.
        // However, to prevent "fetching too often" on mount/remount, we use the cache.
        // If we are in the polling loop, we should fetch.
      }

      try {
        const cycleParam = cycleId ? `&cycleId=${cycleId}` : '';
        const response = await fetch(`/api/game/tower-stats?type=${type}${cycleParam}`);
        if (!response.ok) {
          const error = new Error(`Failed to fetch tower stats: ${response.status}`);
          (error as any).status = response.status;
          throw error;
        }
        const payload: GetTowerColorStatsResponse = await response.json();

        // Update cache
        statsCache[cacheKey] = { data: payload, timestamp: Date.now() };

        if (typeof window !== 'undefined') {
          try {
            window.localStorage.setItem(
              `${LOCAL_CACHE_PREFIX}${cacheKey}`,
              JSON.stringify({ timestamp: Date.now(), data: payload })
            );
          } catch {
            // ignore
          }
        }

        if (isMounted) {
          setStats(payload);
        }

        // Reset backoff on success.
        backoffMsRef.current = pollIntervalMs;
        nextFetchAtRef.current = Date.now() + pollIntervalMs;
      } catch (error) {
        const status = (error as any)?.status as number | undefined;
        const isServiceUnavailable = status === 503;

        // Exponential backoff on transient failures to avoid hammering the endpoint.
        const prev = backoffMsRef.current || pollIntervalMs;
        const next = Math.min(Math.max(pollIntervalMs, prev * 2), 5 * 60 * 1000);
        backoffMsRef.current = next;
        nextFetchAtRef.current = Date.now() + next;

        if (isMounted) {
          // If fetch fails, keep the last-known stats (in-memory or localStorage) rather than
          // clearing to null, to prevent mid-stream color shifts.
          const cacheKey = `${type}-${cycleId || ''}`;
          const cached = statsCache[cacheKey];
          if (cached) {
            setStats(cached.data);
          } else {
            setStats((prev) => {
              if (prev) return prev;
              if (typeof window !== 'undefined') {
                try {
                  const raw = window.localStorage.getItem(`${LOCAL_CACHE_PREFIX}${cacheKey}`);
                  if (raw) {
                    const parsed = JSON.parse(raw) as {
                      timestamp: number;
                      data: GetTowerColorStatsResponse;
                    };
                    if (parsed?.data) {
                      return parsed.data;
                    }
                  }
                } catch {
                  // ignore
                }
              }
              return null;
            });
          }
        }

        // Avoid spamming console when the backend is temporarily unavailable.
        const shouldLog = Date.now() - lastLoggedAtRef.current > 30_000;
        if (shouldLog) {
          lastLoggedAtRef.current = Date.now();
          if (isServiceUnavailable) {
            console.warn('useTowerColorStats: tower stats service unavailable (503); backing off', {
              type,
              cycleId,
              nextRetryMs: backoffMsRef.current,
            });
          } else {
            console.error('useTowerColorStats: unable to load tower stats', error);
          }
        }
      }
    };

    // Initial fetch (if not cached or stale)
    const cacheKey = `${type}-${cycleId || ''}`;
    const cached = statsCache[cacheKey];
    if (!cached || Date.now() - cached.timestamp >= CACHE_TTL_MS) {
      fetchStats();
    } else {
      setStats(cached.data);
    }

    const intervalId = window.setInterval(fetchStats, pollIntervalMs);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, [pollIntervalMs, type, cycleId]);

  return stats;
};
