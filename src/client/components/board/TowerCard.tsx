import React from 'react';
import type { TowerMapEntry } from '../../../shared/types/api';
import { Button, IconButton, Readout, Stat, StatRow } from '../ui/Chrome';
import { BlocksIcon, CloseIcon, SparkIcon, StackIcon } from '../ui/icons';

interface TowerCardProps {
  tower: TowerMapEntry;
  /** True when the viewer built it. */
  mine: boolean;
  /** 1-based rank by score among everything on the board. */
  rank: number;
  of: number;
  onClose: () => void;
  /** Take this tower's score into a run as the number to beat. Absent on your own towers. */
  onChallenge?: (() => void) | undefined;
}

/**
 * Who built the selected tower and how it went.
 *
 * This is the board's whole social reason to exist: a tower is somebody's run, and tapping it
 * should tell you whose and how good. The scene frames the tower; this names it.
 */
export const TowerCard: React.FC<TowerCardProps> = ({
  tower,
  mine,
  rank,
  of,
  onClose,
  onChallenge,
}) => {
  const stacked = (tower.stackBaseY ?? 0) > 0;
  return (
    <div className="board-card" role="dialog" aria-label={`Tower by ${tower.username}`}>
      <Readout
        label={
          <>
            {mine ? 'Your tower' : `u/${tower.username}`}
            <span className="board-card__rank">
              #{rank.toLocaleString()} of {of.toLocaleString()}
            </span>
          </>
        }
        value={`${tower.score.toLocaleString()} pts`}
      />
      <StatRow>
        <Stat
          icon={<BlocksIcon />}
          value={(tower.blockCount ?? tower.towerBlocks.length).toLocaleString()}
          title="Blocks"
        />
        {tower.perfectStreak > 0 && (
          <Stat
            icon={<SparkIcon />}
            value={tower.perfectStreak.toLocaleString()}
            title="Perfect placements"
            tone="good"
          />
        )}
        {stacked && <Stat icon={<StackIcon />} value="Stacked" title="Stacked on another tower" />}
      </StatRow>
      {!mine && onChallenge && (
        // The point of naming the builder is to be able to do something about them.
        <Button onClick={onChallenge} className="board-card__challenge">
          Beat {tower.score.toLocaleString()}
        </Button>
      )}
      <IconButton label="Close" onClick={onClose} className="board-card__close">
        <CloseIcon />
      </IconButton>
    </div>
  );
};
