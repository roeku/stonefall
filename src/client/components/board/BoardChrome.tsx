import React from 'react';
import type { PlayerRegion, TowerMapEntry } from '../../../shared/types/api';
import { MAX_STACK_PER_CELL } from '../../../shared/types/towerPlacement';
import type { GridViewState } from '../../hooks/useGridView';
import { GridViewControls } from '../ui/GridViewControls';
import { ScopeToggle } from '../ui/ScopeToggle';
import { Button, Pill, Readout, Stat, StatRow, type Tone } from '../ui/Chrome';
import { BlocksIcon, HeightIcon, SparkIcon, UsersIcon } from '../ui/icons';
import { TowerCard } from './TowerCard';
import { countBuilders, countByCell, rankOf } from './boardCells';
import type { GridTarget } from './BoardScene';

export interface BoardHint {
  key: number;
  text: string;
  tone: 'info' | 'alert' | 'good';
}

interface BoardChromeProps {
  /** Towers in the current scope. */
  towers: TowerMapEntry[];
  /** Every tower on the board, for ranks and community stats. */
  allTowers: TowerMapEntry[];
  isLoading: boolean;
  pendingTower: TowerMapEntry | null;
  region: PlayerRegion | null;
  isPlacing: boolean;
  error: string | null;
  target: GridTarget | null;
  hint: BoardHint | null;
  view: GridViewState;
  selected: TowerMapEntry | null;
  myUserId: string | null;
  /** Best score already standing on the player's plot, to call out a new best. */
  myBest: number;
  onDeselect: () => void;
  onConfirmPlacement: () => void;
  onSkipPlacement: () => void;
  onPlay: () => void;
}

const toneOf = (tone: BoardHint['tone']): Tone => (tone === 'info' ? 'default' : tone);

/**
 * DOM chrome for the board, layered above the shared Canvas.
 *
 * Laid out for a phone held upright inside a Reddit post -- roughly 360 by 512 -- and allowed
 * to breathe on anything larger. Three bands: a readout and the scope tabs across the top,
 * camera buttons down the right edge, and the one action that matters at the bottom where a
 * thumb already is. Everything in between is the board, and nothing here intercepts a tap
 * meant for it.
 */
export const BoardChrome: React.FC<BoardChromeProps> = ({
  towers,
  allTowers,
  isLoading,
  pendingTower,
  region,
  isPlacing,
  error,
  target,
  hint,
  view,
  selected,
  myUserId,
  myBest,
  onDeselect,
  onConfirmPlacement,
  onSkipPlacement,
  onPlay,
}) => {
  const isPlacementMode = pendingTower !== null && region !== null;
  const occupied = React.useMemo(() => countByCell(towers), [towers]);
  const targetStack = target ? (occupied.get(`${target.x},${target.z}`) ?? 0) : 0;
  const canPlace = targetStack < MAX_STACK_PER_CELL;

  const stats = React.useMemo(() => {
    let blocks = 0;
    let tallest = 0;
    for (const t of towers) {
      const n = t.blockCount ?? t.towerBlocks?.length ?? 0;
      blocks += n;
      if (n > tallest) tallest = n;
    }
    return { blocks, tallest, builders: countBuilders(towers) };
  }, [towers]);

  const isNewBest = isPlacementMode && pendingTower !== null && pendingTower.score > myBest;

  const readout = isPlacementMode
    ? { label: 'Place your tower', value: `${pendingTower.score.toLocaleString()} pts` }
    : isLoading && towers.length === 0
      ? { label: 'The grid', value: 'Loading' }
      : view.scope === 'mine'
        ? {
            label: 'My plot',
            value:
              towers.length === 0
                ? 'Nothing built yet'
                : `${towers.length} ${towers.length === 1 ? 'tower' : 'towers'}`,
          }
        : {
            label: 'The city',
            value:
              towers.length === 0
                ? 'Nothing built yet'
                : `${towers.length.toLocaleString()} towers`,
          };

  // Placement guidance is a standing instruction; a hint is a reply to one tap and wins while
  // it is up.
  const guidance = !isPlacementMode
    ? null
    : !target
      ? 'Tap a cell on your plot'
      : !canPlace
        ? `Cell full (${MAX_STACK_PER_CELL} max)`
        : targetStack === 0
          ? 'Tap again to place it'
          : `Tap again to stack on ${targetStack}`;
  const line: BoardHint | null =
    hint ??
    (guidance ? { key: 0, text: guidance, tone: !canPlace && target ? 'alert' : 'info' } : null);

  return (
    <div className="board-chrome">
      <div className="board-top">
        <div className="board-readout">
          <Readout
            label={readout.label}
            value={readout.value}
            tone={isNewBest ? 'good' : 'default'}
          />

          {isPlacementMode && pendingTower && (
            <StatRow>
              <Stat
                icon={<BlocksIcon />}
                value={pendingTower.blockCount.toLocaleString()}
                title="Blocks"
              />
              {pendingTower.perfectStreak > 0 && (
                <Stat
                  icon={<SparkIcon />}
                  value={pendingTower.perfectStreak.toLocaleString()}
                  title="Perfect placements"
                  tone="good"
                />
              )}
              {isNewBest && <Stat value="New best" title="Your best tower yet" tone="best" />}
            </StatRow>
          )}

          {!isPlacementMode && !selected && towers.length > 0 && (
            <StatRow className="board-stats--quiet">
              {view.scope === 'community' ? (
                <Stat
                  icon={<UsersIcon />}
                  value={stats.builders.toLocaleString()}
                  title="Builders"
                />
              ) : (
                <Stat
                  icon={<BlocksIcon />}
                  value={stats.blocks.toLocaleString()}
                  title="Blocks stacked"
                />
              )}
              <Stat
                icon={<HeightIcon />}
                value={stats.tallest.toLocaleString()}
                title="Tallest tower, in blocks"
              />
            </StatRow>
          )}
        </div>

        {/* Placement hides the tabs: you are aiming at your own plot then, and switching to the
            city mid-aim would move the thing being aimed at. */}
        {!isPlacementMode && <ScopeToggle scope={view.scope} onChange={view.setScope} />}
      </div>

      {line && (
        <div key={line.key} className="board-hint">
          <Pill tone={toneOf(line.tone)}>{line.text}</Pill>
        </div>
      )}

      {/* Camera buttons: inline posts give us no gestures, so these are the only way to look
          around. Hidden while placing, where the camera is doing a specific job. */}
      {!isPlacementMode && (
        <GridViewControls
          canZoomIn={view.canZoomIn}
          canZoomOut={view.canZoomOut}
          onZoomIn={view.zoomIn}
          onZoomOut={view.zoomOut}
          onRotateLeft={view.rotateLeft}
          onRotateRight={view.rotateRight}
        />
      )}

      <div className="board-bottom">
        {error && (
          <Pill tone="alert" role="alert">
            {error}
          </Pill>
        )}

        {selected && !isPlacementMode && (
          <TowerCard
            tower={selected}
            mine={myUserId !== null && selected.userId === myUserId}
            rank={rankOf(selected, allTowers)}
            of={allTowers.length}
            onClose={onDeselect}
          />
        )}

        {isPlacementMode ? (
          <div className="board-actions">
            {/* Confirm is the primary action and it leads. */}
            <Button onClick={onConfirmPlacement} disabled={!target || !canPlace || isPlacing}>
              {isPlacing
                ? 'Placing…'
                : !target
                  ? 'Pick a cell'
                  : targetStack > 0
                    ? `Stack on ${targetStack}`
                    : 'Place here'}
            </Button>
            <Button variant="ghost" onClick={onSkipPlacement} disabled={isPlacing}>
              Place later
            </Button>
          </div>
        ) : (
          <div className="board-actions">
            <Button onClick={onPlay}>Build a tower</Button>
          </div>
        )}
      </div>
    </div>
  );
};
