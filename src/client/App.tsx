import React from 'react';
import { Canvas } from '@react-three/fiber';
import { GameScene } from './components/game/GameScene_Simple';
import { BoardScene, type GridTarget } from './components/board/BoardScene';
import { BoardChrome, type BoardHint } from './components/board/BoardChrome';
import { RunHud } from './components/ui/RunHud';
import { useGameState } from './hooks/useGameState';
import { useViewState, type AppView } from './hooks/useViewState';
import { usePlayerGrid } from './hooks/usePlayerGrid';
import { useCommunityGrid } from './hooks/useCommunityGrid';
import { useGridView, type GridScope } from './hooks/useGridView';
import { getPlayerColorTheme, PlayerColorChoice } from './constants/playerColors';
import type { TowerMapEntry } from '../shared/types/api';
import { isGlobalCellInRegion } from '../shared/types/worldGrid';
import { enableServerLogging } from './utils/serverLogger';

enableServerLogging();

/** How long the final score holds on screen before the board takes over. */
const RUN_END_HOLD_MS = 1700;

/** The screen goes dark for this long around a view change, so a swap reads as a cut. */
const VEIL_IN_MS = 220;
const VEIL_OUT_MS = 140;

/**
 * Stonefall.
 *
 * Deliberately small. The previous shell grew to ~2,000 lines holding a dozen independent view
 * flags, two competing placement systems and several features nobody used, and the result was
 * that changes could be correct, compile, pass tests and still have no visible effect -- because
 * some older path was quietly still in charge.
 *
 * The rule that keeps that from coming back: exactly one system owns each thing. The simulation
 * owns gameplay, the board owns where towers are and what the camera looks at, the server owns
 * whether a placement is legal. Anything that needs a second opinion about one of those is a bug.
 *
 * The loop is: build a tower, choose where it stands, look at what everyone has built.
 */
export const App: React.FC = () => {
  const game = useGameState();
  const view = useViewState('grid');
  const playerGrid = usePlayerGrid();
  const community = useCommunityGrid();
  // Camera state lives here because both the scene and the chrome need it: one turns it into a
  // camera, the other draws the buttons that change it.
  const gridView = useGridView('mine');

  /** The finished tower waiting to be placed. Null at every other moment. */
  const [pendingTower, setPendingTower] = React.useState<TowerMapEntry | null>(null);
  const [isPlacing, setIsPlacing] = React.useState(false);
  /** Cell the player has aimed at. Lifted here because both the scene and the chrome read it. */
  const [target, setTarget] = React.useState<GridTarget | null>(null);
  /** The tower the player tapped to look at. */
  const [selected, setSelected] = React.useState<TowerMapEntry | null>(null);
  const [colorChoice] = React.useState<PlayerColorChoice | null>(null);

  /**
   * One line of transient feedback: a tap outside the plot, a placement that landed.
   *
   * Transient rather than sticky: it answers one moment, and leaving it up would make the next
   * legitimate tap look like it had also failed.
   */
  const [hint, setHint] = React.useState<BoardHint | null>(null);
  const hintTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const hintKey = React.useRef(0);
  const showHint = React.useCallback(
    (text: string, tone: BoardHint['tone'] = 'info', ms = 1700) => {
      hintKey.current += 1;
      setHint({ key: hintKey.current, text, tone });
      if (hintTimer.current) clearTimeout(hintTimer.current);
      hintTimer.current = setTimeout(() => setHint(null), ms);
    },
    []
  );
  React.useEffect(() => () => void (hintTimer.current && clearTimeout(hintTimer.current)), []);

  /**
   * A dark veil over a view change.
   *
   * The board and the game share one Canvas, so switching swaps the scene's contents between
   * two frames. Doing that in the open looks like a glitch; behind a short fade it is a cut.
   */
  const [veiled, setVeiled] = React.useState(false);
  const travel = React.useCallback(
    (to: AppView, then?: () => void) => {
      setVeiled(true);
      setTimeout(() => {
        then?.();
        view.goTo(to);
        setTimeout(() => setVeiled(false), VEIL_OUT_MS);
      }, VEIL_IN_MS);
    },
    [view]
  );

  const colorTheme = React.useMemo(() => getPlayerColorTheme(colorChoice), [colorChoice]);

  // Load the board once on mount. It is the landing screen, so this is the first thing a player
  // sees.
  React.useEffect(() => {
    void community.refresh();
    void playerGrid.fetchGrid();
    // Intentionally mount-only; refreshes are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startRun = React.useCallback(() => {
    setPendingTower(null);
    setSelected(null);
    setTarget(null);
    travel('playing', () => game.startGame(game.gameMode ?? 'rotating_block'));
  }, [game, travel]);

  /**
   * A run has ended: save the tower, then hand it to the board to be placed.
   *
   * No position is assigned here. A tower has no position until someone puts it somewhere. The
   * final score holds on screen for a beat first -- the run deserves a moment before the next
   * question is asked.
   */
  const finishRun = React.useCallback(async () => {
    const state = game.gameState;
    if (!state) return;

    const hold = new Promise<void>((resolve) => setTimeout(resolve, RUN_END_HOLD_MS));
    const blocks = state.blocks.map((b) => ({
      x: b.x,
      y: b.y,
      z: b.z ?? 0,
      width: b.width,
      height: b.height,
      depth: b.depth ?? b.width,
      rotation: b.rotation ?? 0,
    }));

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
            towerBlocks: blocks,
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
        await hold;
        travel('grid', () => showHint('Could not save that run', 'alert', 2600));
        return;
      }

      const [{ sessionId }] = await Promise.all([
        res.json() as Promise<{ sessionId: string }>,
        hold,
      ]);

      setSelected(null);
      setTarget(null);
      gridView.setScope('mine');
      setPendingTower({
        sessionId,
        userId: playerGrid.grid?.userId ?? '',
        username: playerGrid.grid?.username ?? '',
        score: state.score,
        blockCount: state.blocks.length,
        perfectStreak: state.perfectBlockCount ?? 0,
        gameMode: game.gameMode,
        timestamp: Date.now(),
        towerBlocks: blocks,
        playerColorChoice: colorChoice,
      });
      travel('grid');
    } catch (e) {
      console.error('[run] Error finishing run:', e);
      await hold;
      travel('grid', () => showHint('Could not save that run', 'alert', 2600));
    }
  }, [game, colorChoice, playerGrid.grid, gridView, travel, showHint]);

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
          showHint('Standing on your plot', 'good', 2200);
        }
      } finally {
        setIsPlacing(false);
      }
    },
    [pendingTower, playerGrid, community, showHint]
  );

  const setScope = React.useCallback(
    (scope: GridScope) => {
      setSelected(null);
      gridView.setScope(scope);
    },
    [gridView]
  );
  const scopedView = React.useMemo(() => ({ ...gridView, setScope }), [gridView, setScope]);

  const selectTower = React.useCallback(
    (tower: TowerMapEntry | null) => {
      setSelected(tower);
      // The camera fits whatever is selected; a stale zoom would fight that.
      gridView.resetZoom();
    },
    [gridView]
  );

  /**
   * Towers for the current scope.
   *
   * Filtered from the community set by region membership rather than fetched separately: the
   * server has already told us which cells are the player's, so a second endpoint would be a
   * second source of truth for the same question -- and the two could disagree.
   *
   * Placement always shows the player's own plot, whatever the toggle says. You cannot aim at a
   * cell you are not looking at.
   */
  const mine = React.useMemo(() => {
    const region = playerGrid.region;
    if (!region) return [];
    return community.towers.filter(
      (t) =>
        t.gridX !== undefined &&
        t.gridZ !== undefined &&
        isGlobalCellInRegion(region.centerX, region.centerZ, t.gridX, t.gridZ)
    );
  }, [community.towers, playerGrid.region]);

  const onlyMine = gridView.scope === 'mine' || pendingTower !== null;
  const visibleTowers = onlyMine && playerGrid.region ? mine : community.towers;
  const myBest = React.useMemo(() => mine.reduce((best, t) => Math.max(best, t.score), 0), [mine]);
  const myUserId = playerGrid.grid?.userId ?? null;

  const isPlaying = view.is('playing');

  return (
    <div
      // No click handler here. useGameState already attaches a `pointerdown` listener to the
      // element marked data-game-canvas, and that is the better path: it fires on press rather
      // than release, and calls preventDefault so a tap cannot also scroll or select.
      //
      // Explicit dimensions rather than utility classes: the Canvas sizes itself to its parent,
      // and a parent with auto height collapses it to a small box in the corner.
      style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', background: '#000814' }}
    >
      {/* A single Canvas for the entire app.
          Previously the board and the game each owned one, so moving between them destroyed a
          WebGL context and created another; the browser responded by losing the context and the
          game rendered black. Contents swap inside one context instead. */}
      <Canvas
        dpr={[0.7, 1.5]}
        // useGameState finds the play surface by this attribute and attaches its pointerdown
        // handler to it. Without the marker the listener silently never attaches.
        data-game-canvas="true"
        style={{ position: 'absolute', inset: 0 }}
        camera={{ position: [70, 55, 70], fov: 30, near: 1, far: 12000 }}
        gl={{ antialias: false, alpha: false, powerPreference: 'high-performance' }}
        // A tap on nothing -- the sky, past the edge of the floor -- puts the tapped tower down
        // again. Without this, deselecting depended on hitting the ground plane.
        onPointerMissed={() => {
          if (!isPlaying && selected && !pendingTower) selectTower(null);
        }}
      >
        {/* Near-black. The look is black silhouettes plus neon edges: tower bodies are pure
            black with no lights in the scene, so a tower is a hole in space defined by its
            glowing rim, and bloom isolates the neon only because everything else sits far below
            its threshold. */}
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
          <BoardScene
            towers={visibleTowers}
            pendingTower={pendingTower}
            region={playerGrid.region}
            isPlacing={isPlacing}
            target={target}
            onTarget={setTarget}
            onPlace={placeTower}
            onHint={(text) => showHint(text, 'alert')}
            selected={selected}
            onSelect={selectTower}
            view={scopedView}
          />
        )}
      </Canvas>

      {isPlaying && game.gameState && (
        <RunHud
          score={game.gameState.score}
          combo={game.gameState.combo}
          perfectCount={game.gameState.perfectBlockCount}
          blockCount={game.gameState.blocks.length}
          over={game.gameState.isGameOver}
        />
      )}

      {!isPlaying && (
        <BoardChrome
          towers={visibleTowers}
          allTowers={community.towers}
          isLoading={community.isLoading || playerGrid.isLoading}
          pendingTower={pendingTower}
          region={playerGrid.region}
          isPlacing={isPlacing}
          error={playerGrid.error}
          target={target}
          hint={hint}
          view={scopedView}
          selected={selected}
          myUserId={myUserId}
          myBest={myBest}
          onDeselect={() => selectTower(null)}
          onConfirmPlacement={() => {
            if (target) void placeTower(target.x, target.z);
          }}
          onSkipPlacement={() => {
            setPendingTower(null);
            setTarget(null);
          }}
          onPlay={startRun}
        />
      )}

      <div className={`view-veil${veiled ? ' view-veil--on' : ''}`} aria-hidden="true" />
    </div>
  );
};
