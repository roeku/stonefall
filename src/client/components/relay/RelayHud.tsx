import React from 'react';
import type { RelayState } from '../../../shared/types/api';
import { RELAY } from '../../../shared/relay/rules';
import { Button, IconButton, Pill, Readout } from '../ui/Chrome';
import { CommentConfirm } from '../ui/Social';
import { NextIcon, PrevIcon, SoundOffIcon, SoundOnIcon } from '../ui/icons';
import { shortDay } from '../../utils/days';
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
  /** Post the confirmed comment. Given the trusted click that confirmed it. */
  onBrag: (event: Event) => void;
  /** Open the comment to edit it first, then post what the player wrote. Given the click. */
  onEditBrag: (event: Event) => void;
  /** How the last comment went, said where the offer was: posting is news to someone out. */
  commentResult: { text: string; ok: boolean } | null;
  showBrag: boolean;
  /** The name a comment goes out under. */
  myUsername: string | null;
  onMap: (() => void) | null;
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
}

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
  dropped,
  muted,
  isPosting,
  onToggleMute,
  onBrag,
  onEditBrag,
  commentResult,
  showBrag,
  myUsername,
  onMap,
  onJoin,
  joinLabel,
  joining,
  past,
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
  /** How the tower on screen ended, on an older post, and the viewer's part in it. */
  const tally = [
    `${state.builders.toLocaleString()} ${state.builders === 1 ? 'builder' : 'builders'}`,
    `${state.fallen.toLocaleString()} fell`,
    ...(me && me.tower === state.tower && me.blocks > 0 ? [`you laid ${me.blocks}`] : []),
  ].join(' · ');

  const banner = (() => {
    if (hushed) return null;
    if (past) return { word: 'Topped out', sub: tally, tone: 'quiet' };
    if (state.closed) return { word: 'Topped out', sub: null, tone: 'quiet' };
    if (me?.out) return { word: 'Out for today', sub: null, tone: 'out' };
    if (!turn) return { word: 'Waiting', sub: 'Nobody is building', tone: 'quiet' };
    if (!mine) return null;
    if (dropped) return { word: 'Dropped', sub: null, tone: 'quiet' };
    return { word: 'Your turn', sub: pending ? 'Get ready' : 'Tap to drop', tone: 'mine' };
  })();

  /** The comment's confirmation is open: the one thing on the foot until it is answered. */
  const [commenting, setCommenting] = React.useState(false);
  const commentUp = showBrag && commenting && !!me?.out;

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
          label={
            past
              ? `Final · ${shortDay(state.day)}`
              : many
                ? `Tower ${state.tower} of ${state.towers.length}`
                : 'Relay'
          }
          value={height.toLocaleString()}
          size="large"
        />
        <div className="relay-top__side">
          {onMap && (
            <Button variant="ghost" onClick={onMap}>
              Map
            </Button>
          )}
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
        {commentResult && (
          <div className="relay-notice" key={commentResult.text}>
            <Pill tone={commentResult.ok ? 'good' : 'alert'}>{commentResult.text}</Pill>
          </div>
        )}
        {commentUp && me?.out ? (
          <CommentConfirm
            comment={{
              kind: 'fell',
              score: 0,
              blocks: me.out.block,
              perfectStreak: 0,
              faction: me.faction,
            }}
            username={myUsername}
            isPosting={isPosting}
            onConfirm={onBrag}
            onEdit={onEditBrag}
            onCancel={() => setCommenting(false)}
          />
        ) : (
          showBrag && (
            <div className="brag" role="group" aria-label="Share it">
              <Button variant="link" onClick={() => setCommenting(true)}>
                Comment your fall
              </Button>
            </div>
          )
        )}
        {/* Out for the day, or the day is done: nothing is left to do on these towers, so the
            one thing to do is the map, and it is the primary rather than a link in a corner. An
            older post's day is done too, but its seat is on today's relay, which leads. */}
        {!past && (me?.out || state.closed) && onMap && !commentUp && (
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
        {onWatch && many && !commentUp && (
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
