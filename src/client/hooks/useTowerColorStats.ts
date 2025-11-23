import * as React from 'react';
import { GetTowerColorStatsResponse } from '../../shared/types/api';

const DEFAULT_POLL_INTERVAL_MS = 45000;

export const useTowerColorStats = (
  pollIntervalMs: number = DEFAULT_POLL_INTERVAL_MS
): GetTowerColorStatsResponse | null => {
  const [stats, setStats] = React.useState<GetTowerColorStatsResponse | null>(null);

  React.useEffect(() => {
    let isMounted = true;
    const fetchStats = async (): Promise<void> => {
      try {
        const response = await fetch('/api/game/tower-stats');
        if (!response.ok) {
          throw new Error(`Failed to fetch tower stats: ${response.status}`);
        }
        const payload: GetTowerColorStatsResponse = await response.json();
        if (isMounted) {
          setStats(payload);
        }
      } catch (error) {
        if (isMounted) {
          setStats(null);
        }
        console.error('useTowerColorStats: unable to load tower stats', error);
      }
    };

    fetchStats();
    const intervalId = window.setInterval(fetchStats, pollIntervalMs);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, [pollIntervalMs]);

  return stats;
};
