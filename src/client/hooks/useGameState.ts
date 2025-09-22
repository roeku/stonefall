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

  // Settings
  gameMode: GameMode;
  setGameMode: (mode: GameMode) => void;

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

  // Refs for game loop
  const gameSimulationRef = useRef<GameSimulation | null>(null);
  const animationFrameRef = useRef<number | undefined>(undefined);
  const lastTimeRef = useRef<number>(0);
  const tickAccumulatorRef = useRef<number>(0);

  const TICK_DURATION = 1000 / 60; // 60 FPS

  // Game loop using requestAnimationFrame
  const gameLoop = useCallback(
    (timestamp: number) => {
      if (!isPlaying || isPaused || !gameSimulationRef.current || !gameState) {
        return;
      }

      const deltaTime = timestamp - lastTimeRef.current;
      lastTimeRef.current = timestamp;

      tickAccumulatorRef.current += deltaTime * timeScale; // Apply time scaling

      // Process accumulated ticks. Use a local tick counter derived from gameState to avoid
      // stale closure issues with `currentTick` state in the hook dependencies.
      let localTick = gameState.tick;

      while (tickAccumulatorRef.current >= TICK_DURATION) {
        tickAccumulatorRef.current -= TICK_DURATION;

        const nextTick = localTick + 1;

        // Find input scheduled for the next tick
        const input = inputs.find((inp) => inp.tick === nextTick);

        // Step simulation for the next tick
        const newState = gameSimulationRef.current.stepSimulation(gameState, input);

        // Update localTick and state references for next iteration
        localTick = nextTick;
        setGameState(newState);
        setCurrentTick(nextTick);

        // Check for game over
        if (newState.isGameOver) {
          setIsPlaying(false);
          console.log('Game Over! Final Score:', newState.score);
          return;
        }
      }

      // Continue the loop
      animationFrameRef.current = requestAnimationFrame(gameLoop);
    },
    [isPlaying, isPaused, gameState, inputs, timeScale]
  );

  // Start the game loop
  useEffect(() => {
    if (isPlaying && !isPaused) {
      lastTimeRef.current = performance.now();
      animationFrameRef.current = requestAnimationFrame(gameLoop);
    } else {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isPlaying, isPaused, gameLoop]);

  const startGame = useCallback((mode: GameMode = 'rotating_block', seed?: number) => {
    const gameSeed = seed ?? Math.floor(Math.random() * 1000000);
    const simulation = new GameSimulation(gameSeed, mode);
    const initialState = simulation.createInitialState();

    gameSimulationRef.current = simulation;
    setGameState(initialState);
    setGameMode(mode);
    setInputs([]);
    setCurrentTick(0);
    setIsPlaying(true);
    setIsPaused(false);
    tickAccumulatorRef.current = 0;

    console.log('Game started with seed:', gameSeed, 'mode:', mode);
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
    const baseTick = gameState ? gameState.tick : currentTick;
    const dropInput: DropInput = { tick: baseTick + 1 };
    setInputs((prev) => [...prev, dropInput]);

    console.log('Drop input registered for tick:', dropInput.tick);
  }, [isPlaying, isPaused, gameState, currentTick]);

  const resetGame = useCallback(() => {
    setIsPlaying(false);
    setIsPaused(false);
    setGameState(null);
    setInputs([]);
    setCurrentTick(0);
    gameSimulationRef.current = null;
    tickAccumulatorRef.current = 0;

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
      canvasEl.addEventListener('pointerdown', handlePointerDown, { passive: false } as AddEventListenerOptions);
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
    inputs,
    currentTick,
  };
};
