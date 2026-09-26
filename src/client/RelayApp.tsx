import React from 'react';
import { Canvas } from '@react-three/fiber';
import { context } from '@devvit/web/client';
import { GameScene } from './components/game/GameScene_Simple';
import type { DebrisSpawn } from './components/game/CutDebris';
import { RelayHud } from './components/relay/RelayHud';
import { RelayFall, type Fall } from './components/relay/RelayFall';
import { RelayNeighbours } from './components/relay/RelayNeighbours';
import type { LeavingSeat } from './components/relay/LobbyStrip';
import { AudioPlayer } from './components/audio/AudioPlayer';
import { useRelay, type RelayMoments } from './hooks/useRelay';
import { useRelayTurn } from './hooks/useRelayTurn';
import { factionTheme } from './constants/factions';
import { chooseTower } from '../shared/relay/rules';
import { factionHex, factionRgb } from '../shared/types/factions';
import { cellToWorld } from '../shared/types/worldGrid';
import { openPost } from './utils/postLink';
import { enableServerLogging } from './utils/serverLogger';
import { Telemetry } from './utils/telemetry';
import { askToSignIn, editComment, mayPostAsUser } from './utils/platform';
import { commentDraft } from '../shared/social/comments';

enableServerLogging();

/** How long a fall holds the middle of the frame. */
const FALL_MS = 2600;
/** How long a fallen seat takes to drop out of the strip. */
const LEAVING_MS = 1200;
/** When the healed top flashes, after the fall has been seen to happen. */
const HEAL_AFTER_MS = 320;

const ordinal = (n: number): string => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

/** A buzz, only once the player has touched the post and while it is on screen, like sound. */
const vibrate = (pattern: number[]): void => {
  if (!AudioPlayer.engaged()) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // No haptics is fine.
  }
};

/**
 * Stonefall, the relay post.
 *
 * Towers, crews, one block each in turn. The scene is the solo run's scene: the same sweep, the
 * same landing, the same fall, because the block is judged by the same simulation. What differs
 * is who is holding the block, and the chrome is about that: whose turn, who is in the crew,
 * which of the other towers is ahead, and -- the one moment with real stakes -- who just fell.
 *
 * An older post opens on its own day's towers as they topped out, to be paged through. Its seat
 * button takes a seat on today's relay, here, and the post plays today's from then on.
 */
export const RelayApp: React.FC = () => {
  const [fall, setFall] = React.useState<Fall | null>(null);
  const [leaving, setLeaving] = React.useState<LeavingSeat | null>(null);
  /** Blocks that went over the edge, by the tower they fell from, kept only while they fall. */
  const [debris, setDebris] = React.useState<Array<{ tower: number; spawn: DebrisSpawn }>>([]);
  const [impulse, setImpulse] = React.useState<{
    key: number;
    kind: 'over' | 'heal';
  } | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [joining, setJoining] = React.useState(false);

  /**
   * What just happened on the tower on screen, as it arrives. A fall is shown to everyone: the
   * overlay, the seat dropping out, the block going over the edge in the scene and the frame
   * shaking, then the healed top flashing. Landings are heard from the scene itself.
   */
  const onMoments = React.useCallback<RelayMoments>((events, before) => {
    for (const e of events) {
      const mine = !!before?.me && e.username === before.me.username;
      if (e.kind === 'fell') {
        const key = e.at;
        const index = before?.lobby.findIndex((p) => p.username === e.username) ?? -1;
        const player = index >= 0 ? before!.lobby[index]! : null;
        setFall({
          key,
          username: e.username,
          snoovatar: e.snoovatar ?? player?.snoovatar ?? null,
          faction: e.faction ?? player?.faction ?? null,
          block: e.block,
          mine,
        });
        setTimeout(() => setFall((f) => (f?.key === key ? null : f)), FALL_MS);
        if (player) {
          setLeaving({ key, player, index });
          setTimeout(() => setLeaving((l) => (l?.key === key ? null : l)), LEAVING_MS);
        }
        // The dropper's own scene already threw their block; everyone else gets it from the
        // server, from where it really was.
        if (!mine && e.missed && before) {
          const m = e.missed;
          const x = m.x / 1000;
          const z = m.z / 1000;
          const len = Math.hypot(x, z);
          const spawnKey = `fell-${e.at}`;
          setDebris((prev) => [
            ...prev.slice(-8),
            {
              tower: before.tower,
              spawn: {
                key: spawnKey,
                x,
                y: m.y / 1000,
                z,
                width: m.width / 1000,
                height: m.height / 1000,
                depth: m.depth / 1000,
                dirX: len > 0.01 ? x / len : 1,
                dirZ: len > 0.01 ? z / len : 0,
                color: factionHex(e.faction ?? null),
              },
            },
          ]);
          // Thrown once; a scene mounted later for this tower must not throw it again.
          setTimeout(
            () => setDebris((prev) => prev.filter((d) => d.spawn.key !== spawnKey)),
            FALL_MS
          );
          setImpulse({ key: e.at, kind: 'over' });
        }
        AudioPlayer.playElimination(mine);
        vibrate(mine ? [60, 40, 160] : [30, 30, 30]);
      } else if (e.kind === 'healed') {
        setTimeout(() => {
          setImpulse({ key: e.at + 0.5, kind: 'heal' });
          AudioPlayer.playHeal();
        }, HEAL_AFTER_MS);
      } else if (e.kind === 'perfect' && !mine) {
        AudioPlayer.playPerfectImpact(1, 1);
      } else if (e.kind === 'joined' && !mine) {
        AudioPlayer.playTap(1.3);
      }
    }
  }, []);

  const relay = useRelay(onMoments);
  const state = relay.state;
  const myUserId = state?.me?.userId ?? context?.userId ?? null;
  const turn = useRelayTurn(state, myUserId);
  const [muted, setMuted] = React.useState(() => AudioPlayer.isMuted());
  const [bragDismissed, setBragDismissed] = React.useState(false);
  const [isPosting, setIsPosting] = React.useState(false);
  const [mapPostId, setMapPostId] = React.useState<string | null>(null);

  React.useEffect(() => {
    AudioPlayer.loadMutePreference();
    setMuted(AudioPlayer.isMuted());
    void fetch('/api/map/today')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { postId?: string | null } | null) => setMapPostId(d?.postId ?? null))
      .catch(() => setMapPostId(null));
  }, []);

  const readySent = React.useRef(false);
  React.useEffect(() => {
    if (readySent.current || !state) return;
    readySent.current = true;
    Telemetry.appReady();
  }, [state]);

  const holder = state?.turn
    ? (state.lobby.find((p) => p.userId === state.turn!.userId) ?? null)
    : null;
  const mine = state?.turn?.userId === myUserId && myUserId !== null;
  /** An older post, showing how its own day's towers ended. Nobody sits on those. */
  const past = !relay.live && !!state?.closed;
  const seated = !past && !!state?.me?.tower && !state.me.out;

  // Your turn: a sound and a buzz, once per turn.
  const announced = React.useRef<number>(0);
  React.useEffect(() => {
    if (!state?.turn || !mine) return;
    if (announced.current === state.turn.startedAt) return;
    announced.current = state.turn.startedAt;
    AudioPlayer.playYourTurn();
    vibrate([40, 40, 80]);
  }, [state?.turn, mine]);

  // A sitting ends when the seat does: a fall, the day topping out, or a seat given up by letting
  // turns run out or by being away too long. Only a seat held on this page can end here. States
  // older than the one on screen are refused by the relay hook, so a late answer cannot unseat.
  // The post a seat is held on is remembered, because the day turning over moves this page on to
  // the new day's relay: a seat that vanishes with a change of post topped out with the day.
  const sat = React.useRef<string | null>(null);
  React.useEffect(() => {
    const me = state?.me;
    if (!state || !me) return;
    if (me.tower && !me.out && !state.closed) {
      sat.current = state.postId;
      return;
    }
    if (!sat.current) return;
    const turnedOver = sat.current !== state.postId;
    sat.current = null;
    Telemetry.relayEnded({
      fell: !turnedOver && !!me.out,
      toppedOut: turnedOver || (state.closed && !me.out),
    });
  }, [state]);

  const toggleMute = React.useCallback(() => {
    const next = !AudioPlayer.isMuted();
    AudioPlayer.setMuted(next);
    setMuted(next);
    AudioPlayer.unlock();
    if (!next) AudioPlayer.playTap(1.2);
  }, []);

  const onPointerDown = React.useCallback(
    (e: React.PointerEvent) => {
      AudioPlayer.unlock();
      if (!(e.target instanceof HTMLCanvasElement)) return;
      if (!state?.turn) return;
      const tick = turn.tap();
      if (tick === null) return;
      const index = state.turn.index;
      void relay.drop(tick, index).then((res) => {
        if (res.success && res.result !== 'fell') Telemetry.relayLanded();
        else if (!res.success && res.message) console.warn(`[relay] ${res.message}`);
      });
    },
    [state, turn, relay]
  );

  const say = React.useCallback((text: string) => {
    setNotice(text);
    setTimeout(() => setNotice((n) => (n === text ? null : n)), 2600);
  }, []);

  const onJoin = React.useCallback(async () => {
    AudioPlayer.unlock();
    setJoining(true);
    // From an older post's day, a seat wherever today's relay has room: the tower on screen is
    // that day's, and today's tower of the same number is another tower.
    const res = await relay.join(past ? null : undefined);
    setJoining(false);
    if (res.success && res.state) {
      const place = res.state.lobby.findIndex((p) => p.userId === res.state!.me?.userId);
      say(
        res.started
          ? `You started tower ${res.state.tower}`
          : `On tower ${res.state.tower}${place > 0 ? `, ${ordinal(place + 1)} in line` : ''}`
      );
      Telemetry.relayJoined();
      Telemetry.did('relay_join', res.started ? 'started' : 'joined');
    } else if (res.message) {
      say(res.message);
    }
  }, [relay, say, past]);

  /** How the last comment went, shown where the offer was for a moment. */
  const [commentResult, setCommentResult] = React.useState<{ text: string; ok: boolean } | null>(
    null
  );
  const tellComment = React.useCallback((text: string, ok: boolean) => {
    setCommentResult({ text, ok });
    setTimeout(() => setCommentResult((r) => (r?.text === text ? null : r)), 2600);
  }, []);

  /** The player's own words, kept if posting them failed, for the next Edit. */
  const draftRef = React.useRef<string | null>(null);

  /**
   * Post the comment the player just confirmed: the game's words, or theirs from Edit. Reddit is
   * asked first whether the player lets the app comment as them; a no posts nothing. Only a
   * comment that went up takes the offer away.
   */
  const postBrag = React.useCallback(
    async (event: Event, text?: string) => {
      setIsPosting(true);
      if (!(await mayPostAsUser(event))) {
        setIsPosting(false);
        tellComment('Not posted', false);
        return;
      }
      const r = await relay.brag(text);
      setIsPosting(false);
      if (!r.ok) {
        if (text) draftRef.current = text;
        tellComment(r.message ?? 'Could not post that', false);
        return;
      }
      draftRef.current = null;
      setBragDismissed(true);
      Telemetry.did('brag_posted', 'fell');
      tellComment(r.topLevel ? 'Posted in the thread' : 'Posted under Scores', true);
    },
    [relay, tellComment]
  );

  const onBrag = React.useCallback((event: Event) => void postBrag(event), [postBrag]);

  /** Edit first: Reddit's form, opened on the game's words (or the last draft), then post. */
  const me = state?.me ?? null;
  const onEditBrag = React.useCallback(
    async (event: Event) => {
      if (!me?.out) return;
      const draft =
        draftRef.current ??
        commentDraft({
          kind: 'fell',
          score: 0,
          blocks: me.out.block,
          perfectStreak: 0,
          faction: me.faction,
        });
      const text = await editComment(draft, me.username ?? context?.username ?? null);
      if (text !== null) await postBrag(event, text);
    },
    [me, postBrag]
  );

  const palette = React.useMemo(
    () => (state ? state.colors.map((f) => (f ? factionHex(f) : null)) : []),
    [state]
  );
  const theme = React.useMemo(
    () => factionTheme(mine ? (state?.me?.faction ?? null) : (holder?.faction ?? null)),
    [mine, state?.me?.faction, holder?.faction]
  );

  /**
   * What "join" would do, said on the button: sit down here, go to the tower with room, or
   * start a new one. The crew on screen is counted from the lobby, which is fresher than the
   * summary it came with.
   */
  const joinLabel = React.useMemo(() => {
    if (!state || past) return 'Take a seat';
    const choice = chooseTower(
      state.towers.map((t) => ({
        id: t.id,
        crew: t.id === state.tower ? state.lobby.length : t.crew,
        height: t.height,
        closed: t.closed,
      })),
      state.tower,
      state.crewMax
    );
    if (choice === state.tower) return 'Take a seat';
    return choice ? `Join tower ${choice}` : 'Start a new tower';
  }, [state, past]);

  const origin = React.useMemo(() => ({ x: cellToWorld(0), z: cellToWorld(0) }), []);
  const viewedTower = state?.tower ?? 0;
  const falling = React.useMemo(
    () => debris.filter((d) => d.tower === viewedTower).map((d) => d.spawn),
    [debris, viewedTower]
  );
  const canJoin = past || (!!state && !state.closed && !state.me?.out && !seated);
  /**
   * Signed in: the server always answers a signed-in viewer with a `me`, seated or not. Signed
   * out, the seat button asks Reddit to sign the player in, which reloads the post, rather than
   * offering a seat the server would refuse.
   */
  const signedIn = !!state?.me || !!context?.userId;

  return (
    <div
      onPointerDown={onPointerDown}
      style={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        background: '#000814',
        ['--accent-rgb' as string]: factionRgb(state?.me?.faction ?? null),
      }}
    >
      <Canvas
        dpr={[0.7, 1.5]}
        data-game-canvas="true"
        style={{ position: 'absolute', inset: 0 }}
        camera={{ position: [70, 55, 70], fov: 30, near: 1, far: 12000 }}
        gl={{ antialias: false, alpha: false, powerPreference: 'high-performance' }}
      >
        <color attach="background" args={['#000814']} />
        {turn.gameState && state && (
          <GameScene
            // A different tower is a different scene: its blocks, its history, its falls. The
            // post is part of it because a new day brings a new tower 1.
            key={`${state.postId}:${state.tower}`}
            gameState={turn.gameState}
            gameMode="relay"
            isPlaying={turn.live}
            stepSimulationFrame={turn.stepFrame}
            playerColorTheme={theme}
            originX={origin.x}
            originZ={origin.z}
            paletteByIndex={palette}
            activeBlockColor={theme.accentHex}
            extraDebris={falling}
            impulse={impulse}
          />
        )}
        {state && (
          <RelayNeighbours
            towers={state.towers}
            focus={state.tower}
            origin={origin}
            onPick={seated ? undefined : (n) => relay.watch(n)}
          />
        )}
      </Canvas>

      {state && (
        <RelayHud
          state={state}
          myUserId={myUserId}
          serverNow={relay.serverNow}
          dropped={turn.dropped}
          muted={muted}
          isPosting={isPosting}
          onToggleMute={toggleMute}
          onBrag={onBrag}
          onEditBrag={(event) => void onEditBrag(event)}
          commentResult={commentResult}
          showBrag={!past && !!state.me?.out && !bragDismissed}
          myUsername={state.me?.username ?? context?.username ?? null}
          onMap={mapPostId ? () => openPost(mapPostId) : null}
          onJoin={canJoin ? () => (signedIn ? void onJoin() : askToSignIn()) : null}
          joinLabel={signedIn ? joinLabel : 'Sign in to play'}
          joining={joining}
          past={past}
          onWatch={seated ? null : (n) => relay.watch(n)}
          leaving={leaving}
          notice={notice}
          hushed={fall !== null}
        />
      )}

      {fall && <RelayFall key={fall.key} fall={fall} />}

      {!state && (
        <div className="relay-empty">
          <span className="ui-label">Relay tower</span>
          <span className="ui-value">{relay.error ?? 'Joining'}</span>
        </div>
      )}
    </div>
  );
};
