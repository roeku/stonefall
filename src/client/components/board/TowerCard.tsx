import React from 'react';
import type { TowerMapEntry } from '../../../shared/types/api';
import { factionRgb } from '../../../shared/types/factions';
import { cellKind } from '../../../shared/types/territory';
import { cellName } from '../../../shared/types/worldGrid';
import { Button, IconButton, Readout, Stat, StatRow } from '../ui/Chrome';
import { FactionDot } from '../ui/Factions';
import { BlocksIcon, CloseIcon, SparkIcon } from '../ui/icons';

interface TowerCardProps {
  tower: TowerMapEntry;
  /** True when the viewer built it. */
  mine: boolean;
  onClose: () => void;
  /** Take this tower's score into a run as the number to beat. Absent on your own towers. */
  onBeat?: (() => void) | undefined;
  /** Take the land it stands on: a run aimed at its cell. Absent when it cannot be reached. */
  onTake?: (() => void) | undefined;
  /** Why it cannot be taken, when it cannot. */
  blocked?: string | null | undefined;
}

/**
 * Who built the selected tower and how it went.
 *
 * This is the board's whole social reason to exist: a tower is somebody's run, and tapping it
 * should tell you whose and how good. The scene frames the tower; this names it, and offers the
 * one thing to do about it: beat it, or, if it is holding land, take the land. A tower you cannot
 * reach is still a score you can chase, so the chase stays on offer when the take does not.
 */
export const TowerCard: React.FC<TowerCardProps> = ({
  tower,
  mine,
  onClose,
  onBeat,
  onTake,
  blocked,
}) => {
  const onLand =
    tower.gridX !== undefined &&
    tower.gridZ !== undefined &&
    cellKind(tower.gridX, tower.gridZ) === 'land';
  const where =
    tower.gridX !== undefined && tower.gridZ !== undefined
      ? cellName(tower.gridX, tower.gridZ)
      : null;
  return (
    <div
      className="board-card"
      role="dialog"
      aria-label={`Tower by ${tower.username}`}
      style={{ ['--rim-rgb' as string]: factionRgb(tower.faction) }}
    >
      <Readout
        label={
          <>
            <FactionDot faction={tower.faction} />
            {mine ? 'Your tower' : `u/${tower.username}`}
            {onLand && where && <span className="board-card__rank">{where}</span>}
          </>
        }
        value={tower.score.toLocaleString()}
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
            title="Perfects"
            tone="good"
          />
        )}
      </StatRow>
      {onLand && onTake && (
        <Button onClick={onTake} className="board-card__challenge">
          {mine ? 'Replace it' : 'Take it'}
        </Button>
      )}
      {onLand && !onTake && blocked && <span className="board-card__note">{blocked}</span>}
      {!mine && onBeat && !(onLand && onTake) && (
        // The point of naming the builder is to be able to do something about them.
        <Button onClick={onBeat} className="board-card__challenge">
          Beat it
        </Button>
      )}
      <IconButton label="Close" onClick={onClose} className="board-card__close">
        <CloseIcon />
      </IconButton>
    </div>
  );
};
