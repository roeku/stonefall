import { useState, useCallback, useEffect, useRef } from 'react';
import { GameState, DropInput, GameMode, createRunSimulation } from '../../shared/simulation';
import { AudioPlayer } from '../components/audio/AudioPlayer';

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

  /** The taps this run recorded. Sent to the server, which replays them to score the run. */
  inputs: DropInput[];
  /** The taps this run recorded. Read at the end of a run, not during render. */
  takeRecordedInputs: () => DropInput[];
  currentTick: number;

  // Time scaling for effects
  setTimeScale: (scale: number) => void;

  // Settings
  gameMode: GameMode;
  setGameMode: (mode: GameMode) => void;
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
  const gameSimulationRef = useRef<ReturnType<typeof createRunSimulation> | null>(null);
  const gameStateRef = useRef<GameState | null>(gameState);
  const inputsRef = useRef<DropInput[]>(inputs);
  const timeScaleRef = useRef<number>(timeScale);

  const recordedInputsRef = useRef<DropInput[]>([]);

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
      const input: DropInput | undefined = currentInputs.find(
        (i: DropInput) => i.tick === currentState.tick + 1
      );

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

  const startGame = useCallback((mode: GameMode = 'rotating_block', seed?: number) => {
    // The seed and the taps are the whole run: the server replays them to score it, so this
    // has to be set up exactly as the replay will be. `createRunSimulation` is that setup, and
    // it is the same function the server calls, which is why this is one line rather than the
    // hand-rolled block of casts and leftover debugging flags it used to be.
    const gameSeed = seed ?? Math.floor(Math.random() * 1000000);
    const simulation = createRunSimulation(gameSeed, mode);
    const initialState = simulation.createInitialState();

    gameSimulationRef.current = simulation;
    recordedInputsRef.current = [];

    setGameState(initialState);
    setGameMode(mode);
    setInputs([]);
    setCurrentTick(initialState.tick);
    setIsPlaying(true);
    setIsPaused(false);
  }, []);

  const pauseGame = useCallback(() => {
    setIsPaused(true);
  }, []);

  const resumeGame = useCallback(() => {
    setIsPaused(false);
  }, []);

  const playingRef = useRef(false);
  const pausedRef = useRef(false);
  useEffect(() => {
    playingRef.current = isPlaying;
    pausedRef.current = isPaused;
  }, [isPlaying, isPaused]);

  /**
   * Drop the block.
   *
   * Reads the tick from the state ref rather than from React state, so this callback is stable
   * for the life of the run. It used to depend on `currentTick`, which changes sixty times a
   * second, so the pointer listener below was detached and re-attached on every frame.
   */
  const dropBlock = useCallback(() => {
    if (!playingRef.current || pausedRef.current || !gameStateRef.current) {
      return;
    }

    const dropInput: DropInput = { tick: gameStateRef.current.tick + 1 };

    // Record input for replay
    recordedInputsRef.current.push(dropInput);

    // If we have a local GameSimulation instance, synchronously step one tick so the
    // drop takes effect immediately (removes perceptible latency). This keeps the
    // simulation authoritative while reducing click->visual delay. If for any reason
    // the simulation isn't available, fall back to optimistic visual marking.
    if (gameSimulationRef.current) {
      try {
        const newState = gameSimulationRef.current.stepSimulation(gameStateRef.current, dropInput);
        // The ref updates first so the frame loop sees the new state on this same frame.
        gameStateRef.current = newState;
        setGameState(newState);
        setCurrentTick(newState.tick);

        // Prune any inputs that are now in the past (should be none normally)
        setInputs((prev) => prev.filter((inp) => inp.tick > newState.tick));

        if (newState.isGameOver) setIsPlaying(false);
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
  }, []);

  const resetGame = useCallback(() => {
    setIsPlaying(false);
    setIsPaused(false);
    setGameState(null);
    setInputs([]);
    setCurrentTick(0);
    gameSimulationRef.current = null;
  }, []);

  // Keyboard and pointer input. The pointer listener is attached to the canvas directly so it
  // fires on press rather than release, and once, because dropBlock is stable.
  useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      if (event.code === 'Space' || event.key === ' ') {
        event.preventDefault();
        AudioPlayer.unlock();
        dropBlock();
      }
    };

    const canvasEl = document.querySelector('[data-game-canvas="true"]') as HTMLElement | null;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!canvasEl || !target) return;
      if (!canvasEl.contains(target)) return;
      // Prevent default scrolling/selection behavior and register a drop. The first press is
      // also the gesture that unlocks audio on phones.
      event.preventDefault();
      AudioPlayer.unlock();
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
  }, [dropBlock]);

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
    inputs,
    currentTick,
    takeRecordedInputs: () => [...recordedInputsRef.current],
  };
};
