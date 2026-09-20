import React from 'react';
import type { TowerMapEntry } from '../../../shared/types/api';
import type { FactionId } from '../../../shared/types/factions';
import { factionName, factionRgb } from '../../../shared/types/factions';
import {
  cellKind,
  regionOfCell,
  type Holdings,
  type PlacementVerdict,
} from '../../../shared/types/territory';
import { cellLabel, cellName, plotNumber } from '../../../shared/types/worldGrid';
import { Button, IconButton, Readout, Stat, StatRow } from '../ui/Chrome';
import { FactionDot } from '../ui/Factions';
import { BlocksIcon, CloseIcon, SparkIcon } from '../ui/icons';
import type { GridTarget } from './BoardScene';

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
}

/** Whose plot a cell is on, the way a player would say it. */
const plotLabel = (
  x: number,
  z: number,
  holdings: Holdings,
  myRegion: { rx: number; rz: number } | null
): string => {
  const region = regionOfCell(x, z);
  if (myRegion && myRegion.rx === region.rx && myRegion.rz === region.rz) return 'your plot';
  const owner = holdings.keeps.find((k) => k.rx === region.rx && k.rz === region.rz);
  return owner ? `u/${owner.username}'s plot` : `plot ${plotNumber(x, z)}`;
};

/**
 * What a tapped cell is, and what can be done about it.
 *
 * The map is only a map until a cell answers a tap. This card is the answer: whose ground it
 * is, what stands there, what it would take to hold it, and the one button that starts that.
 * Cells are named the way the comments name them, so a card and a thread agree.
 */
export const CellCard: React.FC<CellCardProps> = ({
  cell,
  holdings,
  tower,
  myUserId,
  myFaction,
  myRegion,
  judge,
  onClose,
  onClaim,
  onTake,
}) => {
  const kind = cellKind(cell.x, cell.z);
  const region = regionOfCell(cell.x, cell.z);
  const name = cellName(cell.x, cell.z);
  const label = cellLabel(cell.x, cell.z);
  const plot = plotLabel(cell.x, cell.z, holdings, myRegion);

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
              {mine ? 'Your keep' : owner ? `u/${owner.username}'s keep` : 'A keep'}
            </>
          }
          value={
            mine ? 'Only you build here' : owner ? 'Only they build here' : 'Kept for a newcomer'
          }
        />
        <StatRow>
          {tower && (
            <Stat
              icon={<BlocksIcon />}
              value={(tower.blockCount ?? 0).toLocaleString()}
              title="Blocks"
            />
          )}
          <Stat value={name} title={`Cell ${label}`} />
        </StatRow>
        <IconButton label="Close" onClick={onClose} className="board-card__close">
          <CloseIcon />
        </IconButton>
      </div>
    );
  }

  const hold = holdings.land.find((h) => h.x === cell.x && h.z === cell.z);
  // Judged with a score one above the bar: the question here is whether the cell can be had at
  // all (reach, the cap), not whether any particular tower beats it.
  const probe = judge(cell.x, cell.z, (hold?.score ?? 0) + 1);
  const blocked = probe.ok ? null : probe.reason;

  if (!hold) {
    return (
      <div className="board-card" role="dialog" aria-label={`Open land at ${label}`}>
        <Readout label="Open land" value={blocked ? 'Not yet' : name} />
        <StatRow>
          <Stat value={`${name}, ${plot}`} title={`Cell ${label}`} />
        </StatRow>
        <span className="board-card__note">{blocked ?? 'Finish a run and it is yours.'}</span>
        {!blocked && (
          <Button onClick={onClaim} className="board-card__challenge">
            Claim it
          </Button>
        )}
        <IconButton label="Close" onClick={onClose} className="board-card__close">
          <CloseIcon />
        </IconButton>
      </div>
    );
  }

  const mine = myUserId !== null && hold.userId === myUserId;
  const bar = hold.score.toLocaleString();
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
            <span className="board-card__rank">{factionName(hold.faction)}</span>
          </>
        }
        value={bar}
      />
      <StatRow>
        {tower && (
          <Stat
            icon={<BlocksIcon />}
            value={(tower.blockCount ?? 0).toLocaleString()}
            title="Blocks"
          />
        )}
        {tower && tower.perfectStreak > 0 && (
          <Stat
            icon={<SparkIcon />}
            value={tower.perfectStreak.toLocaleString()}
            title="Perfects"
            tone="good"
          />
        )}
        <Stat value={`${name}, ${plot}`} title={`Cell ${label}`} />
      </StatRow>
      {!blocked && (
        <Button
          onClick={() => onTake(hold.username, hold.score, mine)}
          className="board-card__challenge"
        >
          {mine ? 'Replace it' : 'Take it'}: beat {bar}
        </Button>
      )}
      {blocked && <span className="board-card__note">{blocked}</span>}
      {!blocked && hold.faction === myFaction && !mine && (
        <span className="board-card__note">Your colour holds it. Beating it keeps it yours.</span>
      )}
      <IconButton label="Close" onClick={onClose} className="board-card__close">
        <CloseIcon />
      </IconButton>
    </div>
  );
};
