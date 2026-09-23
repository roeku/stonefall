import React from 'react';
import type { RelayEvent, RelayState } from '../../../shared/types/api';
import { RELAY } from '../../../shared/relay/rules';
import { Button, IconButton, Pill, Readout, Stat, StatRow } from '../ui/Chrome';
import {
  BlocksIcon,
  NextIcon,
  PrevIcon,
  SoundOffIcon,
  SoundOnIcon,
  SparkIcon,
  UsersIcon,
} from '../ui/icons';
import { LobbyStrip, type LeavingSeat } from './LobbyStrip';

interface RelayHudProps {
  state: RelayState;
  myUserId: string | null;
  /** The server's clock, for the turn timer. */
  serverNow: () => number;
  /** True while this client's own block is sweeping. */
  myTurnLive: boolean;
  dropped: boolean;
  muted: boolean;
  isPosting: boolean;
  onToggleMute: () => void;
  onBrag: () => void;
  onDismissBrag: () => void;
  showBrag: boolean;
  onMap: (() => void) | null;
  /** Take a seat. Null while one is held, or when there is nothing to join. */
  onJoin: (() => void) | null;
  /** What joining will do: join this tower, another with room, or start one. */
  joinLabel: string;
  joining: boolean;
  /** Look at another tower. Only while watching, and only when there is more than one. */
  onWatch: ((tower: number) => void) | null;
  /** Somebody who just fell, dropping out of their seat. */
  leaving: LeavingSeat | null;
  /** One line answering the last thing the player did, e.g. where they were seated. */
  notice: string | null;
  /** Something bigger has the middle of the frame, e.g. a fall; the ticker keeps quiet. */
  hushed: boolean;
}

const describe = (e: RelayEvent): string | null => {
  switch (e.kind) {
    case 'perfect':
      return `u/${e.username} laid ${e.block} flush`;
    case 'landed':
      return `u/${e.username} laid block ${e.block}`;
    case 'fell':
      return `u/${e.username} fell at ${e.block}`;
    case 'healed':
      return 'the top healed';
    case 'joined':
      return `u/${e.username} took a seat`;
    case 'opened':
      return 'a new tower';
    case 'closed':
      return `topped out at ${e.block}`;
  }
};

/**
 * The relay's chrome: which tower, whose turn, who is in the crew, what just happened.
 *
 * Pointer events are off everywhere but the buttons, because on your turn the whole screen is
 * the drop button and nothing here may eat that tap. Someone who has not taken a seat gets one
 * primary, the seat, and a pager to look along the other towers first.
 */
export const RelayHud: React.FC<RelayHudProps> = ({
  state,
  myUserId,
  serverNow,
  myTurnLive,
  dropped,
  muted,
  isPosting,
  onToggleMute,
  onBrag,
  onDismissBrag,
  showBrag,
  onMap,
  onJoin,
  joinLabel,
  joining,
  onWatch,
  leaving,
  notice,
  hushed,
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
  const height = state.blocks.length;
  const mine = turn !== null && turn.userId === myUserId;
  const elapsed = turn ? Math.max(0, now - turn.startedAt) : 0;
  const progress = turn ? Math.min(1, elapsed / RELAY.SHOWN_TURN_MS) : 0;
  const secondsLeft = turn ? Math.max(0, Math.ceil((RELAY.SHOWN_TURN_MS - elapsed) / 1000)) : 0;
  const pending = turn !== null && now < turn.startedAt;
  const many = state.towers.length > 1;
  const seated = !!me?.tower && me.tower === state.tower && !me.out;

  const events = React.useMemo(
    () =>
      [...state.events]
        .reverse()
        .filter((e) => describe(e) !== null)
        .slice(0, 6),
    [state.events]
  );
  // The newest thing leads for a few seconds, then the line cycles back through the rest.
  const newest = events[0]?.at ?? now;
  const eventIndex =
    events.length > 1 ? Math.floor(Math.max(0, now - newest) / 3600) % events.length : 0;
  const event = events[eventIndex];

  const banner = (() => {
    if (state.closed)
      return { word: 'Topped out', sub: `${height.toLocaleString()} blocks today`, tone: 'quiet' };
    if (me?.out)
      return {
        word: 'Out for today',
        sub: `Fell at ${me.out.block.toLocaleString()}`,
        tone: 'out',
      };
    if (!turn)
      return {
        word: 'Waiting',
        sub: seated ? 'Your turn is coming' : 'Nobody is building this one',
        tone: 'quiet',
      };
    if (mine && dropped) return { word: 'Dropped', sub: 'Passing the block on', tone: 'quiet' };
    if (mine && pending) return { word: 'Your turn', sub: 'Get ready', tone: 'mine' };
    if (mine) return { word: 'Your turn', sub: 'Tap to drop', tone: 'mine' };
    // Long names are cut here rather than by the box, which would clip the glow into a slab.
    const name = turn.username.length > 13 ? `${turn.username.slice(0, 12)}…` : turn.username;
    return { word: `u/${name}`, sub: pending ? 'Up next' : 'is dropping', tone: 'theirs' };
  })();

  const index = state.towers.findIndex((t) => t.id === state.tower);
  const step = (by: number) => {
    if (!onWatch || state.towers.length < 2) return;
    const next = state.towers[(index + by + state.towers.length) % state.towers.length];
    if (next) onWatch(next.id);
  };

  return (
    <div className="hud relay-hud">
      <div className="hud-top">
        <Readout
          label={many ? `Relay · Tower ${state.tower} of ${state.towers.length}` : 'Relay tower'}
          value={`${height.toLocaleString()} blocks`}
          size="large"
        />
        <StatRow>
          <Stat
            icon={<UsersIcon />}
            value={`${state.lobby.length}/${state.crewMax}`}
            title="Crew here now, of the most a tower holds"
          />
          {state.fallen > 0 && (
            <Stat
              icon={<BlocksIcon />}
              value={state.fallen.toLocaleString()}
              title="Fallen on this tower today"
              tone="alert"
              popKey={state.fallen}
            />
          )}
          {me && me.blocks > 0 && (
            <Stat
              icon={<SparkIcon />}
              value={`${me.blocks} laid`}
              title="Blocks you laid today"
              tone="good"
            />
          )}
        </StatRow>
      </div>

      <div
        className={`relay-banner relay-banner--${banner.tone}`}
        key={`${banner.word}-${turn?.startedAt ?? 0}`}
      >
        <span className="relay-banner__word">{banner.word}</span>
        <span className="relay-banner__sub">{banner.sub}</span>
        {turn && !state.closed && !me?.out && !(mine && dropped) && (
          <span
            className={`relay-banner__clock${secondsLeft <= 3 ? ' relay-banner__clock--low' : ''}`}
          >
            {pending ? '' : `${secondsLeft} s`}
          </span>
        )}
      </div>

      {myTurnLive && (
        <div className="hud-teach">
          <span className="hud-teach__ring" aria-hidden="true" />
          <span className="hud-teach__word">Tap to drop</span>
        </div>
      )}

      <LobbyStrip
        lobby={state.lobby}
        turn={turn}
        myUserId={myUserId}
        progress={progress}
        leaving={leaving}
      />

      <div className="relay-bottom">
        {notice && (
          <div className="relay-notice" key={notice}>
            <Pill tone="good">{notice}</Pill>
          </div>
        )}
        {showBrag && (
          <div className="brag" role="group" aria-label="Share it">
            <Button onClick={onBrag} disabled={isPosting}>
              {isPosting ? 'Posting' : 'Post it'}
            </Button>
            <Button variant="ghost" onClick={onDismissBrag} disabled={isPosting}>
              Not now
            </Button>
          </div>
        )}
        {event && !showBrag && !myTurnLive && !notice && !hushed && (
          <div className="relay-ticker" key={`${event.at}-${event.kind}`}>
            <span className="relay-ticker__text">{describe(event)}</span>
          </div>
        )}
        {onJoin && !showBrag && (
          <div className="board-actions">
            <Button onClick={onJoin} disabled={joining}>
              {joining ? 'Finding a seat' : joinLabel}
            </Button>
          </div>
        )}
        <div className="relay-actions">
          {onWatch && many && (
            <div className="relay-pager" role="group" aria-label="Other towers">
              <IconButton label="Previous tower" onClick={() => step(-1)}>
                <PrevIcon />
              </IconButton>
              <span className="relay-pager__label">Tower {state.tower}</span>
              <IconButton label="Next tower" onClick={() => step(1)}>
                <NextIcon />
              </IconButton>
            </div>
          )}
          {onMap && (
            <Button variant="ghost" onClick={onMap}>
              Map
            </Button>
          )}
          <IconButton
            label={muted ? 'Sound on' : 'Sound off'}
            onClick={onToggleMute}
            className="ui-iconbtn--quiet"
          >
            {muted ? <SoundOffIcon /> : <SoundOnIcon />}
          </IconButton>
        </div>
      </div>
    </div>
  );
};
