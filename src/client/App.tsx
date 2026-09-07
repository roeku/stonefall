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
import { useSocial, type Rival } from './hooks/useSocial';
import type { PlacedRun } from './components/ui/Social';
import type { BragKind, SaveRunResponse } from '../shared/types/api';
import { getPlayerColorTheme, PlayerColorChoice } from './constants/playerColors';
import type { TowerMapEntry } from '../shared/types/api';
import { cellToWorld, isGlobalCellInRegion } from '../shared/types/worldGrid';
import { enableServerLogging } from './utils/serverLogger';
import { Telemetry } from './utils/telemetry';

enableServerLogging();

/**
 * Identifier for one run, made client-side.
 *
 * Its only job is to let a retried save be recognised as the same run rather than stored twice.
 * It carries no authority: the server looks up who is calling and what the inputs actually
 * scored, so a made-up id buys nothing.
 */
const newSessionId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** How long the final score holds on screen before the board takes over. */
const RUN_END_HOLD_MS = 1700;

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
  const social = useSocial();

  /** The finished tower waiting to be placed. Null at every other moment. */
  const [pendingTower, setPendingTower] = React.useState<TowerMapEntry | null>(null);
  const [isPlacing, setIsPlacing] = React.useState(false);
  /** Cell the player has aimed at. Lifted here because both the scene and the chrome read it. */
  const [target, setTarget] = React.useState<GridTarget | null>(null);
  /** The tower the player tapped to look at. */
  const [selected, setSelected] = React.useState<TowerMapEntry | null>(null);
  const [colorChoice] = React.useState<PlayerColorChoice | null>(null);
  /** The run that just went onto the grid, held for one beat so it can be announced. */
  const [placedRun, setPlacedRun] = React.useState<PlacedRun | null>(null);

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
   * Move between the board and a run.
   *
   * This used to black the screen out for 220ms, swap, and fade back, because the swap was a
   * cut: the run slammed the camera to a fixed pose and the board arrived from high above the
   * target, so two unrelated views were stitched together and the veil hid the seam. They are
   * the same place now -- one grid, one lens, and each scene inherits the camera pose the other
   * left -- so the transition is a camera move and covering it up would be hiding the thing
   * worth showing.
   */
  const travel = React.useCallback(
    (to: AppView, then?: () => void) => {
      then?.();
      view.goTo(to);
    },
    [view]
  );

  const colorTheme = React.useMemo(() => getPlayerColorTheme(colorChoice), [colorChoice]);

  // Load the board once on mount. It is the landing screen, so this is the first thing a player
  // sees.
  React.useEffect(() => {
    void community.refresh();
    void playerGrid.fetchGrid();
    void social.refreshFeed();
    // Intentionally mount-only; refreshes are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // app.ready means drawn and touchable, not merely mounted, so it waits for the board's data.
  const readySent = React.useRef(false);
  React.useEffect(() => {
    if (readySent.current || community.isLoading || playerGrid.isLoading) return;
    readySent.current = true;
    Telemetry.appReady();
  }, [community.isLoading, playerGrid.isLoading]);

  const startRun = React.useCallback(() => {
    setPendingTower(null);
    setSelected(null);
    setTarget(null);
    setPlacedRun(null);
    Telemetry.runStarted();
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

    // The request says what was played, never what it was worth: a seed and the taps. The server
    // replays them through the same deterministic simulation and works out the score, the block
    // count and the geometry itself. That is the whole anti-cheat, and it is why there is
    // nothing here to lie about.
    const sessionId = newSessionId();
    try {
      const res = await fetch('/api/game/save-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          seed: state.seed,
          gameMode: game.gameMode,
          inputs: game.takeRecordedInputs(),
          colorChoice,
        }),
      });

      const data = (await res.json()) as SaveRunResponse;
      if (!res.ok || !data.success) {
        await hold;
        travel('grid', () => showHint(data.message ?? 'Could not save that run', 'alert', 2600));
        return;
      }
      await hold;

      setSelected(null);
      setTarget(null);
      gridView.setScope('mine');
      // The server's numbers, not the client's. They agree to a rounding error, and where they
      // do not, the authoritative one is the one that goes on the board.
      setPendingTower({
        sessionId: data.sessionId ?? sessionId,
        userId: playerGrid.grid?.userId ?? '',
        username: playerGrid.grid?.username ?? '',
        score: data.score ?? 0,
        blockCount: data.blockCount ?? 0,
        perfectStreak: data.perfectCount ?? 0,
        gameMode: game.gameMode,
        timestamp: Date.now(),
        towerBlocks: data.towerBlocks ?? [],
        playerColorChoice: colorChoice,
      });
      travel('grid');
    } catch {
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

  // Height milestones, reported as the tower grows rather than at the end, so a run that is
  // never placed still says how far it got.
  React.useEffect(() => {
    // Block count only grows inside a run, and Telemetry.runProgress is idempotent per
    // milestone, so this needs no guard of its own.
    const blocks = game.gameState?.blocks.length ?? 0;
    if (blocks > 1) Telemetry.runProgress(blocks);
  }, [game.gameState?.blocks.length]);


  /**
   * Take somebody's score into a run.
   *
   * Setting the rival and starting immediately, rather than setting it and returning to the
   * board, because the challenge is only interesting while the number is still in the player's
   * head.
   */
  const challenge = React.useCallback(
    (rival: Rival) => {
      social.setRival(rival);
      Telemetry.did('challenge_accepted', String(rival.score));
      startRun();
    },
    [social, startRun]
  );

  const placeTower = React.useCallback(
    async (gridX: number, gridZ: number) => {
      if (!pendingTower) return;
      setIsPlacing(true);
      try {
        const placed = await playerGrid.placeTower(pendingTower.sessionId, gridX, gridZ);
        if (placed) {
          const rival = social.rival;
          const beat = rival && pendingTower.score > rival.score ? rival : undefined;
          setPlacedRun({
            sessionId: pendingTower.sessionId,
            score: pendingTower.score,
            blocks: pendingTower.blockCount,
            perfectStreak: pendingTower.perfectStreak,
            isBest: pendingTower.score > myBestRef.current,
            isFirst: myCountRef.current === 0,
            ...(beat ? { passed: beat } : {}),
          });
          Telemetry.did('tower_placed', `${pendingTower.blockCount}_blocks`);
          Telemetry.runEnded({
            placed: true,
            won: Boolean(beat) || pendingTower.score > myBestRef.current,
            score: pendingTower.score,
          });
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
    [pendingTower, playerGrid, community, social.rival]
  );

  const onBrag = React.useCallback(
    async (kind: BragKind) => {
      if (!placedRun) return;
      const result = await social.brag({
        sessionId: placedRun.sessionId,
        kind,
        score: placedRun.score,
        blocks: placedRun.blocks,
        perfectStreak: placedRun.perfectStreak,
        passedUsername: placedRun.passed?.username,
        passedScore: placedRun.passed?.score,
      });
      setPlacedRun(null);
      if (result.ok) Telemetry.did('brag_posted', kind);
      showHint(
        result.ok ? 'Posted to the thread' : (result.message ?? 'Could not post that'),
        result.ok ? 'good' : 'alert',
        2400
      );
      if (result.ok) social.setRival(null);
    },
    [placedRun, social, showHint]
  );

  const setScope = React.useCallback(
    (scope: GridScope) => {
      setSelected(null);
      Telemetry.did('scope_changed', scope);
      gridView.setScope(scope);
    },
    [gridView]
  );
  const scopedView = React.useMemo(() => ({ ...gridView, setScope }), [gridView, setScope]);

  const selectTower = React.useCallback(
    (tower: TowerMapEntry | null) => {
      if (tower) Telemetry.did('tower_inspected', String(tower.score));
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
  // Read inside placeTower, which is declared above these. Refs rather than dependencies so a
  // placement in flight can't be looking at a stale copy of the plot.
  const myBestRef = React.useRef(0);
  const myCountRef = React.useRef(0);
  React.useEffect(() => {
    myBestRef.current = myBest;
    myCountRef.current = mine.length;
  }, [myBest, mine.length]);
  const myUserId = playerGrid.grid?.userId ?? null;

  const isPlaying = view.is('playing');

  /**
   * Where the run is built, in world space.
   *
   * The player's own plot, so a run happens on the ground it will end up standing on and the
   * camera does not have to travel anywhere when the run finishes. Falls back to cell (0, 0)
   * before the server has said which region is theirs.
   */
  const runOrigin = React.useMemo(() => {
    const region = playerGrid.region;
    return region
      ? { x: cellToWorld(region.centerX), z: cellToWorld(region.centerZ) }
      : { x: cellToWorld(0), z: cellToWorld(0) };
  }, [playerGrid.region]);

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
            originX={runOrigin.x}
            originZ={runOrigin.z}
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
          rival={social.rival}
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
          brags={social.feed}
          placedRun={placedRun}
          isPosting={social.isPosting}
          onChallenge={challenge}
          onBrag={onBrag}
          onDismissBrag={() => setPlacedRun(null)}
          myUserId={myUserId}
          myBest={myBest}
          onDeselect={() => selectTower(null)}
          onConfirmPlacement={() => {
            if (target) void placeTower(target.x, target.z);
          }}
          onSkipPlacement={() => {
            // A run abandoned before placement is the drop-off the dashboard needs to see.
            Telemetry.runEnded({ placed: false, won: false, score: pendingTower?.score ?? 0 });
            setPendingTower(null);
            setTarget(null);
          }}
          onPlay={startRun}
        />
      )}

    </div>
  );
};
