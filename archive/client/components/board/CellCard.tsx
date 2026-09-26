import React from 'react';
import type { TowerMapEntry } from '../../../shared/types/api';
import type { FactionId } from '../../../shared/types/factions';
import { factionRgb } from '../../../shared/types/factions';
import {
  cellKind,
  regionOfCell,
  type Holdings,
  type PlacementVerdict,
} from '../../../shared/types/territory';
import { cellLabel, cellName } from '../../../shared/types/worldGrid';
import { Button, IconButton, Readout, Stat, StatRow } from '../ui/Chrome';
import { FactionDot } from '../ui/Factions';
import { BlocksIcon, CloseIcon, SparkIcon } from '../ui/icons';
import type { GridTarget } from './BoardScene';
import { shortReason } from './verdictWords';

interface CellCardProps {
  cell: GridTarget;
  holdings: Holdings;
  /** The tower standing on the cell, if the board has it. */
  tower: TowerMapEntry | null;
  /** The viewer. */
  myUserId: string | null;
  myFaction: FactionId;
  myRegion: { rx: number; rz: number } | null;
  /** The rules for raising a tower of `score` here, judged against the current board. */
  judge: (x: number, z: number, score: number) => PlacementVerdict;
  onClose: () => void;
  /** Start a run aimed at this cell: claim empty land, or take a hold by beating its bar. */
  onClaim: () => void;
  /** `own` when the hold is the viewer's: the run replaces their tower rather than taking it. */
  onTake: (username: string, score: number, own: boolean) => void;
  /** A closed day's map: everything can be looked at, nothing can be started. */
  frozen?: boolean | undefined;
}

/**
 * What a tapped cell is, and what can be done about it.
 *
 * The map is only a map until a cell answers a tap. This card is the answer, in as few words as
 * it takes: whose ground it is, what stands there, and the one button that starts a run at it,
 * or the two words that say why not. Cells are named the way the comments name them.
 */
export const CellCard: React.FC<CellCardProps> = ({
  cell,
  holdings,
  tower,
  myUserId,
  myRegion,
  judge,
  onClose,
  onClaim,
  onTake,
  frozen = false,
}) => {
  const kind = cellKind(cell.x, cell.z);
  const region = regionOfCell(cell.x, cell.z);
  const name = cellName(cell.x, cell.z);
  const label = cellLabel(cell.x, cell.z);
  const close = (
    <IconButton label="Close" onClick={onClose} className="board-card__close">
      <CloseIcon />
    </IconButton>
  );

  if (kind === 'keep') {
    const mine = myRegion !== null && myRegion.rx === region.rx && myRegion.rz === region.rz;
    const owner = holdings.keeps.find((k) => k.rx === region.rx && k.rz === region.rz);
    return (
      <div
        className="board-card"
        role="dialog"
        aria-label={`Keep at ${label}`}
        style={owner ? { ['--rim-rgb' as string]: factionRgb(owner.faction) } : undefined}
      >
        <Readout
          label={
            <>
              {owner && <FactionDot faction={owner.faction} />}
              Keep
              <span className="board-card__rank">{name}</span>
            </>
          }
          value={mine ? 'Yours' : owner ? `u/${owner.username}` : 'Unclaimed'}
        />
        {close}
      </div>
    );
  }

  const hold = holdings.land.find((h) => h.x === cell.x && h.z === cell.z);
  // Judged with a score one above the bar: the question here is whether the cell can be had at
  // all (reach, the cap), not whether any particular tower beats it.
  const probe = judge(cell.x, cell.z, (hold?.score ?? 0) + 1);
  const blocked = frozen ? 'Closed' : shortReason(probe);

  if (!hold) {
    return (
      <div className="board-card" role="dialog" aria-label={`Open land at ${label}`}>
        <Readout
          label={
            <>
              Open land<span className="board-card__rank">{name}</span>
            </>
          }
          value={blocked ?? 'Free to claim'}
        />
        {!blocked && (
          <Button onClick={onClaim} className="board-card__challenge">
            Claim it
          </Button>
        )}
        {close}
      </div>
    );
  }

  const mine = myUserId !== null && hold.userId === myUserId;
  return (
    <div
      className="board-card"
      role="dialog"
      aria-label={`${label}, held by ${hold.username}`}
      style={{ ['--rim-rgb' as string]: factionRgb(hold.faction) }}
    >
      <Readout
        label={
          <>
            <FactionDot faction={hold.faction} />
            {mine ? 'Your land' : `u/${hold.username}`}
            <span className="board-card__rank">{name}</span>
          </>
        }
        value={hold.score.toLocaleString()}
      />
      {tower && (
        <StatRow>
          <Stat
            icon={<BlocksIcon />}
            value={(tower.blockCount ?? 0).toLocaleString()}
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
      )}
      {!blocked ? (
        <Button
          onClick={() => onTake(hold.username, hold.score, mine)}
          className="board-card__challenge"
        >
          {mine ? 'Replace it' : 'Take it'}
        </Button>
      ) : (
        <span className="board-card__note">{blocked}</span>
      )}
      {close}
    </div>
  );
};
