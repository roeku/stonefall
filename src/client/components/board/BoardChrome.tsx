import React from 'react';
import type {
  BragKind,
  BragRecord,
  MapInfo,
  PlayerRegion,
  TowerMapEntry,
} from '../../../shared/types/api';
import type { FactionId } from '../../../shared/types/factions';
import { cellKind, type Holdings, type PlacementVerdict } from '../../../shared/types/territory';
import type { GridViewState } from '../../hooks/useGridView';
import type { Target } from '../../hooks/useSocial';
import { GridViewControls } from '../ui/GridViewControls';
import { ScopeToggle } from '../ui/ScopeToggle';
import { Button, IconButton, Pill, Readout, type Tone } from '../ui/Chrome';
import { FactionChip, Standings, SwitchConfirm, Swatches } from '../ui/Factions';
import { SoundOffIcon, SoundOnIcon } from '../ui/icons';
import { TowerCard } from './TowerCard';
import { CellCard } from './CellCard';
import { shortReason } from './verdictWords';
import { BragBar, ChatterStrip, type PlacedRun } from '../ui/Social';
import type { GridTarget } from './BoardScene';

export interface BoardHint {
  key: number;
  text: string;
  tone: 'info' | 'alert' | 'good';
}

export interface Me {
  userId: string | null;
  faction: FactionId;
  chosen: boolean;
  region: PlayerRegion | null;
}

interface BoardChromeProps {
  /** Towers in the current scope. */
  towers: TowerMapEntry[];
  /** Every tower on the board, for ranks and stats. */
  allTowers: TowerMapEntry[];
  holdings: Holdings;
  isLoading: boolean;
  pendingTower: TowerMapEntry | null;
  isPlacing: boolean;
  error: string | null;
  target: GridTarget | null;
  /** The rules' answer for the current target, when there is one. */
  verdict: PlacementVerdict | null;
  hint: BoardHint | null;
  view: GridViewState;
  selected: TowerMapEntry | null;
  selectedCell: GridTarget | null;
  /** Recent runs other people announced in the thread. */
  brags: ReadonlyArray<BragRecord>;
  /** The run waiting to be announced, set for one beat after a tower is raised. */
  placedRun: PlacedRun | null;
  isPosting: boolean;
  me: Me;
  /** Best score the player already has standing, to call out a new best. */
  myBest: number;
  muted: boolean;
  /** The newcomer's colour card has been answered or waved past; it does not come back. */
  colourAsked: boolean;
  onColourAsked: () => void;
  judge: (x: number, z: number, score: number) => PlacementVerdict;
  onToggleMute: () => void;
  onSetFaction: (faction: FactionId) => void;
  /** Start a run aimed at something: a score, a hold, or empty land. */
  onAim: (target: Target) => void;
  onBrag: (kind: BragKind) => void;
  onDismissBrag: () => void;
  onDeselect: () => void;
  onDeselectCell: () => void;
  onConfirmPlacement: () => void;
  /** Drop the tower in hand. There is no shelf: a tower not raised now is gone. */
  onDiscard: () => void;
  /** Drop the tower in hand and go straight into another run. */
  onAgain: () => void;
  onPlay: () => void;
  /** Today's relay post, when there is one to go to. */
  onRelay: (() => void) | null;
  /** Which day's map this is. Null until the board has loaded. */
  map: MapInfo | null;
  /** Today's map post, for a closed map to send people on to. */
  onToday: (() => void) | null;
  /** Build was pressed and the player's plot for today is being found. */
  entering: boolean;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Tuesday": whose map this was, for a sentence. */
const longWeekday = (day: string): string => {
  const d = new Date(`${day}T12:00:00Z`);
  return Number.isNaN(d.getTime())
    ? 'That day'
    : d.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
};

/** "Tue 22 Sep": a map's day, short enough for a kicker. */
const shortDay = (day: string): string => {
  const d = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return day;
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
};

const toneOf = (tone: BoardHint['tone']): Tone => (tone === 'info' ? 'default' : tone);

/**
 * DOM chrome for the board, layered above the shared Canvas.
 *
 * Laid out for a phone held upright inside a Reddit post -- roughly 360 by 512 -- and allowed
 * to breathe on anything larger. Three bands: a readout and the scope tabs across the top,
 * camera buttons down the right edge, and the one action that matters at the bottom where a
 * thumb already is. Everything in between is the board, and nothing here intercepts a tap
 * meant for it.
 *
 * Two rules keep it legible on a phone. One primary at a time: while the brag bar is up the
 * Build button is not, while a card is up the camera column is not. And the primary button is
 * always a verb; what stops the verb (no cell picked, a bar not beaten) is said in the pill.
 */
export const BoardChrome: React.FC<BoardChromeProps> = ({
  towers,
  allTowers,
  holdings,
  isLoading,
  pendingTower,
  isPlacing,
  error,
  target,
  verdict,
  hint,
  view,
  selected,
  selectedCell,
  brags,
  placedRun,
  isPosting,
  me,
  myBest,
  muted,
  colourAsked,
  onColourAsked,
  judge,
  onToggleMute,
  onSetFaction,
  onAim,
  onBrag,
  onDismissBrag,
  onDeselect,
  onDeselectCell,
  onConfirmPlacement,
  onDiscard,
  onAgain,
  onPlay,
  onRelay,
  map,
  onToday,
  entering,
}) => {
  const isPlacementMode = pendingTower !== null;
  /** A closed day's map is looked at, not built on. */
  const live = map?.live !== false;
  const canPlace = verdict?.ok === true;
  const cardUp = selected !== null || selectedCell !== null;
  const bragUp = placedRun !== null && !isPlacementMode && !cardUp;

  /**
   * The swatch row: a one-time card on a first visit, and open whenever the chip is tapped.
   *
   * It used to be pinned until a colour was chosen, and while pinned it hid the chatter strip,
   * so a newcomer who ignored it never saw the thread. Now a choice or a Build dismisses it and
   * the hashed default stands.
   */
  const [swatchesOpen, setSwatchesOpen] = React.useState(false);
  const showSwatches =
    live &&
    !isPlacementMode &&
    !cardUp &&
    !bragUp &&
    (swatchesOpen || (!me.chosen && !colourAsked));

  /**
   * A colour picked while towers are standing waits for a yes: a switch takes every one of them
   * down, and a tap on a dot should never cost that by accident.
   */
  const [switchTo, setSwitchTo] = React.useState<FactionId | null>(null);
  const mineStanding = React.useMemo(
    () => (me.userId ? allTowers.filter((t) => t.userId === me.userId).length : 0),
    [allTowers, me.userId]
  );
  const confirming = switchTo !== null && live && !isPlacementMode;

  const isNewBest = isPlacementMode && pendingTower !== null && pendingTower.score > myBest;

  const ownHold =
    verdict !== null &&
    ((verdict.ok && verdict.kind === 'take' && verdict.from.userId === me.userId) ||
      (!verdict.ok && verdict.from !== undefined && verdict.from.userId === me.userId));

  // Placement guidance is a standing instruction; a hint is a reply to one tap and wins while
  // it is up. Everything here is on the one verb, raise.
  const guidance = !isPlacementMode
    ? null
    : !target || !verdict
      ? 'Pick a cell'
      : !verdict.ok
        ? verdict.reason
        : verdict.kind === 'keep'
          ? verdict.stackOn === 0
            ? 'Tap again to raise it'
            : `Tap again to stack on ${verdict.stackOn}`
          : verdict.kind === 'claim'
            ? 'Tap again to claim it'
            : ownHold
              ? 'Tap again to replace it'
              : `Tap again to take it from u/${verdict.from.username}`;
  // Browsing has one standing line of its own: what an empty or loading board is.
  const empty = !isPlacementMode
    ? isLoading && towers.length === 0
      ? 'Loading'
      : !isLoading && allTowers.length === 0 && live
        ? 'Nothing raised yet today'
        : null
    : null;
  const standing = guidance ?? empty;
  const line: BoardHint | null =
    hint ??
    (standing
      ? { key: 0, text: standing, tone: verdict && !verdict.ok && target ? 'alert' : 'info' }
      : null);

  // The button is a verb. Why the verb is not available yet is the pill's job.
  const verb = (() => {
    if (!target || !verdict) return 'Raise';
    if (verdict.ok) {
      if (verdict.kind === 'keep')
        return verdict.stackOn > 0 ? `Stack on ${verdict.stackOn}` : 'Raise here';
      if (verdict.kind === 'claim') return 'Claim it';
      return ownHold ? 'Replace it' : 'Take it';
    }
    if (verdict.code === 'bar') return ownHold ? 'Replace it' : 'Take it';
    return 'Raise';
  })();
  const confirmLabel = isPlacing ? 'Raising' : verb;

  const selectedTowerCell =
    selected && selected.gridX !== undefined && selected.gridZ !== undefined
      ? { x: selected.gridX, z: selected.gridZ }
      : null;
  const selectedMine = selected !== null && me.userId !== null && selected.userId === me.userId;
  const selectedProbe =
    selected && selectedTowerCell && cellKind(selectedTowerCell.x, selectedTowerCell.z) === 'land'
      ? judge(selectedTowerCell.x, selectedTowerCell.z, selected.score + 1)
      : null;

  const cellTower = React.useMemo(
    () =>
      selectedCell
        ? (allTowers.find((t) => t.gridX === selectedCell.x && t.gridZ === selectedCell.z) ?? null)
        : null,
    [allTowers, selectedCell]
  );

  // The card's own button is the primary while a card is up, so Build steps aside; tapping
  // away from the card brings it back.
  const play = () => {
    onColourAsked();
    setSwatchesOpen(false);
    onPlay();
  };

  return (
    <div className="board-chrome">
      <div className="board-top">
        <div className="board-status">
          {isPlacementMode && pendingTower ? (
            <Readout
              label={isNewBest ? 'New best' : 'Your tower'}
              value={pendingTower.score.toLocaleString()}
              tone={isNewBest ? 'good' : 'default'}
            />
          ) : (
            <>
              {me.userId && live && (
                <FactionChip
                  faction={me.faction}
                  open={showSwatches}
                  onToggle={() => {
                    onColourAsked();
                    setSwatchesOpen((o) => !o);
                  }}
                />
              )}
              {!live && map && <span className="ui-label">{shortDay(map.day)}</span>}
              {view.scope === 'all' && !cardUp && (
                <Standings holdings={holdings} mine={me.faction} final={!live} />
              )}
            </>
          )}
        </div>

        <div className="board-top__side">
          {/* Placement hides the tabs: you are aiming then, and switching scope mid-aim would
              move the thing being aimed at. */}
          {!isPlacementMode && <ScopeToggle scope={view.scope} onChange={view.setScope} />}
          <IconButton
            label={muted ? 'Sound on' : 'Sound off'}
            onClick={onToggleMute}
            className="ui-iconbtn--quiet"
          >
            {muted ? <SoundOffIcon /> : <SoundOnIcon />}
          </IconButton>
        </div>
      </div>

      {line && (
        <div key={line.key} className="board-hint">
          <Pill tone={toneOf(line.tone)}>{line.text}</Pill>
        </div>
      )}

      {/* Camera buttons: inline posts give us no gestures, so these are the only way to look
          around. Hidden while placing, where the camera is doing a specific job, and whenever
          a card, the swatches or the brag bar need the right edge. */}
      {!isPlacementMode && !cardUp && !bragUp && !showSwatches && !confirming && (
        <GridViewControls
          canZoomIn={view.canZoomIn}
          canZoomOut={view.canZoomOut}
          onZoomIn={view.zoomIn}
          onZoomOut={view.zoomOut}
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
            mine={selectedMine}
            onClose={onDeselect}
            onBeat={
              selectedMine || !live
                ? undefined
                : () => onAim({ kind: 'beat', username: selected.username, score: selected.score })
            }
            onTake={
              live && selectedProbe?.ok && selectedTowerCell
                ? () =>
                    onAim({
                      kind: 'take',
                      username: selected.username,
                      score: selected.score,
                      cell: selectedTowerCell,
                      own: selectedMine,
                    })
                : undefined
            }
            blocked={!live || !selectedProbe ? null : shortReason(selectedProbe)}
          />
        )}

        {selectedCell && !selected && !isPlacementMode && (
          <CellCard
            cell={selectedCell}
            holdings={holdings}
            tower={cellTower}
            myUserId={me.userId}
            myFaction={me.faction}
            myRegion={me.region ? { rx: me.region.rx, rz: me.region.rz } : null}
            judge={judge}
            onClose={onDeselectCell}
            onClaim={() => onAim({ kind: 'claim', score: 0, cell: selectedCell })}
            onTake={(username, score, own) =>
              onAim({ kind: 'take', username, score, cell: selectedCell, own })
            }
            frozen={!live}
          />
        )}

        {/* The ask comes after the tower is standing, never during a run, and only once. */}
        {bragUp && placedRun && (
          <BragBar
            run={placedRun}
            isPosting={isPosting}
            onBrag={onBrag}
            onDismiss={onDismissBrag}
          />
        )}

        {confirming && switchTo ? (
          <SwitchConfirm
            from={me.faction}
            to={switchTo}
            standing={mineStanding}
            onConfirm={() => {
              onSetFaction(switchTo);
              setSwitchTo(null);
              setSwatchesOpen(false);
              onColourAsked();
            }}
            onCancel={() => setSwitchTo(null)}
          />
        ) : (
          showSwatches && (
            <Swatches
              value={me.faction}
              onChange={(f) => {
                if (f !== me.faction && mineStanding > 0) {
                  setSwitchTo(f);
                  return;
                }
                onSetFaction(f);
                setSwatchesOpen(false);
                onColourAsked();
              }}
              title={me.chosen ? undefined : 'Your colour'}
            />
          )
        )}

        {/* Who else has been playing. Suppressed whenever something more urgent is on screen. */}
        {live &&
          !isPlacementMode &&
          !cardUp &&
          !bragUp &&
          !showSwatches &&
          !confirming &&
          brags.length > 0 && <ChatterStrip brags={brags} onChallenge={onAim} />}

        {!live && !cardUp && map && <Pill>{`${longWeekday(map.day)}'s map is closed.`}</Pill>}

        {isPlacementMode ? (
          <div className="board-actions">
            {/* Confirm is the primary action and it leads. */}
            <Button onClick={onConfirmPlacement} disabled={!canPlace || isPlacing}>
              {confirmLabel}
            </Button>
            <div className="board-actions__row">
              <Button variant="ghost" onClick={onAgain} disabled={isPlacing}>
                Again
              </Button>
              <Button variant="ghost" onClick={onDiscard} disabled={isPlacing}>
                Discard
              </Button>
            </div>
          </div>
        ) : !live ? (
          !cardUp && (
            <div className="board-actions board-actions--row">
              {onToday && <Button onClick={onToday}>Today's map</Button>}
              {onRelay && (
                <Button variant="ghost" onClick={onRelay}>
                  Relay
                </Button>
              )}
            </div>
          )
        ) : (
          !bragUp &&
          !cardUp &&
          !confirming && (
            // The one verb and the one elsewhere, side by side: a second row for a link cost the
            // board a band of its height.
            <div className="board-actions board-actions--row">
              <Button onClick={play} disabled={entering}>
                {entering ? 'Finding plot' : 'Build'}
              </Button>
              {onRelay && (
                <Button variant="ghost" onClick={onRelay}>
                  Relay
                </Button>
              )}
            </div>
          )
        )}
      </div>
    </div>
  );
};
