import React from 'react';
import { Canvas } from '@react-three/fiber';
import { GameScene } from './components/game/GameScene_Simple';
import { GridScene, GridChrome, type GridTarget } from './components/ui/GridScreen';
import { useGameState } from './hooks/useGameState';
import { useViewState } from './hooks/useViewState';
import { usePlayerGrid } from './hooks/usePlayerGrid';
import { useCommunityGrid } from './hooks/useCommunityGrid';
import { getPlayerColorTheme, PlayerColorChoice } from './constants/playerColors';
import type { TowerMapEntry } from '../shared/types/api';
import { enableServerLogging } from './utils/serverLogger';

enableServerLogging();

/**
 * Stonefall.
 *
 * Deliberately small. The previous shell grew to ~2,000 lines holding a dozen independent view
 * flags, two competing placement systems and several features nobody used, and the result was
 * that changes could be correct, compile, pass tests and still have no visible effect -- because
 * some older path was quietly still in charge.
 *
 * The rule that keeps that from coming back: exactly one system owns each thing. The simulation
 * owns gameplay, the grid owns where towers are, the server owns whether a placement is legal.
 * Anything that needs a second opinion about one of those is a bug.
 *
 * The loop is: build a tower, choose where it goes, look at what everyone has built.
 */
export const App: React.FC = () => {
  const game = useGameState();
  const view = useViewState('grid');
  const playerGrid = usePlayerGrid();
  const community = useCommunityGrid();

  /** The finished tower waiting to be placed. Null at every other moment. */
  const [pendingTower, setPendingTower] = React.useState<TowerMapEntry | null>(null);
  const [isPlacing, setIsPlacing] = React.useState(false);
  /** Cell the player has aimed at. Lifted here because both the scene and the chrome read it. */
  const [target, setTarget] = React.useState<GridTarget | null>(null);
  const [colorChoice] = React.useState<PlayerColorChoice | null>(null);

  const colorTheme = React.useMemo(() => getPlayerColorTheme(colorChoice), [colorChoice]);

  // Load the grid once on mount. The grid is the landing screen, so this is the first thing a
  // player sees.
  React.useEffect(() => {
    void community.refresh();
    void playerGrid.fetchGrid();
    // Intentionally mount-only; refreshes are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startRun = React.useCallback(() => {
    setPendingTower(null);
    game.startGame(game.gameMode ?? 'rotating_block');
    view.goTo('playing');
  }, [game, view]);

  /**
   * A run has ended: save the tower, then hand it to the grid to be placed.
   *
   * No position is assigned here. That was the old behaviour -- a cell was chosen by score rank
   * and persisted before the player was ever asked -- and it is why placement appeared to do
   * nothing. A tower has no position until someone puts it somewhere.
   */
  const finishRun = React.useCallback(async () => {
    const state = game.gameState;
    if (!state) return;

    try {
      const res = await fetch('/api/game/save-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionData: {
            seed: state.seed,
            finalScore: state.score,
            blockCount: state.blocks.length,
            perfectStreakCount: state.perfectBlockCount ?? 0,
            maxCombo: state.maxCombo ?? 0,
            gameMode: game.gameMode,
            startTime: Date.now() - 60_000,
            endTime: Date.now(),
            gameOverReason: 'fall',
            towerBlocks: state.blocks.map((b) => ({
              x: b.x,
              y: b.y,
              z: b.z ?? 0,
              width: b.width,
              height: b.height,
              depth: b.depth ?? b.width,
              rotation: b.rotation ?? 0,
            })),
            playerColorChoice: colorChoice,
          },
          replayData: {
            version: 1,
            seed: state.seed,
            gameMode: game.gameMode,
            inputs: game.recordedInputs,
            finalScore: state.score,
            finalTick: state.tick,
          },
        }),
      });

      if (!res.ok) {
        console.error('[run] Failed to save session:', await res.text());
        view.goTo('grid');
        return;
      }

      const { sessionId } = (await res.json()) as { sessionId: string };
      const { grid } = await playerGrid.fetchGridTowers();

      setPendingTower({
        sessionId,
        userId: '',
        username: '',
        score: state.score,
        blockCount: state.blocks.length,
        perfectStreak: state.perfectBlockCount ?? 0,
        gameMode: game.gameMode,
        timestamp: Date.now(),
        towerBlocks: state.blocks.map((b) => ({
          x: b.x,
          y: b.y,
          z: b.z ?? 0,
          width: b.width,
          height: b.height,
          depth: b.depth ?? b.width,
          rotation: b.rotation ?? 0,
        })),
      });
      void grid;
      view.goTo('grid');
    } catch (e) {
      console.error('[run] Error finishing run:', e);
      view.goTo('grid');
    }
  }, [game, colorChoice, playerGrid, view]);

  // A run ends exactly once, on the transition into game-over.
  const wasGameOver = React.useRef(false);
  React.useEffect(() => {
    const isOver = game.gameState?.isGameOver === true;
    if (isOver && !wasGameOver.current) {
      void finishRun();
    }
    wasGameOver.current = isOver;
  }, [game.gameState?.isGameOver, finishRun]);

  const placeTower = React.useCallback(
    async (gridX: number, gridZ: number) => {
      if (!pendingTower) return;
      setIsPlacing(true);
      try {
        const placed = await playerGrid.placeTower(pendingTower.sessionId, gridX, gridZ);
        if (placed) {
          setPendingTower(null);
          setTarget(null);
          // Re-read from the server rather than patching locally, so what's on screen is what
          // was actually stored.
          await community.refresh();
        }
      } finally {
        setIsPlacing(false);
      }
    },
    [pendingTower, playerGrid, community]
  );

  const isPlaying = view.is('playing');

  return (
    <div
      // No click handler here. useGameState already attaches a `pointerdown` listener to the
      // element marked data-game-canvas, and that is the better path: it fires on press rather
      // than release, and calls preventDefault so a tap cannot also scroll or select. Adding an
      // onClick on top of it meant two systems competing to interpret one tap -- the same
      // duplication that has caused every other problem here.
      //
      // Explicit dimensions rather than utility classes: the Canvas sizes itself to its parent,
      // and a parent with auto height collapses it to a small box in the corner.
      style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', background: '#000814' }}
    >
      {/* A single Canvas for the entire app.
          Previously the grid and the game each owned one, so moving between them destroyed a
          WebGL context and created another; the browser responded by losing the context and the
          game rendered black. Contents swap inside one context instead. */}
      <Canvas
        dpr={[0.6, 1.2]}
        // useGameState finds the play surface by this attribute and attaches its pointerdown
        // handler to it. Without the marker the listener silently never attaches and taps do
        // nothing -- there is no error, the game simply stops responding.
        data-game-canvas="true"
        style={{ position: 'absolute', inset: 0 }}
        camera={{ position: [70, 55, 70], fov: 30, near: 1, far: 3000 }}
        gl={{ antialias: false, alpha: false, powerPreference: 'high-performance' }}
      >
        <color attach="background" args={['#000814']} />

        {isPlaying ? (
          <GameScene
            gameState={game.gameState}
            gameMode={game.gameMode}
            isPlaying={game.isPlaying}
            stepSimulationFrame={() => {
              game.stepSimulationFrame();
            }}
            playerColorTheme={colorTheme}
          />
        ) : (
          <GridScene
            towers={community.towers}
            pendingTower={pendingTower}
            region={playerGrid.region}
            isPlacing={isPlacing}
            target={target}
            onTarget={setTarget}
            onPlace={placeTower}
          />
        )}
      </Canvas>

      {!isPlaying && (
        <GridChrome
          towers={community.towers}
          isLoading={community.isLoading}
          pendingTower={pendingTower}
          region={playerGrid.region}
          isPlacing={isPlacing}
          error={playerGrid.error}
          target={target}
          onSkipPlacement={() => {
            setPendingTower(null);
            setTarget(null);
          }}
          onPlay={startRun}
        />
      )}
    </div>
  );
};
