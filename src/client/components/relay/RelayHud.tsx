import React from 'react';
import type { RelayState } from '../../../shared/types/api';
import { RELAY } from '../../../shared/relay/rules';
import { Button, IconButton, Pill, Readout } from '../ui/Chrome';
import { NextIcon, PrevIcon, SoundOffIcon, SoundOnIcon } from '../ui/icons';
import { LobbyStrip, type LeavingSeat } from './LobbyStrip';

interface RelayHudProps {
  state: RelayState;
  myUserId: string | null;
  /** The server's clock, for the turn timer. */
  serverNow: () => number;
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

/**
 * The relay's chrome: which tower and how tall, whose turn, who is in the crew.
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

  const banner = (() => {
    if (hushed) return null;
    if (state.closed) return { word: 'Topped out', sub: null, tone: 'quiet' };
    if (me?.out) return { word: 'Out for today', sub: null, tone: 'out' };
    if (!turn) return { word: 'Waiting', sub: 'Nobody is building', tone: 'quiet' };
    if (!mine) return null;
    if (dropped) return { word: 'Dropped', sub: null, tone: 'quiet' };
    return { word: 'Your turn', sub: pending ? 'Get ready' : 'Tap to drop', tone: 'mine' };
  })();

  const index = state.towers.findIndex((t) => t.id === state.tower);
  const step = (by: number) => {
    if (!onWatch || state.towers.length < 2) return;
    const next = state.towers[(index + by + state.towers.length) % state.towers.length];
    if (next) onWatch(next.id);
  };

  return (
    <div className="hud relay-hud">
      <div className="relay-top">
        <Readout
          label={many ? `Tower ${state.tower} of ${state.towers.length}` : 'Relay'}
          value={height.toLocaleString()}
          size="large"
        />
        <div className="relay-top__side">
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

      {banner && (
        <div
          className={`relay-banner relay-banner--${banner.tone}`}
          key={`${banner.word}-${turn?.startedAt ?? 0}`}
        >
          <span className="relay-banner__word">{banner.word}</span>
          {banner.sub && <span className="relay-banner__sub">{banner.sub}</span>}
          {mine && !dropped && !pending && (
            <span
              className={`relay-banner__clock${secondsLeft <= 3 ? ' relay-banner__clock--low' : ''}`}
            >
              {secondsLeft}
            </span>
          )}
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
        {/* A place in line stops being news the moment the turn arrives or the player falls. */}
        {notice && !mine && !me?.out && (
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
        {onJoin && !showBrag && (
          <Button onClick={onJoin} disabled={joining}>
            {joining ? 'Finding a seat' : joinLabel}
          </Button>
        )}
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
      </div>
    </div>
  );
};
