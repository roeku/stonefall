import { useState, useCallback, useEffect, useRef, type RefObject } from 'react';
import { GameState, DropInput, GameMode, createRunSimulation } from '../../shared/simulation';
import { AudioPlayer } from '../components/audio/AudioPlayer';
import { isInlineOnReddit } from '../utils/platform';
import { needsRender } from './liveState';

export interface GameStateHook {
  // Core game state
  /** The state React draws: updated only when a tick changes what is drawn (see needsRender). */
  gameState: GameState | null;
  /** The state as of the latest tick, for the frame loop. The moving block is read from here. */
  liveState: RefObject<GameState | null>;
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
  /** The tick React last drew. The live one is `liveState.current.tick`. */
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
  const [timeScale, setTimeScale] = useState(1.0);

  // Refs for game loop
  const gameSimulationRef = useRef<ReturnType<typeof createRunSimulation> | null>(null);
  const gameStateRef = useRef<GameState | null>(gameState);
  const inputsRef = useRef<DropInput[]>(inputs);
  const timeScaleRef = useRef<number>(timeScale);

  const recordedInputsRef = useRef<DropInput[]>([]);

  // Keep refs synchronized with state. Not the game state: the frame loop runs ahead of React,
  // so the ref is the newer of the two and is written wherever the state is (see `commit`).
  useEffect(() => {
    inputsRef.current = inputs;
    timeScaleRef.current = timeScale;
  }, [inputs, timeScale]);

  /** Makes `next` the live state, and hands it to React if it changes what is drawn. */
  const commit = useCallback((next: GameState | null, always = false) => {
    const prev = gameStateRef.current;
    gameStateRef.current = next;
    if (always || needsRender(prev, next)) setGameState(next);
  }, []);

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

      // Step the simulation. Most ticks only slide the block, and those stay out of React.
      const nextState = simulation.stepSimulation(currentState, input);
      commit(nextState);

      // Prune inputs that are now in the past
      if (input) {
        setInputs((prev) => prev.filter((inp) => inp.tick > nextState.tick));
      }

      return nextState;
    }

    return currentState;
  }, [commit]);

  const startGame = useCallback(
    (mode: GameMode = 'rotating_block', seed?: number) => {
      // The seed and the taps are the whole run: the server replays them to score it, so this
      // has to be set up exactly as the replay will be. `createRunSimulation` is that setup, and
      // it is the same function the server calls, which is why this is one line rather than the
      // hand-rolled block of casts and leftover debugging flags it used to be.
      const gameSeed = seed ?? Math.floor(Math.random() * 1000000);
      const simulation = createRunSimulation(gameSeed, mode);
      const initialState = simulation.createInitialState();

      gameSimulationRef.current = simulation;
      recordedInputsRef.current = [];

      commit(initialState, true);
      setGameMode(mode);
      setInputs([]);
      setIsPlaying(true);
      setIsPaused(false);
    },
    [commit]
  );

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
        commit(newState, true);

        // Prune any inputs that are now in the past (should be none normally)
        setInputs((prev) => prev.filter((inp) => inp.tick > newState.tick));

        if (newState.isGameOver) setIsPlaying(false);
      } catch (err) {
        // If synchronous stepping fails unexpectedly, fallback to enqueue + optimistic visual
        setInputs((prev) => [...prev, dropInput]);
        commit(markFalling(gameStateRef.current), true);
      }
    } else {
      setInputs((prev) => [...prev, dropInput]);
      commit(markFalling(gameStateRef.current), true);
    }
  }, [commit]);

  const resetGame = useCallback(() => {
    setIsPlaying(false);
    setIsPaused(false);
    commit(null, true);
    setInputs([]);
    gameSimulationRef.current = null;
  }, [commit]);

  // Pointer input, and the space bar where it is allowed. The pointer listener is attached to the
  // canvas directly so it fires on press rather than release, and once, because dropBlock is
  // stable.
  //
  // Nothing here prevents a default. In a post in the feed Devvit allows taps and clicks only:
  // the space bar scrolls the feed and a swipe over the post must too, so the space bar drops a
  // block only outside the feed (the local harness), and a press on the canvas is heard without
  // being taken. Selection and double-tap zoom are already off in CSS.
  useEffect(() => {
    const keys = !isInlineOnReddit();
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
      // The first press is also the gesture that unlocks audio on phones.
      AudioPlayer.unlock();
      dropBlock();
    };

    if (keys) window.addEventListener('keydown', handleKeyPress);
    canvasEl?.addEventListener('pointerdown', handlePointerDown);

    return () => {
      if (keys) window.removeEventListener('keydown', handleKeyPress);
      canvasEl?.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [dropBlock]);

  return {
    gameState,
    liveState: gameStateRef,
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
    currentTick: gameState?.tick ?? 0,
    takeRecordedInputs: () => [...recordedInputsRef.current],
  };
};

/** The optimistic drop, for when the simulation cannot step: the block starts falling. */
const markFalling = (state: GameState | null): GameState | null => {
  if (!state || !state.currentBlock) return state;
  const current = {
    ...state.currentBlock,
    isFalling: true,
    velocityY: state.currentBlock.velocityY ?? 0,
  };
  return { ...state, currentBlock: current };
};
