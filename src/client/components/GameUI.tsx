import React, { useEffect, useState } from 'react';
import { GameStateHook } from '../hooks/useGameState';

interface GameUIProps {
  gameState: GameStateHook;
}

export const GameUI: React.FC<GameUIProps> = ({ gameState }) => {
  const [showTuning, setShowTuning] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'd' || e.key === 'D') {
        setShowTuning((s) => !s);
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const {
    gameState: state,
    isPlaying,
    startGame,
    resetGame,
    dropBlock
  } = gameState;

  // Extract tuning controls if available
  const slideSpeed = (gameState as any).slideSpeed as number | undefined;
  const setSlideSpeed = (gameState as any).setSlideSpeed as ((s: number) => void) | undefined;
  const slideBounds = (gameState as any).slideBounds as number | undefined;
  const setSlideBounds = (gameState as any).setSlideBounds as ((b: number) => void) | undefined;
  const fallSpeedMult = (gameState as any).fallSpeedMult as number | undefined;
  const setFallSpeedMult = (gameState as any).setFallSpeedMult as ((m: number) => void) | undefined;

  // Just show essential controls
  if (!isPlaying) {
    return (
      <div className="absolute inset-0 flex items-center justify-center z-20">{/* allow pointer events */}
        <div>
          <button
            onClick={() => startGame()}
            className="bg-cyan-500 hover:bg-cyan-400 text-black font-medium px-10 py-4 rounded-lg text-lg transition-colors touch-manipulation"
            style={{ WebkitTapHighlightColor: 'transparent' }}
          >
            Start Game
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 pointer-events-none">
      {/* Minimal score in top-left */}
      <div className="absolute top-4 left-4 text-white text-2xl font-mono">
        {state?.score ?? 0}
      </div>

      {/* Current slide speed in top-center (debug) */}
      <div className="absolute top-4 left-1/2 transform -translate-x-1/2 text-white text-sm font-mono">
        {typeof (gameState as any).getCurrentSlideSpeed === 'function' ? (
          <span>Slide speed: {(gameState as any).getCurrentSlideSpeed() ?? '—'}</span>
        ) : null}
      </div>

      {/* Drop instruction */}
      <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 pointer-events-auto">
        <button
          onClick={dropBlock}
          className="bg-white/10 hover:bg-white/20 text-white px-6 py-2 rounded-lg backdrop-blur-sm transition-colors"
        >
          DROP
        </button>
      </div>

      {/* Runtime tuning controls (hidden by default; toggle with 'D') */}
      {showTuning ? (
        <div className="absolute bottom-20 left-1/2 transform -translate-x-1/2 pointer-events-auto bg-black/30 px-3 py-2 rounded-md">
          {typeof slideSpeed !== 'undefined' && setSlideSpeed ? (
            <div className="text-white text-sm font-mono">
              <label className="block">Slide Speed: {Math.round(slideSpeed)}</label>
              <input
                type="range"
                min={100}
                max={3000}
                value={slideSpeed}
                onChange={(e) => setSlideSpeed(Number(e.target.value))}
              />
            </div>
          ) : null}

          {typeof slideBounds !== 'undefined' && setSlideBounds ? (
            <div className="text-white text-sm font-mono mt-2">
              <label className="block">Slide Bounds: {Math.round((slideBounds ?? 0) / 1000)} units</label>
              <input
                type="range"
                min={1000}
                max={8000}
                value={slideBounds}
                onChange={(e) => setSlideBounds(Number(e.target.value))}
              />
            </div>
          ) : null}

          {typeof fallSpeedMult !== 'undefined' && setFallSpeedMult ? (
            <div className="text-white text-sm font-mono mt-2">
              <label className="block">Fall Speed: {Number(fallSpeedMult).toFixed(2)}x</label>
              <input
                type="range"
                min={0.2}
                max={5}
                step={0.1}
                value={fallSpeedMult}
                onChange={(e) => setFallSpeedMult(Number(e.target.value))}
              />
            </div>
          ) : null}

          {/* Slide acceleration control */}
          {typeof (gameState as any).slideAccel !== 'undefined' && (gameState as any).setSlideAccel ? (
            <div className="text-white text-sm font-mono mt-2">
              <label className="block">Slide Accel: {(gameState as any).slideAccel}</label>
              <input
                type="range"
                min={0}
                max={200}
                step={1}
                value={(gameState as any).slideAccel}
                onChange={(e) => (gameState as any).setSlideAccel?.(Number(e.target.value))}
              />
            </div>
          ) : null}

          {typeof (gameState as any).instantPlaceMain !== 'undefined' && (gameState as any).setInstantPlaceMain ? (
            <div className="text-white text-sm font-mono mt-2">
              <label className="inline-flex items-center">
                <input
                  type="checkbox"
                  checked={(gameState as any).instantPlaceMain}
                  onChange={(e) => (gameState as any).setInstantPlaceMain?.(e.target.checked)}
                  className="mr-2"
                />
                Instant place main block
              </label>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Reset in top-right */}
      <div className="absolute top-4 right-4 pointer-events-auto">
        <button
          onClick={resetGame}
          className="text-white/60 hover:text-white text-sm transition-colors"
        >
          Reset
        </button>
      </div>
    </div>
  );
};
