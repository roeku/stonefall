import React from 'react';
import { GameStateHook } from '../hooks/useGameState';

interface GameUIProps {
  gameState: GameStateHook;
}

export const GameUI: React.FC<GameUIProps> = ({ gameState }) => {
  const {
    gameState: state,
    isPlaying,
    startGame,
    resetGame,
    dropBlock
  } = gameState;

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

      {/* Drop instruction */}
      <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 pointer-events-auto">
        <button
          onClick={dropBlock}
          className="bg-white/10 hover:bg-white/20 text-white px-6 py-2 rounded-lg backdrop-blur-sm transition-colors"
        >
          DROP
        </button>
      </div>

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
