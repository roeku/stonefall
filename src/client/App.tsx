import React from 'react';
import { Canvas } from '@react-three/fiber';
import { GameUI } from './components/GameUI';
import { useGameState } from './hooks/useGameState';
import { GameScene } from './components/GameScene_Simple';

export const App: React.FC = () => {
  const gameStateHook = useGameState();
  const [isLoading, setIsLoading] = React.useState(true);

  // Hide loading after a brief delay to ensure everything is loaded
  React.useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), 1000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="relative w-full h-screen bg-gradient-to-b from-blue-900 via-slate-900 to-gray-900 overflow-hidden">
      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-blue-900 via-slate-900 to-gray-900 z-10">
          <div className="text-white text-xl">Loading game...</div>
        </div>
      )}

      {/* Three.js Canvas - simplified for performance */}
      <Canvas
        dpr={[1, 1]} // Reduce pixel ratio for performance
        // performance={{ min: 0.5 }} // Allow lower performance for better frame rates
        className="absolute inset-0"
        shadows={true}
        gl={{ antialias: true }}
        data-game-canvas="true"
      >
        <GameScene gameState={gameStateHook.gameState} />
      </Canvas>

      {/* UI Overlay */}
      <GameUI gameState={gameStateHook} />
    </div>
  );
};
