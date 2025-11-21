import { useState, useCallback, useEffect, useRef } from 'react';
import { GameSimulation, GameState, DropInput, GameMode } from '../../shared/simulation';
import {
  DEFAULT_TOWER_GRID_OFFSET,
  DEFAULT_TOWER_GRID_SIZE,
} from '../../shared/types/towerPlacement';
import { DEFAULT_TOWER_GRID_DENSITY } from '../../shared/constants/towers';

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

  // Simulation stepping (called from useFrame in GameScene)
  stepSimulationFrame: () => GameState | null;

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
  gridDensity: number;
  setGridDensity: (d: number) => void;

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
  const [slideSpeed, setSlideSpeed] = useState<number>(() => {
    return 300;
  });
  const [slideBounds, setSlideBounds] = useState<number>(8000);
  const [slideAccel, setSlideAccel] = useState<number>(50);
  const [fallSpeedMult, setFallSpeedMult] = useState<number>(10);
  const [instantPlaceMain, setInstantPlaceMain] = useState<boolean>(true);

  // Grid debug controls - optimized default values
  const [gridSize, setGridSize] = useState<number>(DEFAULT_TOWER_GRID_SIZE);
  const [gridOffsetX, setGridOffsetX] = useState<number>(DEFAULT_TOWER_GRID_OFFSET);
  const [gridOffsetZ, setGridOffsetZ] = useState<number>(DEFAULT_TOWER_GRID_OFFSET);
  const [gridLineWidth, setGridLineWidth] = useState<number>(3.0);
  const [gridDensity, setGridDensity] = useState<number>(DEFAULT_TOWER_GRID_DENSITY);

  // Refs for game loop
  const gameSimulationRef = useRef<GameSimulation | null>(null);
  const gameStateRef = useRef<GameState | null>(gameState);
  const inputsRef = useRef<DropInput[]>(inputs);
  const timeScaleRef = useRef<number>(timeScale);
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

  // Keep refs synchronized with state
  useEffect(() => {
    gameStateRef.current = gameState;
    inputsRef.current = inputs;
    timeScaleRef.current = timeScale;
  }, [gameState, inputs, timeScale]);

  // Expose simulation stepping for GameScene useFrame to call
  // This ensures simulation and rendering are synchronized on the same frame loop
  const stepSimulationFrame = useCallback(() => {
    const currentState = gameStateRef.current;
    const currentInputs = inputsRef.current;
    const simulation = gameSimulationRef.current;

    if (simulation && currentState && !currentState.isGameOver) {
      // Get input for this tick if any
      const input = currentInputs.find((i) => i.tick === currentState.tick + 1);

      // Step the simulation
      const nextState = simulation.stepSimulation(currentState, input);

      // Update state AND tick counter
      setGameState(nextState);
      setCurrentTick(nextState.tick);

      // Prune inputs that are now in the past
      if (input) {
        setInputs((prev) => prev.filter((inp) => inp.tick > nextState.tick));
      }

      return nextState;
    }

    return currentState;
  }, []);

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

    console.log('🎮 GAME STARTED', {
      seed: gameSeed,
      mode,
      isPlaying: true,
      initialTick: initialState.tick,
    });
  }, []);

  const pauseGame = useCallback(() => {
    setIsPaused(true);
  }, []);

  const resumeGame = useCallback(() => {
    setIsPaused(false);
  }, []);

  const dropBlock = useCallback(() => {
    if (!isPlaying || isPaused || !gameStateRef.current) {
      console.log('🎯 DROP BLOCK REJECTED', {
        isPlaying,
        isPaused,
        hasGameState: !!gameStateRef.current,
      });
      return;
    }

    // Use authoritative tick from gameState where possible to avoid stale closure
    const baseTick = currentTick;
    const dropInput: DropInput = { tick: baseTick + 1 };
    console.log('🎯 DROP BLOCK - Stepping simulation with input', {
      baseTick,
      dropTick: dropInput.tick,
    });

    // If we have a local GameSimulation instance, synchronously step one tick so the
    // drop takes effect immediately (removes perceptible latency). This keeps the
    // simulation authoritative while reducing click->visual delay. If for any reason
    // the simulation isn't available, fall back to optimistic visual marking.
    if (gameSimulationRef.current) {
      try {
        pushDebugEvent('drop sync step start', { dropTick: dropInput.tick });
        const dropSimStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const newState = gameSimulationRef.current.stepSimulation(gameStateRef.current, dropInput);
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

          // Update ref immediately so continuous loop sees the new state
          gameStateRef.current = newState;

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
    try {
      (globalThis as any).__PERFECT_COUNT = 0;
      (globalThis as any).__MAX_PERFECT_STREAK = 0;
      (globalThis as any).__MAX_COMBO = 0;
    } catch {}
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
    stepSimulationFrame,
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
    gridDensity,
    setGridDensity,
  };
};
