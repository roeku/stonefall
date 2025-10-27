import React from 'react';
import { Canvas } from '@react-three/fiber';
import { GameUI } from './components/GameUI';
import { useGameState } from './hooks/useGameState';
import { GameScene } from './components/GameScene_Simple';
import { useGameData } from './hooks/useGameData';
import { useTowerPreloader } from './hooks/useTowerPreloader';
import { TowerPlacementSystem } from '../shared/types/towerPlacement';
import { ChunkLoadingIndicator } from './components/ChunkLoadingIndicator';
import { TowerInfoPopup } from './components/TowerInfoPopup';
// Performance components disabled for production
// import { PerformanceOptimizer } from './components/PerformanceOptimizer';
// import { PerformanceSettingsUI } from './components/PerformanceConfig';
// import { PerformanceDisplay } from './components/PerformanceDisplay';
import { GameEndModal } from './components/GameEndModal';
//import { TronLoadingScreen } from './components/TronLoadingScreen';



export const App: React.FC = () => {
  const gameStateHook = useGameState();
  const { getGameSession, updateTowerPlacement } = useGameData();

  const [isLoading, setIsLoading] = React.useState(true);
  const [lastSessionId, setLastSessionId] = React.useState<string | null>(null);
  const [playerTower, setPlayerTower] = React.useState<any>(null);
  const [loadingChunks] = React.useState(0);
  const [cameraPos] = React.useState({ x: 0, z: 0 });

  // Tower selection state
  const [selectedTower, setSelectedTower] = React.useState<{ tower: any; rank?: number | undefined } | null>(null);

  // Game end modal state
  const [showGameEndModal, setShowGameEndModal] = React.useState(false);
  const [gameEndData, setGameEndData] = React.useState<{
    rank?: number;
    totalPlayers: number;
    madeTheGrid: boolean;
    scoreToGrid?: number;
    improvement?: {
      lastScore?: number;
      lastBlocks?: number;
      lastPerfectStreak?: number;
    };
  } | null>(null);

  // Confirmation modal state
  const [showConfirmModal, setShowConfirmModal] = React.useState(false);

  // Tower placement system for pre-assignment
  const [placementSystem] = React.useState(() => new TowerPlacementSystem(8, -4, -4));

  // Tower preloader hook
  const towerPreloader = useTowerPreloader(placementSystem);

  // Performance settings UI state - Disabled for production
  // const [showPerformanceSettings, setShowPerformanceSettings] = React.useState(false);

  // Keyboard shortcut handler for performance settings
  // Performance settings keyboard shortcut - Disabled for production
  // React.useEffect(() => {
  //   const handleKeyPress = (event: KeyboardEvent) => {
  //     if (event.key === 'p' || event.key === 'P') {
  //       if (event.ctrlKey || event.metaKey) {
  //         event.preventDefault();
  //         setShowPerformanceSettings(prev => !prev);
  //       }
  //     }
  //   };

  //   window.addEventListener('keydown', handleKeyPress);
  //   return () => window.removeEventListener('keydown', handleKeyPress);
  // }, []);

  // Clear player tower and preloaded towers when starting a new game
  const prevIsPlayingRef = React.useRef(false);
  React.useEffect(() => {
    const isCurrentlyPlaying = gameStateHook.isPlaying && !gameStateHook.gameState?.isGameOver;
    const wasPlaying = prevIsPlayingRef.current;

    // Only clear when we transition from not playing to playing (new game started)
    if (isCurrentlyPlaying && !wasPlaying) {
      console.log('🎮 New game started - clearing player tower and preloaded towers');
      setPlayerTower(null);
      towerPreloader.clearPreloadedTowers();
      setShowGameEndModal(false); // Hide modal when starting new game
      setGameEndData(null); // Clear game end data
    }

    prevIsPlayingRef.current = isCurrentlyPlaying;
  }, [gameStateHook.isPlaying, gameStateHook.gameState?.isGameOver]);

  // Show game end modal when game ends
  React.useEffect(() => {
    if (gameStateHook.gameState?.isGameOver && !showGameEndModal) {
      setShowGameEndModal(true);
    }
  }, [gameStateHook.gameState?.isGameOver, showGameEndModal]);

  // Save game session when game ends and pre-load towers
  React.useEffect(() => {
    if (gameStateHook.gameState?.isGameOver && !playerTower) {
      console.log('🎮 Game over detected, saving session and pre-loading towers...');

      const saveSessionAndPreloadTowers = async () => {
        try {
          // First, pre-load and assign towers (this gives us a smoother transition)
          console.log('🏰 Pre-loading towers before saving session...');
          await towerPreloader.preloadAndAssignTowers();

          const sessionData = {
            finalScore: gameStateHook.gameState!.score,
            blockCount: gameStateHook.gameState!.blocks.length,
            perfectStreakCount: gameStateHook.gameState!.combo,
            gameMode: 'classic' as const,
            startTime: Date.now() - 60000, // Approximate start time
            endTime: Date.now(),
            towerBlocks: gameStateHook.gameState!.blocks.map(block => ({
              x: block.x,
              y: block.y,
              z: block.z || 0,
              width: block.width,
              height: block.height,
              depth: block.depth || block.width,
              rotation: block.rotation || 0,
            })),
          };

          // Save the session using the real API
          const response = await fetch('/api/game/save-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionData }),
          });

          if (response.ok) {
            const result = await response.json();
            console.log('✅ Session saved successfully:', result.sessionId);

            // Store game end data for modal
            setGameEndData({
              rank: result.rank,
              totalPlayers: result.totalPlayers,
              madeTheGrid: result.madeTheGrid,
              scoreToGrid: result.scoreToGrid,
              improvement: result.improvement,
            });

            // Now call handleGameEnd with the real session ID
            await handleGameEnd(result.sessionId);
          } else {
            console.error('❌ Failed to save session:', await response.text());
          }
        } catch (error) {
          console.error('❌ Error saving session or pre-loading towers:', error);
        }
      };

      saveSessionAndPreloadTowers();
    }
  }, [gameStateHook.gameState?.isGameOver, playerTower, gameStateHook.gameState, towerPreloader]);

  // Hide loading after a brief delay to ensure everything is loaded
  React.useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), 2000);
    return () => clearTimeout(timer);
  }, []);

  const handleGameEnd = async (sessionId: string) => {
    setLastSessionId(sessionId);
    console.log('Game completed! Session saved:', sessionId);

    // Get the saved session data to create tower entry
    try {
      const sessionData = await getGameSession(sessionId);
      if (sessionData && gameStateHook.gameState) {
        const towerEntry = {
          sessionId: sessionData.sessionId,
          userId: sessionData.userId,
          username: sessionData.username,
          score: sessionData.finalScore,
          blockCount: sessionData.blockCount,
          perfectStreak: sessionData.perfectStreakCount,
          gameMode: sessionData.gameMode,
          timestamp: sessionData.endTime || sessionData.startTime,
          towerBlocks: sessionData.towerBlocks,
        };

        // Set tower data for in-game display
        setPlayerTower(towerEntry);
      }
    } catch (error) {
      console.error('Failed to load session data:', error);
    }

    // Clear success message after delay
    setTimeout(() => setLastSessionId(null), 3000);
  };

  // Tower selection handlers
  const handleTowerClick = (tower: any, _position: [number, number, number], rank?: number) => {
    console.log('Tower clicked:', tower.username, 'rank:', rank);

    // Toggle behavior - if same tower clicked, deselect it
    if (selectedTower && selectedTower.tower.sessionId === tower.sessionId) {
      console.log('Same tower clicked - deselecting');
      setSelectedTower(null);
    } else {
      console.log('New tower selected');
      setSelectedTower({ tower, rank });
    }
  };

  const handleCloseTowerInfo = () => {
    setSelectedTower(null);
  };

  const handleVisitProfile = (username: string) => {
    console.log('Visit profile:', username);
    // TODO: Implement profile navigation
    setSelectedTower(null);
  };

  // Game end modal handlers
  const handlePlayAgain = () => {
    gameStateHook.resetGame();
    gameStateHook.startGame();
    setShowGameEndModal(false);
  };

  const handleShare = (sessionData: any) => {
    console.log('Sharing session data:', sessionData);
    // TODO: Implement share functionality
  };

  const handleMinimizeModal = () => {
    setShowGameEndModal(false);
  };

  const handleViewTower = () => {
    console.log('🏰 View My Tower clicked - focusing on player tower');
    if (playerTower) {
      // Select the player's tower to trigger camera focus
      setSelectedTower({ tower: playerTower, rank: gameEndData?.rank });
    }
  };

  const handleClearAllData = () => {
    setShowConfirmModal(true);
  };

  const confirmClearAllData = async () => {
    setShowConfirmModal(false);

    try {
      const response = await fetch('/api/game/clear-all', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      });

      if (response.ok) {
        const result = await response.json();
        console.log('✅ All game data cleared successfully:', result.message);

        // Clear all local state for fresh start
        setPlayerTower(null);
        setSelectedTower(null);
        setShowGameEndModal(false);
        setGameEndData(null);
        towerPreloader.clearPreloadedTowers();

        // Reset game state if needed
        if (gameStateHook.gameState?.isGameOver) {
          gameStateHook.resetGame();
        }

        // Show success message (using a simple div instead of alert)
        console.log('🗑️ Complete fresh start! All game data cleared successfully.');
      } else {
        const error = await response.json();
        console.error('❌ Failed to clear all data:', error.message);
      }
    } catch (error) {
      console.error('❌ Error clearing all data:', error);
    }
  };

  const cancelClearAllData = () => {
    setShowConfirmModal(false);
  };

  return (
    <div className="relative w-full h-screen bg-gradient-to-b from-gray-900 via-slate-900 to-black overflow-hidden">
      {/* Tron Loading Screen */}
      {/* <TronLoadingScreen
        isLoading={isLoading}
        progress={isLoading ? 85 : 100}
        message="INITIALIZING GRID"
      /> */}

      {/* Three.js Canvas - render when game is playing OR when game is over (for tower display) */}
      {gameStateHook.gameState && (gameStateHook.isPlaying || gameStateHook.gameState.isGameOver) && (
        <Canvas
          dpr={[0.5, 1]} // Further reduce pixel ratio for better performance
          performance={{ min: 0.3 }} // Allow even lower performance for better frame rates
          className="absolute inset-0"
          shadows={false} // Disable shadows for better performance
          gl={{
            antialias: false,
            powerPreference: "high-performance",
            alpha: false,
            stencil: false,
            depth: true,
            logarithmicDepthBuffer: false,
            precision: "lowp" // Use low precision for better performance
          }}
          data-game-canvas="true"
          frameloop="always" // Keep always for game loop
        >
          {/* PerformanceOptimizer disabled for production */}
          {/* <PerformanceOptimizer
          targetFPS={60}
          onPerformanceChange={(fps, isLow) => {
            if (isLow) {
              console.warn(`⚠️ Performance warning: ${fps}fps`);
            }
          }}
        /> */}
          <GameScene
            gameState={gameStateHook.gameState}
            gridSize={gameStateHook.gridSize}
            gridOffsetX={gameStateHook.gridOffsetX}
            gridOffsetZ={gameStateHook.gridOffsetZ}
            gridLineWidth={gameStateHook.gridLineWidth}
            enableDebugWireframe={false}
            playerTower={playerTower}
            selectedTower={selectedTower?.tower || null}
            onCameraDebugUpdate={() => { }}
            onCameraReady={() => { }}
            onTowerClick={handleTowerClick}
            onTowerPlacementSave={async (sessionId, worldX, worldZ, gridX, gridZ) => {
              await updateTowerPlacement(sessionId, worldX, worldZ, gridX, gridZ);
            }}
            preAssignedTowers={towerPreloader.preAssignedTowers}
            placementSystem={placementSystem}
          />
        </Canvas>
      )}

      {/* Development Clear All Data Button */}
      {(
        <button
          onClick={handleClearAllData}
          className="absolute top-4 right-4 z-50 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200"
          style={{
            background: 'rgba(255, 0, 0, 0.8)',
            color: 'white',
            border: '1px solid rgba(255, 0, 0, 1)',
            backdropFilter: 'blur(10px)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255, 0, 0, 0.9)';
            e.currentTarget.style.transform = 'scale(1.05)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(255, 0, 0, 0.8)';
            e.currentTarget.style.transform = 'scale(1)';
          }}
        >
          🗑️ Fresh Start
        </button>
      )}

      {/* Chunk Loading Indicator */}
      <ChunkLoadingIndicator
        loadingChunks={loadingChunks}
        totalChunks={9} // 3x3 grid around camera
        cameraPosition={cameraPos}
      />

      {/* UI Overlay */}
      {!isLoading && !gameStateHook.gameState?.isGameOver && (
        <>
          {console.log('🎮 App: Rendering GameUI', {
            isLoading,
            isPlaying: gameStateHook.isPlaying,
            hasGameState: !!gameStateHook.gameState,
            isGameOver: gameStateHook.gameState?.isGameOver
          })}
          <GameUI gameState={gameStateHook} />
        </>
      )}



      {/* Success message for completed games */}
      {lastSessionId && (
        <div
          className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 px-6 py-4 rounded-xl text-white font-bold text-lg z-50 pointer-events-none"
          style={{
            background: 'linear-gradient(135deg, rgba(0, 255, 0, 0.9), rgba(0, 200, 0, 0.8))',
            boxShadow: '0 8px 32px rgba(0, 255, 0, 0.3)',
            animation: 'fadeInOut 3s ease-in-out',
          }}
        >
          🎉 Tower Saved! Session: {lastSessionId.slice(-8)}
        </div>
      )}

      {/* CSS for animations */}
      <style>{`
        @keyframes fadeInOut {
          0% { opacity: 0; transform: translate(-50%, -50%) scale(0.8); }
          20% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
          80% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
          100% { opacity: 0; transform: translate(-50%, -50%) scale(0.8); }
        }
      `}</style>

      {/* Tower Info Popup - DOM Overlay */}
      {selectedTower && (
        <TowerInfoPopup
          tower={selectedTower.tower}
          rank={selectedTower.rank}
          playerScore={playerTower?.score || gameStateHook.gameState?.score || 0}
          playerBlocks={playerTower?.blockCount || gameStateHook.gameState?.blocks.length || 0}
          playerStreak={playerTower?.perfectStreak || gameStateHook.gameState?.combo || 0}
          onClose={handleCloseTowerInfo}
          onVisitProfile={handleVisitProfile}
        />
      )}

      {/* Performance Settings UI - Hidden for production */}
      {/* <PerformanceSettingsUI visible={showPerformanceSettings} /> */}
      {/* <PerformanceDisplay /> */}

      {/* Game End Modal - positioned above all other UI elements */}
      <GameEndModal
        isVisible={showGameEndModal}
        gameState={gameStateHook.gameState}
        playerTower={playerTower}
        gameEndData={gameEndData}
        onPlayAgain={handlePlayAgain}
        onShare={handleShare}
        onMinimize={handleMinimizeModal}
        onViewTower={handleViewTower}
      />

      {/* Confirmation Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div
            className="bg-gray-900 border border-red-500 rounded-lg p-6 max-w-md mx-4"
            style={{
              background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.95))',
              backdropFilter: 'blur(10px)',
              boxShadow: '0 8px 32px rgba(255, 0, 0, 0.3)',
            }}
          >
            <h3 className="text-xl font-bold text-red-400 mb-4">⚠️ Confirm Fresh Start</h3>
            <p className="text-gray-300 mb-6">
              This will permanently delete ALL game data including:
              <br />• All towers and leaderboards
              <br />• All user statistics
              <br />• All game sessions
              <br /><br />
              <strong className="text-red-400">This cannot be undone!</strong>
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={cancelClearAllData}
                className="px-4 py-2 rounded bg-gray-600 hover:bg-gray-500 text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmClearAllData}
                className="px-4 py-2 rounded bg-red-600 hover:bg-red-500 text-white transition-colors"
              >
                🗑️ Clear All Data
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Debug Overlays disabled for now to avoid R3F errors */}
      {/* TODO: Add debug overlays outside Canvas context */}
    </div>
  );
};
