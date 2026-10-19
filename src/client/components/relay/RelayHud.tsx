import React from 'react';
import type { RelayState } from '../../../shared/types/api';
import {
  RELAY,
  bestRank,
  laidCount,
  livesLeft,
  livesToday,
  moreLives,
  raceOf,
  raceStanding,
  shownTurnMs,
  type RaceEntry,
} from '../../../shared/relay/rules';
import { factionHex, factionName, type FactionId } from '../../../shared/types/factions';
import { FactionSquare } from '../ui/Factions';
import { ordinal } from '../../utils/stakes';
import { Button, IconButton, NotifyBell, Pill, Readout } from '../ui/Chrome';
import { CommentOffer } from '../ui/Social';
import { NextIcon, PrevIcon, SoundOffIcon, SoundOnIcon } from '../ui/icons';
import { shortDay } from '../../../shared/types/days';
import { LobbyStrip, type LeavingSeat } from './LobbyStrip';
import { offWord } from '../../../shared/simulation/missReadout';
import type { Burst, LastLanding } from '../../hooks/useRelayTurn';
import type { TowerView } from './overviewSquash';
import { streakName, streakTierIndex } from '../../constants/streakTiers';
import { AudioPlayer } from '../audio/AudioPlayer';

/** How long "Passed Gold" holds the middle of the frame, ms. */
const PASS_MS = 2000;

/** How long a turn's tally stays up after its time runs out, ms: the beat before the next. */
const TALLY_MS = 2400;

interface RelayHudProps {
  state: RelayState;
  myUserId: string | null;
  /** The server's clock, for the turn timer. */
  serverNow: () => number;
  /** The player's own turn as it goes, or as it ended: blocks laid, perfects in a row. */
  burst: Burst | null;
  /** Blocks standing as this page has them, its own landings included before the server's word. */
  height: number;
  /** This page's last landing, a new object per drop: a miss says how far off it was. */
  lastLanding: LastLanding | null;
  muted: boolean;
  isPosting: boolean;
  onToggleMute: () => void;
  /** Push notifications: on, off, or null when there are none to have (no bell). */
  notify: boolean | null;
  onToggleNotify: () => void;
  /** Post the game's line, with the player's own words above it if they wrote any. Given the
   * trusted tap or submit that asked for it. */
  onBrag: (event: Event, note?: string) => void;
  /**
   * How the last thing done as the player went, a comment or a subscription, said where the offer
   * was: it is news to someone out.
   */
  asUserResult: { text: string; ok: boolean } | null;
  showBrag: boolean;
  /** The name a comment goes out under. */
  myUsername: string | null;
  onMap: (() => void) | null;
  /**
   * Subscribe to the subreddit, for RELAY.MEMBER_LIVES more lives a day. Given the trusted tap,
   * which Reddit asks for before the app acts as the player. Null when it is not on offer.
   */
  onSubscribe: ((event: Event) => void) | null;
  subscribing: boolean;
  /** The subreddit a subscription is to, by name. */
  subreddit: string;
  /** Take a seat. Null while one is held, or when there is nothing to join. */
  onJoin: (() => void) | null;
  /** What joining will do: join this tower, another with room, or start one. */
  joinLabel: string;
  joining: boolean;
  /**
   * An older post, showing its own day's towers as they topped out. Its seat is on today's relay,
   * which is what the primary says.
   */
  past: boolean;
  /** Look at another tower. Only while watching, and only when there is more than one. */
  onWatch: ((tower: number) => void) | null;
  /** Somebody who just fell, dropping out of their seat. */
  leaving: LeavingSeat | null;
  /** One line answering the last thing the player did, e.g. where they were seated. */
  notice: string | null;
  /** Something bigger has the middle of the frame, e.g. a fall; the ticker keeps quiet. */
  hushed: boolean;
  /**
   * What the waiting view shows of a tall tower, and the switch to the other: null while there is
   * no choice (the player's own turn, or a tower no taller than the top view).
   */
  towerView: TowerView | null;
  onTowerView: (view: TowerView) => void;
  /** XP the player's turn has earned so far (shared/social/progress.ts), for its tally. */
  turnXp?: number | undefined;
}

/**
 * The race between the colours' towers, with the tower on screen at the height this page has it
 * (its own landings count before the server's word).
 */
const raceWith = (state: RelayState, height: number): RaceEntry[] =>
  raceOf(
    state.towers.map((t) =>
      t.id === state.tower
        ? {
            ...t,
            height: Math.max(t.height, height),
            builders: Math.max(t.builders, height > 1 ? 1 : 0),
          }
        : t
    )
  );

/**
 * One line under a colour's height: how far behind the colour above it, or how far ahead of the
 * one below when it leads, the other colour named in its own colour.
 */
const RaceLine: React.FC<{ standing: ReturnType<typeof raceStanding> }> = ({ standing }) => {
  const other = standing.place === 1 ? standing.below : standing.above;
  if (!other) return null;
  const name = (
    <span style={{ color: factionHex(other.faction) }}>{factionName(other.faction)}</span>
  );
  return (
    <span className="relay-race" key={`${other.faction}-${standing.gap}`}>
      {standing.place === 1 ? (
        <>
          {standing.gap.toLocaleString()} ahead of {name}
        </>
      ) : standing.place === 0 ? (
        <>Not started</>
      ) : standing.gap === 0 ? (
        <>Level with {name}</>
      ) : (
        <>
          {standing.gap.toLocaleString()} behind {name}
        </>
      )}
    </span>
  );
};

/**
 * The relay's chrome: which tower and how tall, whose turn, who is in the crew. The same rules as
 * the map's: type on the scene and nothing behind it, one action at the foot, the crew framed in
 * their own colours down the right edge.
 *
 * Whose turn it is lives on the crew strip -- the lit seat, its fuse burning down -- rather than
 * in words across the middle of the frame, which is where the tower is. The middle only speaks
 * when it is about you: your turn, you are out, or there is nobody here to build.
 *
 * Pointer events are off everywhere but the buttons, because on your turn the whole screen is
 * the drop button and nothing here may eat that tap. Someone who has not taken a seat gets one
 * primary, the seat, and a pager to look along the other towers first.
 */
export const RelayHud: React.FC<RelayHudProps> = ({
  state,
  myUserId,
  serverNow,
  burst,
  height,
  lastLanding,
  muted,
  isPosting,
  onToggleMute,
  notify,
  onToggleNotify,
  onBrag,
  asUserResult,
  showBrag,
  myUsername,
  onMap,
  onSubscribe,
  subscribing,
  subreddit,
  onJoin,
  joinLabel,
  joining,
  past,
  onWatch,
  leaving,
  notice,
  hushed,
  towerView,
  onTowerView,
  turnXp = 0,
}) => {
  // Ten times a second is plenty for a clock that shows whole seconds; the fuse's motion is
  // smoothed by a CSS transition rather than by re-rendering the strip every frame.
  const [now, setNow] = React.useState(() => serverNow());
  React.useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), 100);
    return () => clearInterval(t);
  }, [serverNow]);

  const turn = state.turn;
  const me = state.me;
  const mine = turn !== null && turn.userId === myUserId;
  // Blocks of the tower on screen that are the player's: the server's count, and this turn's
  // landings on top until the server has them.
  const counted = laidCount(me?.runs?.[String(state.tower)]);
  const yours =
    mine && burst && !burst.ended
      ? Math.max(counted, counted - (turn?.laid ?? 0) + burst.laid)
      : counted;

  // A turn that ran its time says what it came to, for a beat, whoever's turn is next.
  const [tally, setTally] = React.useState<Burst | null>(null);
  React.useEffect(() => {
    if (burst?.ended !== 'time') return;
    setTally(burst);
    const t = setTimeout(() => setTally((b) => (b === burst ? null : b)), TALLY_MS);
    return () => clearTimeout(t);
  }, [burst]);

  // Perfects in a row this turn, named as the solo run names them, just above the tower.
  const [streakWord, setStreakWord] = React.useState<{ key: number; streak: number } | null>(null);
  React.useEffect(() => {
    if (!mine) return;
    const onPerfect = (e: Event) => {
      const streak = (e as CustomEvent<{ streak: number }>).detail?.streak ?? 1;
      setStreakWord((w) => ({ key: (w?.key ?? 0) + 1, streak }));
    };
    window.addEventListener('perfect-streak-advance', onPerfect);
    return () => window.removeEventListener('perfect-streak-advance', onPerfect);
  }, [mine]);
  /**
   * Where the turn just ended ranks among the tower's best, when it is the player's best here and
   * one of the few marked on it; 0 otherwise.
   */
  const madeTheList = (b: Burst): number => {
    if (!myUserId) return 0;
    const rank = bestRank(state.best, myUserId);
    const mineBest = rank > 0 ? state.best?.[rank - 1] : undefined;
    return mineBest && mineBest.laid === b.laid && rank <= RELAY.MARKED ? rank : 0;
  };
  const elapsed = turn ? Math.max(0, now - turn.startedAt) : 0;
  // A turn's own length: shorter when a colour's whole crew is waiting on it.
  const shown = turn ? shownTurnMs(turn) : 1;
  const progress = turn ? Math.min(1, elapsed / shown) : 0;
  const secondsLeft = turn ? Math.max(0, Math.ceil((shown - elapsed) / 1000)) : 0;
  const pending = turn !== null && now < turn.startedAt;
  const many = state.towers.length > 1;
  // On a day of faction towers the tower is a colour's, and its place in the race is the context.
  const colour: FactionId | null =
    state.rules === 'factions'
      ? (state.towers.find((t) => t.id === state.tower)?.faction ?? null)
      : null;
  const race = colour ? raceWith(state, height) : [];
  const standing = colour ? raceStanding(race, colour) : null;
  /** How the tower on screen ended, on an older post, and the viewer's part in it. */
  const ending = [
    `${state.builders.toLocaleString()} ${state.builders === 1 ? 'builder' : 'builders'}`,
    `${state.fallen.toLocaleString()} fell`,
    ...(me && me.tower === state.tower && me.blocks > 0 ? [`you laid ${me.blocks}`] : []),
  ].join(' · ');

  const banner = (() => {
    if (hushed) return null;
    if (past) return { word: 'Topped out', sub: ending, tone: 'quiet' };
    if (state.closed) return { word: 'Topped out', sub: null, tone: 'quiet' };
    if (me?.out) return { word: 'Out for today', sub: null, tone: 'out' };
    // Held through the beat before the next turn, even when that turn is the player's own again.
    if (tally && !(mine && burst && !burst.ended && !pending)) {
      // A turn let run out with nothing laid says only that it is over.
      if (tally.laid === 0) return { word: 'Time', sub: null, tone: 'quiet' };
      const xp = tally === burst && turnXp > 0 ? ` · +${turnXp} XP` : '';
      // A turn that made the tower's marked few says so, ahead of its streak: it is now on the
      // tower with the player's face beside it.
      const rank = tally === burst ? madeTheList(tally) : 0;
      const where = colour ? ` on ${factionName(colour)}` : '';
      const said =
        rank === 1
          ? `Best turn${where}`
          : rank > 0
            ? `${ordinal(rank)} best${where}`
            : tally.best >= 3
              ? `${tally.best} perfect in a row`
              : null;
      return {
        word: `+${tally.laid}`,
        sub: `Time${said ? ` · ${said}` : ''}${xp}`,
        tone: 'tally',
      };
    }
    if (!turn) return { word: 'Waiting', sub: 'Nobody is building', tone: 'quiet' };
    if (!mine || burst?.ended) return null;
    if (pending || !burst || burst.laid === 0) {
      return { word: 'Your turn', sub: pending ? 'Get ready' : 'Tap to drop', tone: 'mine' };
    }
    // Under way: what the turn has laid, punched up on every landing, over the clock.
    return { word: `+${burst.laid}`, sub: null, tone: 'count' };
  })();
  const clockOn = mine && !pending && !!burst && !burst.ended;

  // The solo run's word for a landing that missed a perfect, in the same place above the tower.
  const off = offWord(lastLanding?.placement);

  // The viewer's own colour in the race, wherever they are looking: passing a colour is the news
  // the race exists to make, and being passed is the push back.
  const myColour = state.rules === 'factions' && !past ? (state.me?.faction ?? null) : null;
  const myRace = myColour ? raceStanding(colour ? race : raceOf(state.towers), myColour) : null;
  const [passNote, setPassNote] = React.useState<{
    key: number;
    faction: FactionId;
    ours: boolean;
  } | null>(null);
  const lastRace = React.useRef<{
    place: number;
    above: FactionId | null;
    below: FactionId | null;
  } | null>(null);
  React.useEffect(() => {
    if (!myRace || myRace.place === 0) return;
    const was = lastRace.current;
    const now = {
      place: myRace.place,
      above: myRace.above?.faction ?? null,
      below: myRace.below?.faction ?? null,
    };
    lastRace.current = now;
    if (!was || was.place === 0 || was.place === now.place) return;
    if (now.place < was.place && was.above) {
      // Up a place: the colour that was just above is behind now.
      setPassNote((n) => ({ key: (n?.key ?? 0) + 1, faction: was.above!, ours: true }));
      AudioPlayer.playMilestone('pass');
    } else if (now.place > was.place && now.above) {
      const by = now.above;
      setPassNote((n) => ({ key: (n?.key ?? 0) + 1, faction: by, ours: false }));
      AudioPlayer.playMiss(false);
    }
  }, [myRace]);
  React.useEffect(() => {
    if (!passNote) return;
    const t = setTimeout(() => setPassNote((n) => (n === passNote ? null : n)), PASS_MS);
    return () => clearTimeout(t);
  }, [passNote]);

  const index = state.towers.findIndex((t) => t.id === state.tower);
  const step = (by: number) => {
    if (!onWatch || state.towers.length < 2) return;
    const next = state.towers[(index + by + state.towers.length) % state.towers.length];
    if (next) onWatch(next.id);
  };

  return (
    <div className="hud relay-hud">
      <div className="relay-top">
        <div className="relay-top__readout">
          <Readout
            label={
              colour ? (
                <span className="relay-colour">
                  <FactionSquare faction={colour} />
                  {factionName(colour)}
                  {standing && standing.place > 0 && (
                    <span key={standing.place} className="relay-colour__place ui-pop">
                      {past
                        ? `${ordinal(standing.place)} · ${shortDay(state.day)}`
                        : ordinal(standing.place)}
                    </span>
                  )}
                </span>
              ) : past ? (
                `Final · ${shortDay(state.day)}`
              ) : many ? (
                `Tower ${state.tower} of ${state.towers.length}`
              ) : (
                'Relay'
              )
            }
            value={height.toLocaleString()}
            size="large"
          />
          {/* Passed on the player's own turn: said here, under the height it was passed by, since
              the middle of the frame is the turn's. */}
          {passNote && passNote.ours && mine && colour === myColour ? (
            <span
              key={`passed-${passNote.key}`}
              className="relay-race relay-race--passed ui-pop"
              style={{ color: factionHex(myColour) }}
            >
              Passed {factionName(passNote.faction)}
            </span>
          ) : (
            standing && !past && <RaceLine standing={standing} />
          )}
          {/* The player's part of it: the lit bands in the tower, counted. */}
          {yours > 0 && (
            <span key={yours} className="relay-yours ui-pop">
              {yours.toLocaleString()} yours
            </span>
          )}
          {/* One word, naming where a tap goes, as Plot and Map do: the whole tower from its top,
              its top from the whole. Under the height, which is what it is about. */}
          {towerView && (
            <Button
              variant="ghost"
              className="relay-view"
              onClick={() => onTowerView(towerView === 'top' ? 'whole' : 'top')}
              ariaLabel={towerView === 'top' ? 'Show the whole tower' : 'Show the top of the tower'}
            >
              {towerView === 'top' ? 'Whole' : 'Top'}
            </Button>
          )}
        </div>
        <div className="relay-top__side">
          {onMap && (
            <Button variant="ghost" onClick={onMap}>
              Map
            </Button>
          )}
          {notify !== null && <NotifyBell on={notify} onToggle={onToggleNotify} />}
          <IconButton label={muted ? 'Sound on' : 'Sound off'} onClick={onToggleMute}>
            {muted ? <SoundOffIcon /> : <SoundOnIcon />}
          </IconButton>
        </div>
      </div>

      {banner && (
        <div
          className={`relay-banner relay-banner--${banner.tone}`}
          key={`${banner.word}-${turn?.startedAt ?? 0}`}
        >
          <span className="relay-banner__word">{banner.word}</span>
          {banner.sub && <span className="relay-banner__sub">{banner.sub}</span>}
          {clockOn && banner.tone !== 'tally' && (
            <span
              className={`relay-banner__clock${secondsLeft <= 3 ? ' relay-banner__clock--low' : ''}`}
            >
              {secondsLeft}
            </span>
          )}
        </div>
      )}

      {streakWord && mine && (
        <div
          key={`streak-${streakWord.key}`}
          className={`hud-callout hud-callout--relay${
            streakTierIndex(streakWord.streak) >= 6
              ? ' hud-callout--gold'
              : streakTierIndex(streakWord.streak) >= 3
                ? ' hud-callout--accent'
                : ''
          }`}
          aria-live="polite"
        >
          <span
            className="hud-callout__word"
            style={
              {
                ['--callout-scale' as string]:
                  1 + 0.05 * Math.min(streakTierIndex(streakWord.streak), 7),
                ['--callout-chars' as string]: streakName(streakWord.streak).length,
              } as React.CSSProperties
            }
          >
            {streakName(streakWord.streak)}
          </span>
        </div>
      )}

      {passNote && myColour && !(passNote.ours && mine && colour === myColour) && (
        <div
          key={`pass-${passNote.key}`}
          className={`hud-callout hud-callout--relay relay-pass${passNote.ours ? '' : ' relay-pass--theirs'}`}
          aria-live="polite"
        >
          <span
            className="hud-callout__word"
            style={
              {
                ['--callout-scale' as string]: passNote.ours ? 1 : 0.7,
                ['--callout-chars' as string]: 12,
                color: passNote.ours ? factionHex(myColour) : factionHex(passNote.faction),
              } as React.CSSProperties
            }
          >
            {passNote.ours
              ? `Passed ${factionName(passNote.faction)}`
              : `${factionName(passNote.faction)} passed you`}
          </span>
        </div>
      )}

      {off && (
        <div key={lastLanding?.n} className="hud-callout hud-callout--relay" aria-live="polite">
          <span
            className="hud-callout__word"
            style={
              {
                ['--callout-scale' as string]: 0.75,
                ['--callout-chars' as string]: off.length,
              } as React.CSSProperties
            }
          >
            {off}
          </span>
        </div>
      )}

      <LobbyStrip
        lobby={state.lobby}
        turn={turn}
        myUserId={myUserId}
        progress={progress}
        leaving={leaving}
        myLives={
          me && me.tower === state.tower && !me.out
            ? { left: livesLeft(me), total: livesToday(me) }
            : null
        }
      />

      <div className="relay-bottom">
        {/* A place in line stops being news the moment the turn arrives or the player falls. */}
        {notice && !mine && !me?.out && (
          <div className="relay-notice" key={notice}>
            <Pill tone="good">{notice}</Pill>
          </div>
        )}
        {asUserResult && (
          <div className="relay-notice" key={asUserResult.text}>
            <Pill tone={asUserResult.ok ? 'good' : 'alert'}>{asUserResult.text}</Pill>
          </div>
        )}
        {showBrag && me?.out && (
          <CommentOffer
            comment={{
              kind: 'fell',
              score: 0,
              blocks: me.out.block,
              perfectStreak: 0,
              faction: me.faction,
            }}
            username={myUsername}
            isPosting={isPosting}
            onPost={onBrag}
          />
        )}
        {/* Out for the day: subscribing is the way back in, and it leads. It is its own button
            and does only what it says; a player it brings back takes their seat with a tap of
            their own. The map is still the word at the top. */}
        {onSubscribe && (
          <Button
            onClick={(e) => onSubscribe(e.nativeEvent)}
            disabled={subscribing}
            sub={`r/${subreddit} · ${moreLives()} a day`}
          >
            {subscribing ? 'Subscribing' : 'Subscribe'}
          </Button>
        )}
        {/* Out for the day without that, or the day is done: nothing is left to do on these
            towers, so the one thing to do is the map, and it is the primary rather than a link in
            a corner. An older post's day is done too, but its seat is on today's relay, which
            leads. */}
        {!past && !onSubscribe && (me?.out || state.closed) && onMap && (
          <Button onClick={onMap}>Build on the map</Button>
        )}
        {onJoin && (
          <Button
            onClick={onJoin}
            disabled={joining}
            sub={past && !joining ? "Today's relay" : undefined}
          >
            {joining ? 'Finding a seat' : joinLabel}
          </Button>
        )}
        {onWatch && many && (
          <div className="relay-pager" role="group" aria-label="Other towers">
            <IconButton label="Previous tower" onClick={() => step(-1)}>
              <PrevIcon />
            </IconButton>
            <span
              className="relay-pager__label"
              style={colour ? { color: factionHex(colour) } : undefined}
            >
              {colour ? factionName(colour) : `Tower ${state.tower}`}
            </span>
            <IconButton label="Next tower" onClick={() => step(1)}>
              <NextIcon />
            </IconButton>
          </div>
        )}
      </div>
    </div>
  );
};
