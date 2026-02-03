import React from 'react';
import { useTowerColorStats } from '../../hooks/useTowerColorStats';

interface TowerCountDisplayProps {
  count?: number | null;
}

export const TowerCountDisplay: React.FC<TowerCountDisplayProps> = ({ count }) => {
  // Only fetch stats if count is not provided
  const shouldFetch = count === undefined || count === null;
  const towerStats = useTowerColorStats(undefined, 'all-time'); // Default to all-time if falling back

  const displayCount = count ?? (shouldFetch ? towerStats?.totalCount : null) ?? null;

  return (
    <div className="tron-hud-section">
      <div className="tron-hud-label">ONLINE</div>
      <div className="tron-hud-value" style={{ fontSize: '18px', height: '24px', minWidth: 'auto' }}>
        {typeof displayCount === 'number' ? displayCount.toLocaleString() : '--'}
      </div>
    </div>
  );
};
