import { useState, useCallback, useEffect, useRef } from 'react';
import { GameSimulation, GameState, DropInput, GameMode } from '../../shared/simulation';

export interface GameStateHook {
  // Core game state
  gameState: GameState | null;
  isPlaying: boolean;
  isPaused: boolean;

  // Game controls
  startGame: (mode?: GameMode, seed?: number) => void;
  pauseGame: () => void;
  resumeGame: () => void;
  dropBlock: () => void;
  resetGame: () => void;

  // Time scaling for effects
  setTimeScale: (scale: number) => void;

  // Movement tuning (runtime adjustable)
  slideSpeed: number;
  setSlideSpeed: (s: number) => void;
  slideBounds: number;
  setSlideBounds: (b: number) => void;
  slideAccel: number;
  setSlideAccel: (a: number) => void;
  // Fall tuning
  fallSpeedMult: number;
  setFallSpeedMult: (m: number) => void;
  // Instant-place main block (trim pieces still fall)
  instantPlaceMain: boolean;
  setInstantPlaceMain: (v: boolean) => void;

  // Grid tuning (runtime adjustable)
  gridSize: number;
  setGridSize: (s: number) => void;
  gridOffsetX: number;
  setGridOffsetX: (x: number) => void;
  gridOffsetZ: number;
  setGridOffsetZ: (z: number) => void;
  gridLineWidth: number;
  setGridLineWidth: (w: number) => void;

  // Settings
  gameMode: GameMode;
  setGameMode: (mode: GameMode) => void;

  // Debug helper to read current moving block slide speed from the simulation
  getCurrentSlideSpeed?: () => number | null;

  // Replay data
  inputs: DropInput[];
  currentTick: number;
}

export const useGameState = (): GameStateHook => {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [gameMode, setGameMode] = useState<GameMode>('rotating_block');
  const [inputs, setInputs] = useState<DropInput[]>([]);
  const [currentTick, setCurrentTick] = useState(0);
  const [timeScale, setTimeScale] = useState(1.0);
  const [slideSpeed, setSlideSpeed] = useState<number>(1000);
  const [slideBounds, setSlideBounds] = useState<number>(8000);
  const [slideAccel, setSlideAccel] = useState<number>(100);
  const [fallSpeedMult, setFallSpeedMult] = useState<number>(10);
  const [instantPlaceMain, setInstantPlaceMain] = useState<boolean>(true);

  // Grid debug controls - optimized default values
  const [gridSize, setGridSize] = useState<number>(8.0);
  const [gridOffsetX, setGridOffsetX] = useState<number>(0.0);
  const [gridOffsetZ, setGridOffsetZ] = useState<number>(0.0);
  const [gridLineWidth, setGridLineWidth] = useState<number>(3.0);

  // Refs for game loop
  const gameSimulationRef = useRef<GameSimulation | null>(null);
  const animationFrameRef = useRef<number | undefined>(undefined);
  const lastTimeRef = useRef<number>(0);
  const tickAccumulatorRef = useRef<number>(0);

  const TICK_DURATION = 1000 / 60; // 60 FPS
  const debugEnabled = () =>
    typeof globalThis !== 'undefined' && !!(globalThis as any).__DEBUG_DROP;

  // Ensure the global debug flag defaults to true so logs are active without manual toggling
  try {
    const g = globalThis as any;
    if (typeof g.__DEBUG_DROP === 'undefined') {
      g.__DEBUG_DROP = true;
      if (typeof console !== 'undefined')
        console.info('[DEBUG] Global __DEBUG_DROP defaulted to true');
    }
  } catch (e) {
    // ignore
  }

  const pushDebugEvent = (msg: string, meta?: any) => {
    try {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const ev = { ts: now, msg, meta } as any;
      const g = globalThis as any;
      if (!g.__DEBUG_EVENTS || !Array.isArray(g.__DEBUG_EVENTS)) g.__DEBUG_EVENTS = [];
      g.__DEBUG_EVENTS.push(ev);
      if (g.__DEBUG_EVENTS.length > 500) g.__DEBUG_EVENTS.shift();
      if (debugEnabled()) {
      } // console.log('[DBG]', ev.msg, ev.meta ?? '');
    } catch (e) {
      // swallow
    }
  };

  // Game loop using requestAnimationFrame
  const gameLoop = useCallback(
    (timestamp: number) => {
      if (!isPlaying || isPaused || !gameSimulationRef.current || !gameState) {
        return;
      }

      const rafStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
      // Always record RAF tick start to the debug buffer; console output is still gated.
      pushDebugEvent('RAF tick start', { gameTick: gameState.tick, ts: rafStart });
      if (debugEnabled()) {
      }
      // console.log('[DEBUG] RAF tick start', { ts: rafStart, gameTick: gameState.tick });

      const deltaTime = timestamp - lastTimeRef.current;
      lastTimeRef.current = timestamp;

      tickAccumulatorRef.current += deltaTime * timeScale; // Apply time scaling

      // Process accumulated ticks. Use a local mutable state to avoid stale closure issues
      // and ensure stepSimulation receives the most recently-updated state.
      let localTick = gameState.tick;
      let localState = gameState;

      while (tickAccumulatorRef.current >= TICK_DURATION) {
        tickAccumulatorRef.current -= TICK_DURATION;

        const nextTick = localTick + 1;

        // Find input scheduled for the next tick
        const input = inputs.find((inp) => inp.tick === nextTick);
        // Reduce debug event frequency for performance
        if (nextTick % 10 === 0) {
          // Only log every 10th tick
          pushDebugEvent('processing nextTick', {
            nextTick,
            accumMs: tickAccumulatorRef.current,
            hasInput: !!input,
          });
        }

        // Step simulation for the next tick using the up-to-date localState
        const simStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const newState = gameSimulationRef.current.stepSimulation(localState, input);
        const simEnd = typeof performance !== 'undefined' ? performance.now() : Date.now();
        // Only log slow simulations to reduce overhead
        if (simEnd - simStart > 5) {
          pushDebugEvent('stepSimulation duration', {
            nextTick,
            durationMs: simEnd - simStart,
            simStart,
            simEnd,
          });
        }

        // Update localTick and localState for next iteration
        localTick = nextTick;
        localState = newState;
        setCurrentTick(nextTick);

        // Check for game over
        if (newState.isGameOver) {
          console.log(
            'Game Over detected at tick:',
            nextTick,
            'Score:',
            newState.score,
            'Blocks:',
            newState.blocks.length
          );
          setIsPlaying(false);
          setGameState(newState);
          return;
        }
      }

      // Commit the accumulated state updates once per frame
      // Always record commit events; console log only if enabled
      const commitStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
      pushDebugEvent('committing state', { tick: localState.tick, commitStart });
      if (debugEnabled())
        // console.log('[DEBUG] committing state for tick', localState.tick, 'at', commitStart);
        setGameState(localState);
      const commitEnd = typeof performance !== 'undefined' ? performance.now() : Date.now();
      pushDebugEvent('setGameState duration', {
        tick: localState.tick,
        durationMs: commitEnd - commitStart,
        commitStart,
        commitEnd,
      });
      if (debugEnabled())
        //  console.log(
        //   '[DEBUG] setGameState',
        //   localState.tick,
        //   'took',
        //   (commitEnd - commitStart).toFixed(2),
        //   'ms'
        // );

        // Prune inputs that are in the past (already processed)
        setInputs((prev) => prev.filter((inp) => inp.tick > localTick));

      const rafEnd = typeof performance !== 'undefined' ? performance.now() : Date.now();
      pushDebugEvent('RAF tick end', {
        gameTick: localState.tick,
        durationMs: rafEnd - rafStart,
        rafStart,
        rafEnd,
      });
      if (debugEnabled())
        // console.log('[DEBUG] RAF tick end', {
        //   tick: localState.tick,
        //   durationMs: (rafEnd - rafStart).toFixed(2),
        // });

        // Continue the loop
        animationFrameRef.current = requestAnimationFrame(gameLoop);
    },
    [isPlaying, isPaused, gameState, inputs, timeScale]
  );

  // Start the game loop
  useEffect(() => {
    // Ensure any previously scheduled RAF is cancelled before scheduling a new one.
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = undefined;
    }

    if (isPlaying && !isPaused) {
      lastTimeRef.current = performance.now();
      animationFrameRef.current = requestAnimationFrame(gameLoop);
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isPlaying, isPaused, gameLoop]);

  // Sync runtime tuning values to the live GameSimulation instance
  useEffect(() => {
    if (gameSimulationRef.current) {
      try {
        (gameSimulationRef.current as any).setSlideSpeedMultiplier?.(slideSpeed);
        (gameSimulationRef.current as any).setSlideBounds?.(slideBounds);
        (gameSimulationRef.current as any).setFallSpeedMultiplier?.(fallSpeedMult);
        (gameSimulationRef.current as any).setInstantPlaceMain?.(instantPlaceMain);
        (gameSimulationRef.current as any).setSlideAcceleration?.(slideAccel);
      } catch (e) {
        // ignore
      }
    }
  }, [slideSpeed, slideBounds, fallSpeedMult, instantPlaceMain, slideAccel]);

  const startGame = useCallback((mode: GameMode = 'rotating_block', seed?: number) => {
    try {
      (globalThis as any).__REQUEST_NEW_GAME = () => startGame(mode);
    } catch {}
    const gameSeed = seed ?? Math.floor(Math.random() * 1000000);
    const simulation = new GameSimulation(gameSeed, mode);
    let initialState = simulation.createInitialState();

    gameSimulationRef.current = simulation;
    // Apply runtime slide overrides from current hook state
    try {
      (gameSimulationRef.current as any).setSlideSpeedMultiplier?.(slideSpeed ?? 1000);
      (gameSimulationRef.current as any).setSlideBounds?.(
        slideBounds ?? simulation['config'].SLIDE_BOUNDS
      );
      // Ensure instant placement is enabled during seeding to build the initial stack rapidly
      (gameSimulationRef.current as any).setInstantPlaceMain?.(true);
      // Default to zero offset before seeding
      (gameSimulationRef.current as any).setSpeedCountOffset?.(0);
    } catch (e) {
      // ignore if methods not present
    }
    // Temporarily disable seeding to debug immediate game over issue
    // TODO: Re-enable seeding once the core gameplay is working
    try {
      // Apply runtime settings without seeding
      (gameSimulationRef.current as any).setInstantPlaceMain?.(instantPlaceMain);
      (gameSimulationRef.current as any).setSpeedCountOffset?.(0);
      (gameSimulationRef.current as any).gameState = initialState;
    } catch (e) {
      // If setup fails for any reason, proceed with the base initial state
    }
    setGameState(initialState);
    setGameMode(mode);
    setInputs([]);
    setCurrentTick(initialState.tick);
    setIsPlaying(true);
    setIsPaused(false);
    tickAccumulatorRef.current = 0;

    // console.log('Game started with seed:', gameSeed, 'mode:', mode);
  }, []);

  const pauseGame = useCallback(() => {
    setIsPaused(true);
  }, []);

  const resumeGame = useCallback(() => {
    setIsPaused(false);
  }, []);

  const dropBlock = useCallback(() => {
    if (!isPlaying || isPaused || !gameState) return;

    // Use authoritative tick from gameState where possible to avoid stale closure
    const baseTick = currentTick;
    const dropInput: DropInput = { tick: baseTick + 1 };

    // If we have a local GameSimulation instance, synchronously step one tick so the
    // drop takes effect immediately (removes perceptible latency). This keeps the
    // simulation authoritative while reducing click->visual delay. If for any reason
    // the simulation isn't available, fall back to optimistic visual marking.
    if (gameSimulationRef.current) {
      try {
        pushDebugEvent('drop sync step start', { dropTick: dropInput.tick });
        const dropSimStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const newState = gameSimulationRef.current.stepSimulation(gameState, dropInput);
        const dropSimEnd = typeof performance !== 'undefined' ? performance.now() : Date.now();
        pushDebugEvent('drop sync step end', {
          returnedTick: newState.tick,
          isFalling: !!newState.currentBlock?.isFalling,
          durationMs: dropSimEnd - dropSimStart,
        });
        pushDebugEvent('drop stepSimulation duration', {
          dropTick: dropInput.tick,
          durationMs: dropSimEnd - dropSimStart,
          dropSimStart,
          dropSimEnd,
        });
        if (debugEnabled())
          // console.log(
          //   '[DEBUG] drop sync step duration',
          //   (dropSimEnd - dropSimStart).toFixed(2),
          //   'ms'
          // );
          setGameState(newState);
        setCurrentTick(newState.tick);

        // Prune any inputs that are now in the past (should be none normally)
        setInputs((prev) => prev.filter((inp) => inp.tick > newState.tick));

        if (newState.isGameOver) {
          setIsPlaying(false);
          // console.log('Game Over! Final Score:', newState.score);
        }
      } catch (err) {
        // If synchronous stepping fails unexpectedly, fallback to enqueue + optimistic visual
        setInputs((prev) => [...prev, dropInput]);
        setGameState((prev) => {
          if (!prev || !prev.currentBlock) return prev;
          const current = {
            ...prev.currentBlock,
            isFalling: true,
            velocityY: prev.currentBlock.velocityY ?? 0,
          };
          return { ...prev, currentBlock: current };
        });
      }
    } else {
      setInputs((prev) => [...prev, dropInput]);
      setGameState((prev) => {
        if (!prev || !prev.currentBlock) return prev;
        const current = {
          ...prev.currentBlock,
          isFalling: true,
          velocityY: prev.currentBlock.velocityY ?? 0,
        };
        return { ...prev, currentBlock: current };
      });
    }

    pushDebugEvent('drop registered', { tick: dropInput.tick });
  }, [isPlaying, isPaused, gameState, currentTick]);

  const resetGame = useCallback(() => {
    setIsPlaying(false);
    setIsPaused(false);
    setGameState(null);
    setInputs([]);
    setCurrentTick(0);
    gameSimulationRef.current = null;
    tickAccumulatorRef.current = 0;
    try {
      (globalThis as any).__PERFECT_COUNT = 0;
      (globalThis as any).__MAX_PERFECT_STREAK = 0;
      (globalThis as any).__MAX_COMBO = 0;
    } catch {}

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
  }, []);

  // Handle keyboard and pointer inputs — attach pointer listener to the canvas element
  useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      if (event.code === 'Space' || event.key === ' ') {
        event.preventDefault();
        dropBlock();
      } else if (event.key === 'p' || event.key === 'P') {
        if (isPlaying) {
          isPaused ? resumeGame() : pauseGame();
        }
      } else if (event.key === 'r' || event.key === 'R') {
        if (!isPlaying) {
          startGame(gameMode);
        }
      }
    };

    // Pointer handler attached directly to the canvas so the whole canvas surface is interactive
    const canvasEl = document.querySelector('[data-game-canvas="true"]') as HTMLElement | null;
    const handlePointerDown = (event: PointerEvent) => {
      // Ensure the pointerdown occurred on the canvas element (or its children)
      const target = event.target as HTMLElement | null;
      if (!canvasEl || !target) return;
      if (!canvasEl.contains(target)) return;

      // Prevent default scrolling/selection behavior and register a drop
      event.preventDefault();
      dropBlock();
    };

    window.addEventListener('keydown', handleKeyPress);
    if (canvasEl) {
      canvasEl.addEventListener('pointerdown', handlePointerDown, {
        passive: false,
      } as AddEventListenerOptions);
    }

    return () => {
      window.removeEventListener('keydown', handleKeyPress);
      if (canvasEl) {
        canvasEl.removeEventListener('pointerdown', handlePointerDown as EventListener);
      }
    };
  }, [dropBlock, isPlaying, isPaused, pauseGame, resumeGame, startGame, gameMode]);

  return {
    gameState,
    isPlaying,
    isPaused,
    startGame,
    pauseGame,
    resumeGame,
    dropBlock,
    resetGame,
    setTimeScale,
    gameMode,
    setGameMode,
    slideSpeed,
    setSlideSpeed,
    slideBounds,
    setSlideBounds,
    fallSpeedMult,
    setFallSpeedMult,
    instantPlaceMain,
    setInstantPlaceMain,
    inputs,
    currentTick,
    getCurrentSlideSpeed: () => {
      try {
        return gameSimulationRef.current
          ? ((gameSimulationRef.current as any).getCurrentBlockSlideSpeed?.() ?? null)
          : null;
      } catch (e) {
        return null;
      }
    },
    slideAccel,
    setSlideAccel,
    gridSize,
    setGridSize,
    gridOffsetX,
    setGridOffsetX,
    gridOffsetZ,
    setGridOffsetZ,
    gridLineWidth,
    setGridLineWidth,
  };
};
