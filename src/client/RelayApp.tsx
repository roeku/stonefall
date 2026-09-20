import React from 'react';
import { Canvas } from '@react-three/fiber';
import { context } from '@devvit/web/client';
import { GameScene } from './components/game/GameScene_Simple';
import { RelayHud } from './components/relay/RelayHud';
import { AudioPlayer } from './components/audio/AudioPlayer';
import { useRelay } from './hooks/useRelay';
import { useRelayTurn } from './hooks/useRelayTurn';
import { factionTheme } from './constants/factions';
import { factionHex, factionRgb } from '../shared/types/factions';
import { cellToWorld } from '../shared/types/worldGrid';
import { openPost } from './utils/postLink';
import { enableServerLogging } from './utils/serverLogger';
import { Telemetry } from './utils/telemetry';

enableServerLogging();

/**
 * Stonefall, the relay post.
 *
 * One tower, everyone in the thread, one block each in turn. The scene is the solo run's scene:
 * the same sweep, the same landing, the same fall, because the block is judged by the same
 * simulation. What differs is who is holding the block, and the chrome is about that.
 */
export const RelayApp: React.FC = () => {
  const relay = useRelay();
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
    void fetch('/api/map/latest')
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

  // Your turn: a sound and a buzz, once per turn.
  const announced = React.useRef<number>(0);
  React.useEffect(() => {
    if (!state?.turn || !mine) return;
    if (announced.current === state.turn.startedAt) return;
    announced.current = state.turn.startedAt;
    AudioPlayer.playYourTurn();
    try {
      navigator.vibrate?.([40, 40, 80]);
    } catch {
      // No haptics is fine.
    }
    Telemetry.did('relay_turn');
  }, [state?.turn, mine]);

  // Other people's landings and falls are heard as they arrive. Your own come from the scene.
  const seenEvent = React.useRef<number>(0);
  React.useEffect(() => {
    if (!state) return;
    const last = state.events[state.events.length - 1];
    if (!last || last.at <= seenEvent.current) return;
    const first = seenEvent.current === 0;
    seenEvent.current = last.at;
    if (first) return;
    if (last.username === state.me?.username) return;
    if (last.kind === 'healed') AudioPlayer.playHeal();
    else if (last.kind === 'fell') AudioPlayer.playFall();
    else if (last.kind === 'perfect') AudioPlayer.playPerfectImpact(1, 1);
    else if (last.kind === 'landed') AudioPlayer.playThud(0.45, 70);
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
      e.preventDefault();
      const index = state.turn.index;
      void relay.drop(tick, index).then((res) => {
        if (res.success) Telemetry.did('relay_drop', res.result ?? 'landed');
        else if (res.message) console.warn(`[relay] ${res.message}`);
      });
    },
    [state, turn, relay]
  );

  const onBrag = React.useCallback(async () => {
    setIsPosting(true);
    const r = await relay.brag();
    setIsPosting(false);
    setBragDismissed(true);
    if (r.ok) Telemetry.did('brag_posted', 'fell');
  }, [relay]);

  const palette = React.useMemo(
    () => (state ? state.colors.map((f) => (f ? factionHex(f) : null)) : []),
    [state]
  );
  const theme = React.useMemo(
    () => factionTheme(mine ? (state?.me?.faction ?? null) : (holder?.faction ?? null)),
    [mine, state?.me?.faction, holder?.faction]
  );

  const origin = React.useMemo(() => ({ x: cellToWorld(0), z: cellToWorld(0) }), []);

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
        {turn.gameState && (
          <GameScene
            gameState={turn.gameState}
            gameMode="relay"
            isPlaying={turn.live}
            stepSimulationFrame={turn.stepFrame}
            playerColorTheme={theme}
            originX={origin.x}
            originZ={origin.z}
            paletteByIndex={palette}
            activeBlockColor={theme.accentHex}
          />
        )}
      </Canvas>

      {state && (
        <RelayHud
          state={state}
          myUserId={myUserId}
          serverNow={relay.serverNow}
          myTurnLive={mine && turn.live}
          dropped={turn.dropped}
          muted={muted}
          isPosting={isPosting}
          onToggleMute={toggleMute}
          onBrag={() => void onBrag()}
          onDismissBrag={() => setBragDismissed(true)}
          showBrag={!!state.me?.out && !bragDismissed}
          onMap={mapPostId ? () => openPost(mapPostId) : null}
        />
      )}

      {!state && (
        <div className="relay-empty">
          <span className="ui-label">Relay tower</span>
          <span className="ui-value">{relay.error ?? 'Joining'}</span>
        </div>
      )}
    </div>
  );
};
