import React from 'react';
import type { TowerMapEntry } from '../../../shared/types/api';
import {
  ArtChip,
  ArtIconButton,
  ArtPanel,
  BlocksIcon,
  CloseIcon,
  SparkIcon,
  StackIcon,
} from '../ui/tron/TronArt';

interface TowerCardProps {
  tower: TowerMapEntry;
  /** True when the viewer built it. */
  mine: boolean;
  /** 1-based rank by score among everything on the board. */
  rank: number;
  of: number;
  onClose: () => void;
}

/**
 * Who built the selected tower and how it went.
 *
 * This is the board's whole social reason to exist: a tower is somebody's run, and tapping it
 * should tell you whose and how good. The scene frames the tower; this names it.
 */
export const TowerCard: React.FC<TowerCardProps> = ({ tower, mine, rank, of, onClose }) => {
  const stacked = (tower.stackBaseY ?? 0) > 0;
  return (
    <div className="board-card" role="dialog" aria-label={`Tower by ${tower.username}`}>
      <ArtPanel className="tron-status board-card__panel">
        <span className="tron-status__title">
          {mine ? 'Your tower' : `u/${tower.username}`}
          <span className="board-card__rank">
            #{rank.toLocaleString()} of {of.toLocaleString()}
          </span>
        </span>
        <span className="tron-status__value">{tower.score.toLocaleString()} pts</span>
      </ArtPanel>
      <div className="board-card__chips">
        <ArtChip className="tron-chip" title="Blocks">
          <BlocksIcon />
          <span className="tron-chip__value">
            {(tower.blockCount ?? tower.towerBlocks.length).toLocaleString()}
          </span>
        </ArtChip>
        {tower.perfectStreak > 0 && (
          <ArtChip className="tron-chip tron-chip--perfect" title="Perfect placements">
            <SparkIcon />
            <span className="tron-chip__value">{tower.perfectStreak.toLocaleString()}</span>
          </ArtChip>
        )}
        {stacked && (
          <ArtChip className="tron-chip tron-chip--stack" title="Stacked on another tower">
            <StackIcon />
            <span className="tron-chip__value">Stacked</span>
          </ArtChip>
        )}
      </div>
      <button
        type="button"
        className="board-card__close tron-view-btn"
        aria-label="Close"
        onClick={onClose}
      >
        <ArtIconButton>
          <CloseIcon />
        </ArtIconButton>
      </button>
    </div>
  );
};
