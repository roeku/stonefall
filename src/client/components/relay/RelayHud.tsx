import React from 'react';
import type { RelayEvent, RelayState } from '../../../shared/types/api';
import { Button, IconButton, Readout, Stat, StatRow } from '../ui/Chrome';
import { BlocksIcon, SoundOffIcon, SoundOnIcon, SparkIcon, UsersIcon } from '../ui/icons';
import { LobbyStrip } from './LobbyStrip';

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
}

/** The client shows ten seconds; the server keeps two in reserve for the round trip. */
const SHOWN_TURN_MS = 10_000;

const describe = (e: RelayEvent): string => {
  switch (e.kind) {
    case 'perfect':
      return `u/${e.username} laid ${e.block} flush`;
    case 'landed':
      return `u/${e.username} laid block ${e.block}`;
    case 'fell':
      return `u/${e.username} fell at ${e.block}`;
    case 'healed':
      return 'the top healed';
    case 'opened':
      return 'a new tower';
    case 'closed':
      return `topped out at ${e.block}`;
  }
};

/**
 * The relay's chrome: height, whose turn, who is here, what just happened.
 *
 * Pointer events are off everywhere but the buttons, because on your turn the whole screen is
 * the drop button and nothing here may eat that tap.
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
}) => {
  // Ten times a second is plenty for a clock that shows whole seconds; the ring's motion is
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
  const progress = turn ? Math.min(1, elapsed / SHOWN_TURN_MS) : 0;
  const secondsLeft = turn ? Math.max(0, Math.ceil((SHOWN_TURN_MS - elapsed) / 1000)) : 0;
  const pending = turn !== null && now < turn.startedAt;

  const [eventIndex, setEventIndex] = React.useState(0);
  const events = React.useMemo(() => [...state.events].reverse().slice(0, 6), [state.events]);
  React.useEffect(() => {
    setEventIndex(0);
    if (events.length < 2) return;
    const t = setInterval(() => setEventIndex((i) => (i + 1) % events.length), 3600);
    return () => clearInterval(t);
  }, [events]);
  const event = events[eventIndex % Math.max(1, events.length)];

  const banner = (() => {
    if (state.closed)
      return { word: 'Topped out', sub: `${height.toLocaleString()} blocks today`, tone: 'quiet' };
    if (me?.out)
      return {
        word: 'Out for today',
        sub: `Fell at ${me.out.block.toLocaleString()}`,
        tone: 'out',
      };
    if (!turn) return { word: 'Waiting', sub: 'Turns start when someone is here', tone: 'quiet' };
    if (mine && dropped) return { word: 'Dropped', sub: 'Passing the block on', tone: 'quiet' };
    if (mine && pending) return { word: 'Your turn', sub: 'Get ready', tone: 'mine' };
    if (mine) return { word: 'Your turn', sub: 'Tap to drop', tone: 'mine' };
    return { word: `u/${turn.username}`, sub: pending ? 'Up next' : 'is dropping', tone: 'theirs' };
  })();

  return (
    <div className="hud relay-hud">
      <div className="hud-top">
        <Readout label="Relay tower" value={`${height.toLocaleString()} blocks`} size="large" />
        <StatRow>
          <Stat
            icon={<UsersIcon />}
            value={state.builders.toLocaleString()}
            title="Builders today"
          />
          {state.fallen > 0 && (
            <Stat
              icon={<BlocksIcon />}
              value={state.fallen.toLocaleString()}
              title="Fallen today"
              tone="alert"
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

      <LobbyStrip lobby={state.lobby} turn={turn} myUserId={myUserId} progress={progress} />

      <div className="relay-bottom">
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
        {event && !showBrag && !myTurnLive && (
          <div className="relay-ticker" key={`${event.at}-${event.kind}`}>
            <span className="relay-ticker__text">{describe(event)}</span>
          </div>
        )}
        <div className="relay-actions">
          {onMap && (
            <Button variant="ghost" onClick={onMap}>
              Back to the map
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
