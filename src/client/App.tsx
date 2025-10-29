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
import { GameEndModal, ShareSessionPayload } from './components/GameEndModal';
import type { ShareSessionResponse } from '../shared/types/api';
import { GridReviewOverlay } from './components/GridReviewOverlay';
//import { TronLoadingScreen } from './components/TronLoadingScreen';

// Toggle to true to inspect App re-render frequency during development.
const DEBUG_APP_RENDER = false;


type ShareFeedbackTone = 'success' | 'error' | 'info';

interface ShareFeedbackState {
  message: string;
  tone: ShareFeedbackTone;
}


export const App: React.FC = () => {
  const gameStateHook = useGameState();
  const { startGame: startGameHook, resetGame: resetGameHook, gameMode } = gameStateHook;
  const { getGameSession, updateTowerPlacement } = useGameData();

  const [isLoading, setIsLoading] = React.useState(true);
  const [lastSessionId, setLastSessionId] = React.useState<string | null>(null);
  const [playerTower, setPlayerTower] = React.useState<any>(null);
  const [loadingChunks] = React.useState(0);
  const [cameraPos] = React.useState({ x: 0, z: 0 });
  const [isSharing, setIsSharing] = React.useState(false);
  const [shareFeedback, setShareFeedback] = React.useState<ShareFeedbackState | null>(null);
  const shareFeedbackTimeoutRef = React.useRef<number | null>(null);
  const devToolsEnabled =
    typeof import.meta !== 'undefined' && Boolean((import.meta as any).env?.DEV);
  const [hasSharedSuccessfully, setHasSharedSuccessfully] = React.useState(false);
  const [canvasDpr, setCanvasDpr] = React.useState<[number, number]>(() => {
    if (typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent || '')) {
      return [0.32, 0.68];
    }
    return [0.5, 1];
  });

  const clearShareFeedback = React.useCallback(() => {
    if (shareFeedbackTimeoutRef.current !== null) {
      window.clearTimeout(shareFeedbackTimeoutRef.current);
      shareFeedbackTimeoutRef.current = null;
    }
  }, []);

  const showShareFeedback = React.useCallback(
    (message: string, tone: ShareFeedbackTone) => {
      clearShareFeedback();
      setShareFeedback({ message, tone });
      shareFeedbackTimeoutRef.current = window.setTimeout(() => {
        setShareFeedback(null);
        shareFeedbackTimeoutRef.current = null;
      }, 4000);
    },
    [clearShareFeedback]
  );

  React.useEffect(() => {
    return () => {
      if (shareFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(shareFeedbackTimeoutRef.current);
      }
    };
  }, []);

  const copyShareTextToClipboard = React.useCallback(async (content: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(content);
      return;
    }

    if (typeof document === 'undefined') {
      throw new Error('Clipboard API not available in this context');
    }

    const textarea = document.createElement('textarea');
    textarea.value = content;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'absolute';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);

    const selection = document.getSelection();
    const selectedRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);

    const successful = document.execCommand('copy');
    document.body.removeChild(textarea);

    if (selectedRange && selection) {
      selection.removeAllRanges();
      selection.addRange(selectedRange);
    }

    if (!successful) {
      throw new Error('Unable to copy text to clipboard');
    }
  }, []);

  React.useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const isAndroid = typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent || '');
    if (!isAndroid) {
      return;
    }

    const updateCanvasDpr = () => {
      const deviceRatio = window.devicePixelRatio || 1;
      const maxDpr = Math.min(0.72, Math.max(0.55, deviceRatio * 0.7));
      const minDpr = Math.max(0.28, Math.min(0.42, maxDpr * 0.6));
      setCanvasDpr([Number(minDpr.toFixed(2)), Number(maxDpr.toFixed(2))]);
    };

    updateCanvasDpr();
    window.addEventListener('resize', updateCanvasDpr);
    window.addEventListener('orientationchange', updateCanvasDpr);
    return () => {
      window.removeEventListener('resize', updateCanvasDpr);
      window.removeEventListener('orientationchange', updateCanvasDpr);
    };
  }, []);

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
      lastPerfectStreak?: number; // Previous total perfect block placements
    };
    personalBest?: boolean;
    bestScore?: number;
    previousBestScore?: number;
    bestSessionId?: string;
    bestPerfectStreak?: number;
    previousBestPerfectStreak?: number;
    personalBestPerfectStreak?: boolean;
  } | null>(null);

  // Confirmation modal state
  const [showConfirmModal, setShowConfirmModal] = React.useState(false);

  // Start-screen grid review state
  const [isGridReviewOpen, setIsGridReviewOpen] = React.useState(false);

  // Tower placement system for pre-assignment
  const [placementSystem] = React.useState(() => new TowerPlacementSystem(8, -4, -4));

  // Tower preloader hook
  const towerPreloader = useTowerPreloader(placementSystem);
  const {
    preAssignedTowers,
    isLoading: isTowerReviewLoading,
    error: towerReviewError,
    preloadAndAssignTowers,
    clearPreloadedTowers,
  } = towerPreloader;

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
      clearPreloadedTowers();
      setShowGameEndModal(false); // Hide modal when starting new game
      setGameEndData(null); // Clear game end data
      setHasSharedSuccessfully(false);
    }

    prevIsPlayingRef.current = isCurrentlyPlaying;
  }, [gameStateHook.isPlaying, gameStateHook.gameState?.isGameOver, clearPreloadedTowers]);

  // Show game end modal when game ends
  React.useEffect(() => {
    if (gameStateHook.gameState?.isGameOver && !showGameEndModal) {
      setSelectedTower(null);
      setShowGameEndModal(true);
    }
  }, [gameStateHook.gameState?.isGameOver, showGameEndModal]);

  React.useEffect(() => {
    if (gameStateHook.isPlaying) {
      setIsGridReviewOpen(false);
    }
  }, [gameStateHook.isPlaying]);

  // Save game session when game ends and pre-load towers
  React.useEffect(() => {
    if (gameStateHook.gameState?.isGameOver && !playerTower) {
      console.log('🎮 Game over detected, saving session...');

      const saveSessionAndPreloadTowers = async () => {
        try {
          const sessionData = {
            finalScore: gameStateHook.gameState!.score,
            blockCount: gameStateHook.gameState!.blocks.length,
            perfectStreakCount: gameStateHook.gameState!.perfectBlockCount ?? 0,
            maxCombo: gameStateHook.gameState!.maxCombo ?? gameStateHook.gameState!.combo ?? 0,
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

            // Store game end data for modal - this should be stable and not change
            setGameEndData({
              rank: result.rank,
              totalPlayers: result.totalPlayers,
              madeTheGrid: result.madeTheGrid,
              scoreToGrid: result.scoreToGrid,
              improvement: result.improvement,
              personalBest: result.personalBest,
              bestScore: result.bestScore,
              previousBestScore: result.previousBestScore,
              bestSessionId: result.bestSessionId,
              bestPerfectStreak: result.bestPerfectStreak,
              previousBestPerfectStreak: result.previousBestPerfectStreak,
              personalBestPerfectStreak: result.personalBestPerfectStreak,
            });

            // Create and assign player tower with stable position FIRST
            await handleGameEnd(result.sessionId);

            // THEN pre-load other towers (after player tower is placed)
            console.log('🏰 Pre-loading other towers...');
            await preloadAndAssignTowers();
          } else {
            console.error('❌ Failed to save session:', await response.text());
          }
        } catch (error) {
          console.error('❌ Error saving session or pre-loading towers:', error);
        }
      };

      saveSessionAndPreloadTowers();
    }
  }, [gameStateHook.gameState?.isGameOver, playerTower, gameStateHook.gameState, preloadAndAssignTowers]);

  // Hide loading after a brief delay to ensure everything is loaded
  React.useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), 2000);
    return () => clearTimeout(timer);
  }, []);

  const handleGameEnd = async (sessionId: string) => {
    setHasSharedSuccessfully(false);
    setLastSessionId(sessionId);
    console.log('Game completed! Session saved:', sessionId);

    // Get the saved session data to create tower entry
    try {
      const sessionData = await getGameSession(sessionId);
      if (sessionData && gameStateHook.gameState) {
        // Assign a stable position to the player tower immediately
        const availableCoords = placementSystem.getAvailableCoordinates();
        const playerCoord = availableCoords[0];

        const towerEntry = {
          sessionId: sessionData.sessionId,
          userId: sessionData.userId,
          username: sessionData.username,
          score: sessionData.finalScore,
          blockCount: sessionData.blockCount,
          perfectStreak: sessionData.perfectStreakCount,
          maxCombo: sessionData.maxCombo ?? 0,
          gameMode: sessionData.gameMode,
          timestamp: sessionData.endTime || sessionData.startTime,
          towerBlocks: sessionData.towerBlocks,
          // Assign world coordinates immediately to prevent position shuffling
          worldX: playerCoord?.worldX,
          worldZ: playerCoord?.worldZ,
          gridX: playerCoord?.x,
          gridZ: playerCoord?.z,
        };

        // Reserve the position in the placement system
        if (playerCoord) {
          placementSystem.placeTower(playerCoord.x, playerCoord.z, sessionData.sessionId);
          console.log('🏰 Assigned stable position to player tower:', [playerCoord.worldX, playerCoord.worldZ]);
        }

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

  const handleOpenGridReview = React.useCallback(async () => {
    setSelectedTower(null);

    try {
      if (!preAssignedTowers || preAssignedTowers.length === 0) {
        if (!isTowerReviewLoading) {
          await preloadAndAssignTowers();
        }
      }
    } catch (error) {
      console.error('❌ Failed to prepare grid review towers:', error);
    } finally {
      setIsGridReviewOpen(true);
    }
  }, [preAssignedTowers, isTowerReviewLoading, preloadAndAssignTowers]);

  const handleCloseGridReview = () => {
    setSelectedTower(null);
    setIsGridReviewOpen(false);
  };

  // Game end modal handlers
  const handleRestartGame = React.useCallback(() => {
    const mode = gameMode ?? 'rotating_block';
    resetGameHook();
    startGameHook(mode);
    setSelectedTower(null);
    setShowGameEndModal(false);
  }, [gameMode, resetGameHook, startGameHook]);

  const handleShare = React.useCallback(
    async (sessionData: ShareSessionPayload) => {
      if (isSharing || hasSharedSuccessfully) {
        return;
      }

      const shareUrl =
        typeof window !== 'undefined' && window.location
          ? window.location.origin
          : 'https://reddit.com/r/stonefall99';

      const formattedScore = sessionData.score.toLocaleString();
      const shareLines: string[] = [
        `I just built a Stonefall tower worth ${formattedScore} points!`,
        `Blocks: ${sessionData.blocks} · Perfect blocks: ${sessionData.perfectStreak}`,
      ];

      if (typeof sessionData.rank === 'number') {
        const rankLine = sessionData.totalPlayers
          ? `Ranked #${sessionData.rank} out of ${sessionData.totalPlayers} on the global grid.`
          : `Ranked #${sessionData.rank} on the global grid.`;
        shareLines.push(rankLine);
      } else if (sessionData.madeTheGrid === true) {
        shareLines.push('Made it onto the Stonefall grid!');
      } else if (sessionData.madeTheGrid === false) {
        shareLines.push('Still climbing to reach the Stonefall grid.');
      }

      if (sessionData.sessionId) {
        const sessionSuffix = sessionData.sessionId.slice(-8).toUpperCase();
        shareLines.push(`Session code: ${sessionSuffix}`);
      }

      const clipboardPayload = `${shareLines.join('\n')}\nPlay Stonefall: ${shareUrl}`;

      setIsSharing(true);

      try {
        const response = await fetch('/api/game/share-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(sessionData),
        });

        if (!response.ok) {
          const errorMessage = await response.text();
          throw new Error(errorMessage || `Request failed with status ${response.status}`);
        }

        const result = (await response.json()) as ShareSessionResponse;
        if (!result.success) {
          throw new Error(result.message ?? 'Failed to publish share post');
        }

        const subredditLabel = result.subreddit ? `r/${result.subreddit}` : 'Reddit';
        const successMessage = `Your tower post is live on ${subredditLabel}!`;
        setHasSharedSuccessfully(true);

        if (result.postUrl && typeof window !== 'undefined') {
          showShareFeedback(`${successMessage} Opening it now…`, 'success');
          try {
            window.open(result.postUrl, '_blank', 'noopener');
          } catch (openError) {
            console.warn('Unable to open share post automatically:', openError);
            showShareFeedback(`${successMessage} Link: ${result.postUrl}`, 'success');
          }
        } else {
          const fallbackMessage = result.postUrl
            ? `${successMessage} Link: ${result.postUrl}`
            : successMessage;
          showShareFeedback(fallbackMessage, 'success');
        }
      } catch (error) {
        console.error('Failed to publish tower share post:', error);
        setHasSharedSuccessfully(false);
        try {
          await copyShareTextToClipboard(clipboardPayload);
          showShareFeedback(
            'Could not publish to Reddit, but your share message is copied to the clipboard.',
            'info'
          );
        } catch (clipboardError) {
          console.error('Clipboard fallback failed:', clipboardError);
          showShareFeedback('Sorry, we could not share your tower. Please try again later.', 'error');
        }
      } finally {
        setIsSharing(false);
      }
    },
    [copyShareTextToClipboard, hasSharedSuccessfully, isSharing, showShareFeedback]
  );

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

  const shareToastStyle = shareFeedback
    ? shareFeedback.tone === 'error'
      ? {
        background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.9), rgba(220, 38, 38, 0.85))',
        boxShadow: '0 8px 24px rgba(239, 68, 68, 0.35)',
      }
      : shareFeedback.tone === 'info'
        ? {
          background: 'linear-gradient(135deg, rgba(249, 115, 22, 0.9), rgba(234, 88, 12, 0.85))',
          boxShadow: '0 8px 24px rgba(249, 115, 22, 0.35)',
        }
        : {
          background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.9), rgba(37, 99, 235, 0.85))',
          boxShadow: '0 8px 24px rgba(37, 99, 235, 0.35)',
        }
    : undefined;

  const handleClearAllData = () => {
    if (!devToolsEnabled) {
      return;
    }
    setShowConfirmModal(true);
  };

  const confirmClearAllData = async () => {
    if (!devToolsEnabled) {
      return;
    }
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
        clearPreloadedTowers();
        setHasSharedSuccessfully(false);

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
          dpr={canvasDpr} // Adaptive pixel ratio for better performance
          className="absolute inset-0"
          shadows={false} // Disable shadows for better performance
          gl={{
            antialias: false,
            powerPreference: "high-performance",
            alpha: false,
            stencil: false,
            depth: true,
            logarithmicDepthBuffer: false,
            precision: "lowp",
            desynchronized: true
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
            preAssignedTowers={preAssignedTowers}
            placementSystem={placementSystem}
            onRestartGame={handleRestartGame}
          />
        </Canvas>
      )}

      {/* Development Clear All Data Button */}
      {devToolsEnabled && !isGridReviewOpen && (
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
      {!isLoading && !gameStateHook.gameState?.isGameOver && !isGridReviewOpen && (
        <>
          {DEBUG_APP_RENDER && console.log('🎮 App: Rendering GameUI', {
            isLoading,
            isPlaying: gameStateHook.isPlaying,
            hasGameState: !!gameStateHook.gameState,
            isGameOver: gameStateHook.gameState?.isGameOver
          })}
          <GameUI
            gameState={gameStateHook}
            onShowTowerReview={handleOpenGridReview}
            isTowerReviewLoading={isTowerReviewLoading}
            towerReviewError={towerReviewError}
          />
        </>
      )}



      {isGridReviewOpen && (
        <GridReviewOverlay
          selectedTower={selectedTower?.tower || null}
          onTowerClick={handleTowerClick}
          onClose={handleCloseGridReview}
          preAssignedTowers={preAssignedTowers}
          placementSystem={placementSystem}
          isLoading={isTowerReviewLoading}
          error={towerReviewError}
          onRequestReload={preloadAndAssignTowers}
          onClearAssignments={clearPreloadedTowers}
        />
      )}



      {/* Success message for completed games */}
      {lastSessionId && (
        <div className="fixed bottom-6 right-6 z-50 pointer-events-none">
          <div
            className="tower-save-toast pointer-events-auto"
            role="status"
            aria-live="polite"
          >
            <span className="tower-save-toast__icon" aria-hidden="true">🏙️</span>
            <div className="tower-save-toast__text">
              <span className="tower-save-toast__title">Tower Saved</span>
              <span className="tower-save-toast__body">
                Session <span className="tower-save-toast__code">{lastSessionId.slice(-8).toUpperCase()}</span>
              </span>
            </div>
          </div>
        </div>
      )}

      {shareFeedback && (
        <div
          className="fixed top-6 left-1/2 transform -translate-x-1/2 px-5 py-3 rounded-xl text-white text-sm md:text-base z-50 pointer-events-none"
          style={{
            ...(shareToastStyle ?? {}),
            backdropFilter: 'blur(12px)',
          }}
          role="status"
          aria-live="polite"
        >
          {shareFeedback.message}
        </div>
      )}

      {/* CSS for animations */}
      <style>{`
        @keyframes towerToastEnter {
          0% { opacity: 0; transform: translate3d(0, 24px, 0) scale(0.95); }
          60% { opacity: 1; transform: translate3d(0, 0, 0) scale(1); }
          100% { opacity: 1; transform: translate3d(0, 0, 0) scale(1); }
        }

        @keyframes towerToastGlow {
          0%, 100% { box-shadow: 0 0 0 rgba(59, 130, 246, 0.3); }
          50% { box-shadow: 0 12px 32px rgba(59, 130, 246, 0.45); }
        }

        .tower-save-toast {
          position: relative;
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 14px 18px;
          border-radius: 16px;
          background: linear-gradient(145deg, rgba(14, 23, 42, 0.88), rgba(15, 38, 69, 0.92));
          border: 1px solid rgba(59, 130, 246, 0.45);
          color: #e2e8f0;
          backdrop-filter: blur(16px);
          animation: towerToastEnter 0.45s cubic-bezier(0.24, 0.8, 0.32, 1) forwards, towerToastGlow 3.2s ease-in-out infinite;
          overflow: hidden;
        }

        .tower-save-toast::before {
          content: '';
          position: absolute;
          inset: -22%;
          background: radial-gradient(circle at top right, rgba(59, 130, 246, 0.35), transparent 60%);
          opacity: 0.85;
          filter: blur(22px);
          z-index: -1;
        }

        .tower-save-toast__icon {
          font-size: 1.5rem;
        }

        .tower-save-toast__text {
          display: flex;
          flex-direction: column;
          gap: 2px;
          line-height: 1.1;
        }

        .tower-save-toast__title {
          font-size: 0.72rem;
          letter-spacing: 0.26em;
          text-transform: uppercase;
          color: rgba(148, 163, 184, 0.85);
          font-weight: 600;
        }

        .tower-save-toast__body {
          font-size: 0.95rem;
          font-weight: 600;
          color: #f8fafc;
        }

        .tower-save-toast__code {
          margin-left: 0.35rem;
          font-family: 'Orbitron', sans-serif;
          letter-spacing: 0.18em;
          font-size: 0.85rem;
          color: rgba(96, 165, 250, 0.95);
        }
      `}</style>

      {/* Tower Info Popup - DOM Overlay */}
      {selectedTower && (
        <TowerInfoPopup
          tower={selectedTower.tower}
          rank={selectedTower.rank}
          playerScore={playerTower?.score || gameStateHook.gameState?.score || 0}
          playerBlocks={playerTower?.blockCount || gameStateHook.gameState?.blocks.length || 0}
          playerPerfectBlocks={
            playerTower?.perfectStreak || gameStateHook.gameState?.perfectBlockCount || 0
          }
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
        onPlayAgain={handleRestartGame}
        onShare={handleShare}
        onMinimize={handleMinimizeModal}
        onViewTower={handleViewTower}
        isSharing={isSharing}
        hasSharedSuccessfully={hasSharedSuccessfully}
      />

      {/* Confirmation Modal */}
      {devToolsEnabled && showConfirmModal && (
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
