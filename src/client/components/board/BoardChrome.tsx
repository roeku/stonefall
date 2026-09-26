import React from 'react';
import type { BragRecord, MapInfo, PlayerRegion, TowerMapEntry } from '../../../shared/types/api';
import { factionHex, factionName, type FactionId } from '../../../shared/types/factions';
import type { Holdings, PlacementVerdict } from '../../../shared/types/territory';
import { cellName } from '../../../shared/types/worldGrid';
import type { GridViewState } from '../../hooks/useGridView';
import type { Target } from '../../hooks/useSocial';
import { GridViewControls } from '../ui/GridViewControls';
import { ScopeToggle } from '../ui/ScopeToggle';
import { BuildButton, Button, IconButton, Pill, Readout, type Tone } from '../ui/Chrome';
import { SideLine, Standings, SwitchConfirm, Swatches } from '../ui/Factions';
import { SoundOffIcon, SoundOnIcon } from '../ui/icons';
import { BragChip, ChatterStrip, CommentConfirm } from '../ui/Social';
import { commentFor, type PlacedRun } from '../ui/placedRun';
import type { GridTarget } from './BoardScene';
import type { Brief } from './briefs';
import { shortDay } from '../../utils/days';
import { dayLine, type DayResult } from '../../utils/dayResult';
import { ordinal, standingOf } from '../../utils/stakes';

export interface BoardHint {
  key: number;
  text: string;
  tone: 'info' | 'alert' | 'good';
}

export interface Me {
  userId: string | null;
  /** The name a comment goes out under. */
  username: string | null;
  faction: FactionId;
  chosen: boolean;
  region: PlayerRegion | null;
}

interface BoardChromeProps {
  /** Towers in the current scope. */
  towers: TowerMapEntry[];
  /** Every tower on the board, for what the player has standing. */
  allTowers: TowerMapEntry[];
  holdings: Holdings;
  isLoading: boolean;
  pendingTower: TowerMapEntry | null;
  isPlacing: boolean;
  error: string | null;
  target: GridTarget | null;
  /** The target came from the player's tap, not the spot placement opened on. */
  aimedByTap: boolean;
  /** The rules' answer for the current target, when there is one. */
  verdict: PlacementVerdict | null;
  hint: BoardHint | null;
  view: GridViewState;
  /** What the tapped tower or cell is and the run it offers. Its tag is drawn in the scene. */
  brief: Brief | null;
  /** Recent runs other people announced in the thread. */
  brags: ReadonlyArray<BragRecord>;
  /** The run waiting to be announced: set after a raise worth telling people about. */
  placedRun: PlacedRun | null;
  isPosting: boolean;
  me: Me;
  /** Best score the player already has standing, to call out a new best. */
  myBest: number;
  muted: boolean;
  /** The newcomer's colour card has been answered or waved past; it does not come back. */
  colourAsked: boolean;
  onColourAsked: () => void;
  onToggleMute: () => void;
  onSetFaction: (faction: FactionId) => void;
  /** Start a run aimed at something: a score, a hold, or empty land. */
  onAim: (target: Target) => void;
  /** Post the confirmed comment. Given the trusted click that confirmed it. */
  onBrag: (event: Event) => void;
  /** Open the comment to edit it first, then post what the player wrote. Given the click. */
  onEditBrag: (event: Event) => void;
  /** Put the tapped tower or cell down. */
  onBack: () => void;
  onConfirmPlacement: () => void;
  /** Drop the tower in hand. There is no shelf: a tower not raised now is gone. */
  onDiscard: () => void;
  /** Raise the tower where it is aimed and go straight into another run. */
  onAgain: () => void;
  /**
   * The tower in hand can go down nowhere: not where it is aimed, not on the keep, not on any
   * land in reach. Only then is Discard offered, so nobody is left holding a tower.
   */
  stuck: boolean;
  /** Bumped when the viewer's colour gains ground, so its place and count pop. */
  standingsPulse: number;
  /** The colour just climbed: the place it climbed from, for a moment. */
  climb: { from: number; key: number } | null;
  /** What the next run will chase, when there is something: said under Build. */
  nextChase: Target | null;
  onPlay: () => void;
  /** Today's relay post, when there is one to go to. */
  onRelay: (() => void) | null;
  /** Which day's map this is. Null until the board has loaded. */
  map: MapInfo | null;
  /** How an older post's day ended, while that day is on screen. */
  day: DayResult | null;
  /** Build was pressed and the player's plot for today is being found. */
  entering: boolean;
  /** A run played signed out and kept for after signing in: its score. */
  keptRun: number | null;
  /** Reddit's sign-in sheet, to raise the kept run. */
  onSignIn: () => void;
}

const toneOf = (tone: BoardHint['tone']): Tone => (tone === 'info' ? 'default' : tone);

/** What Build is for this time, in one line: the bar the run will chase. */
const buildSubFor = (chase: Target | null): string | null => {
  if (!chase || chase.score <= 0) return null;
  const score = chase.score.toLocaleString();
  if (chase.own) return `Beat your best, ${score}`;
  if (chase.kind === 'take' && chase.cell) {
    return `Beat ${score} to take ${cellName(chase.cell.x, chase.cell.z)}`;
  }
  return `Beat ${score}`;
};

/**
 * DOM chrome for the board, layered above the shared Canvas.
 *
 * Laid out for a phone held upright inside a Reddit post, roughly 360 by 512, and allowed to
 * breathe on anything larger. Three things at most: who you are and where your colour stands at
 * the top, one action at the bottom where a thumb already is, and one line that comes and goes.
 * The second thing to do sits in the bottom corner as a word. Everything about a place on the
 * board is written on the board, in the scene: the cell being aimed at, the keep, the tower the
 * next run will chase, the tower or cell that was tapped.
 *
 * One primary at a time: while a tower or cell is tapped its run is the primary and Build steps
 * aside, with Back in the corner. The primary is always a verb, with what it will do underneath
 * it; what stops the verb is said in the line near the top.
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
  aimedByTap,
  verdict,
  hint,
  view,
  brief,
  brags,
  placedRun,
  isPosting,
  me,
  myBest,
  muted,
  colourAsked,
  onColourAsked,
  onToggleMute,
  onSetFaction,
  onAim,
  onBrag,
  onEditBrag,
  onBack,
  onConfirmPlacement,
  onDiscard,
  onAgain,
  stuck,
  standingsPulse,
  climb,
  nextChase,
  onPlay,
  onRelay,
  map,
  day,
  entering,
  keptRun,
  onSignIn,
}) => {
  const isPlacementMode = pendingTower !== null;
  /**
   * False while an older post shows its own day as it ended: looked at, not built on. Its Build
   * plays today's map, here.
   */
  const live = map?.live !== false;
  const canPlace = verdict?.ok === true;
  /** The tapped tower or cell, while nothing is in hand. */
  const card = isPlacementMode ? null : brief;
  const cardUp = card !== null;
  const bragUp = placedRun !== null && !isPlacementMode && !cardUp;
  /**
   * The comment's confirmation is open. It is the one thing on the foot while it is: nothing is
   * posted from the offer itself, and Build waits until the player has said yes or no.
   */
  const [commenting, setCommenting] = React.useState(false);
  React.useEffect(() => setCommenting(false), [placedRun]);
  const commentUp = bragUp && commenting;
  /** A signed-out run is kept: the offer to sign in and raise it sits above Build. */
  const keptUp = keptRun !== null && !isPlacementMode && !cardUp && !bragUp;

  /**
   * The swatch row: a one-time card on a first visit, and open whenever the side is tapped.
   *
   * It used to be pinned until a colour was chosen, and while pinned it hid the chatter strip,
   * so a newcomer who ignored it never saw the thread. Now a choice or a Build dismisses it and
   * the hashed default stands.
   */
  const [swatchesOpen, setSwatchesOpen] = React.useState(false);
  const showSwatches =
    live &&
    !!me.userId &&
    !isPlacementMode &&
    !cardUp &&
    !bragUp &&
    (swatchesOpen || (!me.chosen && !colourAsked));

  /**
   * A colour picked while towers are standing waits for a yes: a switch takes every one of them
   * down, and a tap on a square should never cost that by accident.
   */
  const [switchTo, setSwitchTo] = React.useState<FactionId | null>(null);
  const mineStanding = React.useMemo(
    () => (me.userId ? allTowers.filter((t) => t.userId === me.userId).length : 0),
    [allTowers, me.userId]
  );
  const confirming = switchTo !== null && live && !isPlacementMode;

  const place = React.useMemo(() => standingOf(holdings, me.faction).place, [holdings, me.faction]);

  const isNewBest = isPlacementMode && pendingTower !== null && pendingTower.score > myBest;

  const ownHold =
    verdict !== null &&
    ((verdict.ok && verdict.kind === 'take' && verdict.from.userId === me.userId) ||
      (!verdict.ok && verdict.from !== undefined && verdict.from.userId === me.userId));

  // Placement guidance is a standing instruction; a hint is a reply to one tap and wins while
  // it is up. The spot placement opens on is the game's suggestion, so the line invites a tap
  // somewhere else; only a cell the player tapped themselves is "tap again".
  const guidance = !isPlacementMode
    ? null
    : !target || !verdict
      ? 'Tap a cell to aim it'
      : !verdict.ok
        ? verdict.reason
        : !aimedByTap
          ? 'Tap a cell to move it'
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

  // The button is a verb, and under it what the verb does for the colour: only land counts
  // toward the day's ground, and a player who cannot see that has no reason to leave the keep.
  // Why the verb is not available yet is the line's job.
  const colour = factionName(me.faction);
  const where = target ? cellName(target.x, target.z) : '';
  const action = ((): { verb: string; sub: string | null } => {
    if (!target || !verdict) return { verb: 'Raise', sub: null };
    if (verdict.ok) {
      if (verdict.kind === 'keep') {
        return {
          verb: verdict.stackOn > 0 ? `Stack on ${verdict.stackOn}` : 'Raise here',
          sub: 'Safe on your keep',
        };
      }
      if (verdict.kind === 'claim') return { verb: `Claim ${where}`, sub: `+1 cell for ${colour}` };
      if (ownHold) return { verb: 'Replace it', sub: 'Your own land' };
      return {
        verb: `Take ${where}`,
        sub: `+1 for ${colour}, from u/${verdict.from.username}`,
      };
    }
    if (verdict.code === 'bar') {
      return {
        verb: ownHold ? 'Replace it' : `Take ${where}`,
        sub: `Needs ${((verdict.bar ?? 0) + 1).toLocaleString()}`,
      };
    }
    return { verb: 'Raise', sub: null };
  })();
  const confirmLabel = isPlacing ? 'Raising' : action.verb;

  // A tapped tower's or cell's own run is the primary while it is up, so Build steps aside;
  // Back, or a tap away from it, brings Build back.
  const play = () => {
    onColourAsked();
    setSwatchesOpen(false);
    onPlay();
  };

  return (
    <div className="board-chrome">
      <div className="board-top">
        <div className={`board-status${live ? '' : ' board-status--day'}`}>
          {isPlacementMode && pendingTower ? (
            <Readout
              under
              size="large"
              label={isNewBest ? 'New best' : ''}
              value={pendingTower.score.toLocaleString()}
              tone={isNewBest ? 'best' : 'default'}
            />
          ) : (
            <>
              {me.userId && live && (
                <SideLine
                  faction={me.faction}
                  place={place}
                  open={showSwatches}
                  pulse={standingsPulse}
                  onToggle={() => {
                    onColourAsked();
                    setSwatchesOpen((o) => !o);
                  }}
                />
              )}
              {me.userId && live && climb && climb.from > 0 && (
                <span key={climb.key} className="ui-side__sub">
                  Up from {ordinal(climb.from)}
                </span>
              )}
              {!live && map && <span className="ui-label">Final · {shortDay(map.day)}</span>}
              {view.scope === 'all' && !cardUp && (
                <Standings holdings={holdings} mine={me.faction} pulse={standingsPulse} />
              )}
              {!live && day && !cardUp && <span className="board-day">{dayLine(day)}</span>}
            </>
          )}
        </div>

        <div className="board-top__side">
          {/* Placement hides the toggle: you are aiming then, and switching scope mid-aim would
              move the thing being aimed at. */}
          {!isPlacementMode && live && <ScopeToggle scope={view.scope} onChange={view.setScope} />}
          <IconButton label={muted ? 'Sound on' : 'Sound off'} onClick={onToggleMute}>
            {muted ? <SoundOffIcon /> : <SoundOnIcon />}
          </IconButton>
        </div>
      </div>

      {line && (
        <div key={line.key} className="board-hint">
          <Pill tone={toneOf(line.tone)}>{line.text}</Pill>
        </div>
      )}

      {/* Zoom: inline posts give us no gestures, so these are the only way to look closer.
          Hidden while placing, where the camera is doing a specific job, and whenever something
          at the foot needs the room. */}
      {!isPlacementMode && !cardUp && !showSwatches && !confirming && !commentUp && (
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

        {card &&
          (card.action ? (
            <Button onClick={() => card.action && onAim(card.action.aim)} sub={card.action.sub}>
              {card.action.verb}
            </Button>
          ) : (
            card.blocked && <Pill>{card.blocked}</Pill>
          ))}

        {/* The ask comes after the tower is standing, never during a run, and only for a
            run worth telling people about. It sits above Build, not over it: the next run is
            never behind a question. */}
        {bragUp &&
          placedRun &&
          !confirming &&
          (commentUp ? (
            <CommentConfirm
              comment={commentFor(placedRun)}
              username={me.username}
              isPosting={isPosting}
              onConfirm={(event) => {
                onBrag(event);
              }}
              onEdit={onEditBrag}
              onCancel={() => setCommenting(false)}
            />
          ) : (
            <BragChip run={placedRun} onOpen={() => setCommenting(true)} />
          ))}

        {keptUp && !confirming && (
          <div className="brag" role="group" aria-label="Keep this run">
            <Button variant="link" onClick={onSignIn}>
              Sign in to raise your {keptRun.toLocaleString()}
            </Button>
          </div>
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
          !keptUp &&
          !showSwatches &&
          !confirming &&
          brags.length > 0 && <ChatterStrip brags={brags} onChallenge={onAim} />}

        {isPlacementMode ? (
          <Button
            onClick={onConfirmPlacement}
            disabled={!canPlace || isPlacing}
            sub={isPlacing ? null : action.sub}
          >
            {confirmLabel}
          </Button>
        ) : !live ? (
          // Nothing on this day can be started, so a tapped tower does not take Build's place:
          // it is the one way to play from here, and it plays today's map.
          <BuildButton
            label={entering ? 'Finding plot' : 'Build'}
            sub={keptUp ? null : "Today's map"}
            color={factionHex(me.faction)}
            disabled={entering}
            onClick={play}
          />
        ) : (
          !cardUp &&
          !confirming &&
          !commentUp && (
            <BuildButton
              label={entering ? 'Finding plot' : 'Build'}
              sub={bragUp || keptUp || showSwatches ? null : buildSubFor(nextChase)}
              color={factionHex(me.faction)}
              disabled={entering}
              onClick={play}
            />
          )
        )}
      </div>

      {/* The second thing to do, as a word in the corner: raise and go again while placing,
          put a tapped thing down, or the relay. */}
      {isPlacementMode ? (
        <Button variant="ghost" className="board-aside" onClick={onAgain} disabled={isPlacing}>
          Again
        </Button>
      ) : cardUp ? (
        <Button variant="ghost" className="board-aside" onClick={onBack}>
          Back
        </Button>
      ) : (
        onRelay &&
        !confirming &&
        !commentUp && (
          <Button variant="ghost" className="board-aside" onClick={onRelay}>
            Relay
          </Button>
        )
      )}
      {isPlacementMode && stuck && (
        <Button
          variant="ghost"
          className="board-aside board-aside--left"
          onClick={onDiscard}
          disabled={isPlacing}
        >
          Discard
        </Button>
      )}
    </div>
  );
};
