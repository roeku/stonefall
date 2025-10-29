import React, { useState, useEffect } from 'react';
import { TowerMapEntry } from '../../shared/types/api';

interface TowerInfoHUDProps {
  tower: TowerMapEntry;
  rank?: number | undefined;
  playerScore?: number;
  playerBlocks?: number;
  playerPerfectBlocks?: number;
  onClose: () => void;
  onVisitProfile: (userId: string, username: string) => void;
}

export const TowerInfoPopup: React.FC<TowerInfoHUDProps> = ({
  tower,
  rank,
  playerScore = 0,
  playerBlocks = 0,
  playerPerfectBlocks = 0,
  onClose,
  onVisitProfile
}) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 200);
    return () => clearTimeout(timer);
  }, []);

  const formatScore = (score: number) => {
    return score.toLocaleString();
  };

  const getComparison = (theirValue: number, myValue: number) => {
    if (myValue === 0) return null;
    const ratio = theirValue / myValue;
    if (ratio > 1.5) return { text: `${(ratio).toFixed(1)}x better`, type: 'superior' };
    if (ratio > 1.1) return { text: 'slightly better', type: 'better' };
    if (ratio < 0.7) return { text: `${(1 / ratio).toFixed(1)}x behind you`, type: 'inferior' };
    if (ratio < 0.9) return { text: 'behind you', type: 'worse' };
    return { text: 'similar to you', type: 'similar' };
  };

  const handleProfileClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onVisitProfile(tower.userId, tower.username);
  };

  const handleBackdropClick = () => {
    onClose();
  };

  const scoreComparison = getComparison(tower.score, playerScore);
  const blocksComparison = getComparison(tower.blockCount, playerBlocks);
  const perfectComparison = getComparison(tower.perfectStreak, playerPerfectBlocks);

  return (
    <>
      {/* Backdrop for closing */}
      <div
        className="tron-hud-backdrop"
        onClick={handleBackdropClick}
      />

      {/* Vertical Tower Info Card */}
      <div className={`tron-tower-card ${isVisible ? 'visible' : ''}`}>
        <div className="tron-card-scan"></div>

        {/* Header with rank and username */}
        <div className="tron-card-header" onClick={handleProfileClick}>
          <div className="tron-rank-badge">
            #{rank !== undefined ? rank + 1 : '?'}
          </div>
          <div className="tron-username">
            {tower.username.toUpperCase()}
          </div>
        </div>

        {/* Vertical metrics stack */}
        <div className="tron-metrics-stack">
          <div className="tron-metric-block">
            <div className="tron-metric-value">{formatScore(tower.score)}</div>
            <div className="tron-metric-label">SCORE</div>
            {scoreComparison && (
              <div className={`tron-comparison-badge tron-${scoreComparison.type}`}>
                {scoreComparison.text.toUpperCase()}
              </div>
            )}
          </div>

          <div className="tron-metric-block">
            <div className="tron-metric-value">{tower.blockCount}</div>
            <div className="tron-metric-label">BLOCKS</div>
            {blocksComparison && (
              <div className={`tron-comparison-badge tron-${blocksComparison.type}`}>
                {blocksComparison.text.toUpperCase()}
              </div>
            )}
          </div>

          <div className="tron-metric-block">
            <div className="tron-metric-value">{tower.perfectStreak}</div>
            <div className="tron-metric-label">PERFECT BLOCKS</div>
            {perfectComparison && (
              <div className={`tron-comparison-badge tron-${perfectComparison.type}`}>
                {perfectComparison.text.toUpperCase()}
              </div>
            )}
          </div>
        </div>

        <div className="tron-card-pulse"></div>
      </div>
    </>
  );
};
