import React from 'react';
import { Canvas } from '@react-three/fiber';
import { context } from '@devvit/web/client';
import { GameScene } from './components/game/GameScene_Simple';
import type { DebrisSpawn } from './components/game/CutDebris';
import { RelayHud } from './components/relay/RelayHud';
import { RelayFall, type Fall } from './components/relay/RelayFall';
import { RelayNeighbours } from './components/relay/RelayNeighbours';
import { OVERVIEW_RECENT, type TowerView } from './components/relay/overviewSquash';
import type { LeavingSeat } from './components/relay/LobbyStrip';
import { AudioPlayer } from './components/audio/AudioPlayer';
import { LANDING_EFFECTS, MusicManager } from './components/audio/music';
import { useRelay, type RelayMoments } from './hooks/useRelay';
import { useRelayTurn } from './hooks/useRelayTurn';
import { useNotify } from './hooks/useNotify';
import { factionTheme } from './constants/factions';
import { RELAY, chooseTower, moreLives } from '../shared/relay/rules';
import { stoneOf } from '../shared/social/stones';
import { factionHex, factionName, factionRgb } from '../shared/types/factions';
import { XP } from '../shared/social/progress';
import type { Honour } from './components/relay/TowerHonours';
import { cellToWorld } from '../shared/types/worldGrid';
import { openPost } from './utils/postLink';
import { enableServerLogging } from './utils/serverLogger';
import { Telemetry } from './utils/telemetry';
import { askToSignIn, mayActAsUser } from './utils/platform';
import { EARLY, fetchEarly } from './utils/early';
import { PlayerSettings, useSettings } from './utils/settings';
import { canvasDpr } from './utils/quality';

enableServerLogging();

/** Where the player's waiting view (Top or Whole) is kept on this device. */
const VIEW_KEY = 'stonefall:relay-view';

/** How long a fall holds the middle of the frame. */
const FALL_MS = 2600;
/** How long a miss that leaves the player a life holds it: the same hit, shorter. */
const MISS_MS = 1800;
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
 * Towers, crews, ten seconds of stacking each in turn. The scene is the solo run's scene: the
 * same sweep, the same landing, the same fall, because the block is judged by the same
 * simulation. What differs is who is holding the block, and the chrome is about that: whose turn,
 * who is in the crew, which of the other towers is ahead, and -- the one moment with real stakes
 * -- who just fell. While the turn is someone else's the camera stands back from the whole tower,
 * with the player's own blocks lit; their turn dives back to the top.
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
        // An event from before lives were counted said nothing, and every fall then was an out.
        const left = e.left ?? 0;
        const out = left === 0;
        setFall({
          key,
          username: e.username,
          snoovatar: e.snoovatar ?? player?.snoovatar ?? null,
          faction: e.faction ?? player?.faction ?? null,
          block: e.block,
          mine,
          left,
          lives: e.lives ?? RELAY.LIVES,
        });
        setTimeout(() => setFall((f) => (f?.key === key ? null : f)), out ? FALL_MS : MISS_MS);
        // Only the last life costs the seat; a miss before it keeps its place in the strip.
        if (player && out) {
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
        if (out) {
          AudioPlayer.playElimination(mine);
          vibrate(mine ? [60, 40, 160] : [30, 30, 30]);
        } else {
          AudioPlayer.playMiss(mine);
          vibrate(mine ? [50, 30, 50] : [25]);
        }
        // The player's last life ends their music like a run's end; any other fall ducks it.
        if (out && mine) MusicManager.gameOver();
        else MusicManager.duck();
      } else if (e.kind === 'healed') {
        setTimeout(() => {
          setImpulse({ key: e.at + 0.5, kind: 'heal' });
          AudioPlayer.playHeal();
        }, HEAL_AFTER_MS);
      } else if (e.kind === 'perfect' && !mine) {
        // The music plays every landing on the tower; the effect only when LANDING_EFFECTS is on.
        if (LANDING_EFFECTS) AudioPlayer.playPerfectImpact(1, 1);
      } else if (e.kind === 'joined' && !mine) {
        AudioPlayer.playTap(1.3);
      }
    }
  }, []);

  const relay = useRelay(onMoments);
  const state = relay.state;
  const myUserId = state?.me?.userId ?? context?.userId ?? null;
  const turn = useRelayTurn(state, myUserId, relay.serverNow);
  const settings = useSettings();
  const [bragDismissed, setBragDismissed] = React.useState(false);
  const [isPosting, setIsPosting] = React.useState(false);
  const [mapPostId, setMapPostId] = React.useState<string | null>(null);

  React.useEffect(() => {
    AudioPlayer.setMuted(!PlayerSettings.get().sound);
    PlayerSettings.heal();
    void fetchEarly(EARLY.mapToday)
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

  // The music waits through other players' turns and comes in on the player's own (music.ts).
  const out = !!state?.me?.out;
  React.useEffect(() => {
    MusicManager.setRelay(mine, out);
  }, [mine, out]);

  // Your turn: a sound and a buzz, once per turn.
  const announced = React.useRef<number>(0);
  React.useEffect(() => {
    if (!state?.turn || !mine) return;
    if (announced.current === state.turn.startedAt) return;
    announced.current = state.turn.startedAt;
    AudioPlayer.playYourTurn();
    vibrate([40, 40, 80]);
  }, [state?.turn, mine]);

  // A turn whose time ran out ends on the music's chord, as a run does: the turn was a run of its
  // own. A turn that ended in a fall has the fall's sound instead.
  const ended = turn.burst?.ended === 'time' ? turn.burst : null;
  React.useEffect(() => {
    if (!ended || ended.laid === 0) return;
    AudioPlayer.playResult(ended.best >= 3);
    vibrate([20, 30, 40]);
  }, [ended]);

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

  const onPointerDown = React.useCallback(
    (e: React.PointerEvent) => {
      AudioPlayer.unlock();
      if (!(e.target instanceof HTMLCanvasElement)) return;
      if (!state?.turn) return;
      const dropped = turn.tap();
      if (!dropped) return;
      if (dropped.landed) Telemetry.relayLanded();
      void relay.drop(dropped.tap).then((res) => {
        if (res.success) return;
        if (res.message) console.warn(`[relay] ${res.message}`);
        // Refused: the tower is what the server says, not what this page ran ahead to.
        turn.resync();
      });
    },
    [state, turn, relay]
  );

  const say = React.useCallback((text: string) => {
    setNotice(text);
    setTimeout(() => setNotice((n) => (n === text ? null : n)), 2600);
  }, []);

  // An order the relay finished ("Land 5 relay blocks") is said in the notice line, with its chime,
  // once the turn that finished it is over.
  const toldOrders = React.useRef(0);
  const finished = React.useMemo(() => relay.earned?.orders ?? [], [relay.earned]);
  React.useEffect(() => {
    if (finished.length === 0) {
      toldOrders.current = 0;
      return;
    }
    if (finished.length <= toldOrders.current) return;
    toldOrders.current = finished.length;
    AudioPlayer.playOrderDone();
    say(`Order done · ${finished[finished.length - 1]} · +${XP.ORDER} XP`);
  }, [finished, say]);

  /** The bell: push notifications on or off, said back in the notice line. */
  const notify = useNotify('fetch');
  const toggleNotify = React.useCallback(() => {
    void notify.toggle().then((r) => say(r.text));
  }, [notify, say]);

  const onJoin = React.useCallback(async () => {
    AudioPlayer.unlock();
    setJoining(true);
    // From an older post's day, a seat wherever today's relay has room: the tower on screen is
    // that day's, and today's tower of the same number is another tower.
    const res = await relay.join(past ? null : undefined);
    setJoining(false);
    if (res.success && res.state) {
      const place = res.state.lobby.findIndex((p) => p.userId === res.state!.me?.userId);
      const colour = res.state.towers.find((t) => t.id === res.state!.tower)?.faction;
      const where = colour ? `On ${factionName(colour)}'s tower` : `On tower ${res.state.tower}`;
      say(
        res.started
          ? `You started tower ${res.state.tower}`
          : `${where}${place > 0 ? `, ${ordinal(place + 1)} in line` : ''}`
      );
      Telemetry.relayJoined();
      Telemetry.did('relay_join', res.started ? 'started' : 'joined');
    } else if (res.message) {
      say(res.message);
    }
  }, [relay, say, past]);

  /**
   * How the last thing done as the player went, a comment or a subscription, shown where the
   * offer was for a moment.
   */
  const [asUserResult, setAsUserResult] = React.useState<{ text: string; ok: boolean } | null>(
    null
  );
  const tellAsUser = React.useCallback((text: string, ok: boolean) => {
    setAsUserResult({ text, ok });
    setTimeout(() => setAsUserResult((r) => (r?.text === text ? null : r)), 2600);
  }, []);

  /**
   * Post the comment: the game's line, with the player's own words above it if they wrote any.
   * Reddit is asked first, on the tap itself, whether the player lets the app comment as them.
   * Only a comment that went up takes the offer away.
   */
  const onBrag = React.useCallback(
    (event: Event, note?: string) => {
      void (async () => {
        setIsPosting(true);
        if (!(await mayActAsUser(event))) {
          setIsPosting(false);
          tellAsUser('Not posted', false);
          return;
        }
        const r = await relay.brag(note?.trim() ? note : undefined);
        setIsPosting(false);
        if (!r.ok) {
          tellAsUser(r.message ?? 'Could not post that', false);
          return;
        }
        setBragDismissed(true);
        Telemetry.did('brag_posted', 'fell');
        // A day posted may have earned a stone, which the player's towers on the map now wear.
        const earned = r.unlocked?.[r.unlocked.length - 1];
        if (earned) AudioPlayer.playUnlock();
        tellAsUser(
          earned
            ? `Posted · ${stoneOf(earned).name} unlocked`
            : r.topLevel
              ? 'Posted in the thread'
              : 'Posted under Scores',
          true
        );
      })();
    },
    [relay, tellAsUser]
  );

  const [subscribing, setSubscribing] = React.useState(false);
  /**
   * Subscribe to the subreddit, for more lives a day. Reddit is asked first, on the tap itself,
   * whether the player lets the app act as them. A player it brings back in is shown so, and
   * takes their seat with the next tap: the subscription does nothing but subscribe.
   */
  const onSubscribe = React.useCallback(
    (event: Event) => {
      void (async () => {
        setSubscribing(true);
        if (!(await mayActAsUser(event))) {
          setSubscribing(false);
          tellAsUser('Not subscribed', false);
          return;
        }
        const r = await relay.subscribe();
        setSubscribing(false);
        if (!r.success) {
          tellAsUser(r.message ?? 'Could not subscribe', false);
          return;
        }
        Telemetry.did('relay_subscribe', r.back ? 'back' : 'subscribed');
        AudioPlayer.playUnlock();
        tellAsUser(`Subscribed · ${moreLives()}`, true);
      })();
    },
    [relay, tellAsUser]
  );

  /**
   * What the waiting view shows of a tall tower, the player's pick, kept on this device: a
   * convenience, so a page that cannot keep it just opens on the top.
   */
  const [towerView, setTowerView] = React.useState<TowerView>(() => {
    try {
      return window.localStorage.getItem(VIEW_KEY) === 'whole' ? 'whole' : 'top';
    } catch {
      return 'top';
    }
  });
  const pickTowerView = React.useCallback((view: TowerView) => {
    setTowerView(view);
    try {
      window.localStorage.setItem(VIEW_KEY, view);
    } catch {
      // Not kept; it is still the view for now.
    }
  }, []);
  const waiting = !!state && (!mine || turn.done);
  const viewChoice = waiting && (turn.gameState?.blocks.length ?? 0) > OVERVIEW_RECENT;

  /**
   * The tower's best turns marked on it: the top few, and the viewer's own whatever its rank, so
   * they can find their part in it (relay/TowerHonours.tsx).
   */
  const honours = React.useMemo((): Honour[] => {
    const best = state?.best ?? [];
    const myId = state?.me?.userId ?? null;
    return best
      .map((b, i) => ({
        userId: b.userId,
        name: b.username,
        avatar: b.snoovatar,
        from: b.from,
        to: b.to,
        laid: b.laid,
        streak: b.streak,
        rank: i + 1,
        mine: b.userId === myId,
      }))
      .filter((h) => h.rank <= RELAY.MARKED || h.mine);
  }, [state?.best, state?.me?.userId]);
  const towerColour = state?.towers.find((t) => t.id === state.tower)?.faction ?? null;

  /** The player's own blocks on the tower on screen, as runs, for lighting them up. */
  const myRuns = React.useMemo(
    () => (state ? (state.me?.runs?.[String(state.tower)] ?? null) : null),
    [state]
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
    // A colour's tower takes its own colour: from anybody else's, the seat is back at yours.
    if (state.rules === 'factions') {
      const mine = state.me?.faction;
      const here = state.towers.find((t) => t.id === state.tower)?.faction;
      return !mine || here === mine ? 'Take a seat' : `Build for ${factionName(mine)}`;
    }
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
        dpr={canvasDpr(settings.quality)}
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
            liveState={turn.liveState}
            playerColorTheme={theme}
            originX={origin.x}
            originZ={origin.z}
            paletteByIndex={palette}
            activeBlockColor={theme.accentHex}
            extraDebris={falling}
            impulse={impulse}
            // A streak is one turn's: the next player's first perfect is a Flush, not a Plumb.
            streakKey={state.turn ? `${state.turn.userId}:${state.turn.startedAt}` : 'none'}
            trunk
            // The whole tower while the turn is anyone else's, with the player's own blocks lit;
            // their own turn dives back to the top, from the beat before it begins.
            overview={!mine || turn.done}
            overviewView={towerView}
            lit={myRuns}
            honours={honours}
            honourColour={factionRgb(towerColour ?? state.me?.faction ?? null)}
          />
        )}
        {state && (
          <RelayNeighbours
            towers={state.towers}
            focus={state.tower}
            origin={origin}
            onPick={seated ? undefined : (n) => relay.watch(n)}
            tags={!mine || turn.done}
          />
        )}
      </Canvas>

      {state && (
        <RelayHud
          state={state}
          myUserId={myUserId}
          serverNow={relay.serverNow}
          burst={turn.burst}
          height={turn.gameState?.blocks.length ?? state.blocks.length}
          lastLanding={turn.lastLanding}
          isPosting={isPosting}
          notify={notify.on}
          onToggleNotify={toggleNotify}
          onBrag={onBrag}
          asUserResult={asUserResult}
          // After the fall has had the middle of the frame: its caption sits where the quote does.
          showBrag={!past && !!state.me?.out && !bragDismissed && fall === null}
          myUsername={state.me?.username ?? context?.username ?? null}
          onMap={mapPostId ? () => openPost(mapPostId) : null}
          // Out for the day and not a subscriber yet, once the fall has had the middle of the frame.
          onSubscribe={
            !past && !state.closed && !!state.me?.out && !state.me.extra && fall === null
              ? onSubscribe
              : null
          }
          subscribing={subscribing}
          subreddit={context?.subredditName ?? 'stonefall'}
          onJoin={canJoin ? () => (signedIn ? void onJoin() : askToSignIn()) : null}
          joinLabel={signedIn ? joinLabel : 'Sign in to play'}
          joining={joining}
          past={past}
          onWatch={seated ? null : (n) => relay.watch(n)}
          leaving={leaving}
          notice={notice}
          hushed={fall !== null}
          towerView={viewChoice ? towerView : null}
          onTowerView={pickTowerView}
          turnXp={
            relay.earned && relay.earned.turn === (turn.burst?.startedAt ?? state.turn?.startedAt)
              ? relay.earned.xp
              : 0
          }
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
