import React from 'react';
import { Canvas } from '@react-three/fiber';
import { GameUI } from './components/GameUI';
import { useGameState } from './hooks/useGameState';
import { GameScene } from './components/GameScene_Simple';
import { useGameData } from './hooks/useGameData';
import { useTowerPreloader } from './hooks/useTowerPreloader';
import {
  TowerPlacementSystem,
  DEFAULT_TOWER_GRID_OFFSET,
  DEFAULT_TOWER_GRID_RADIUS,
  DEFAULT_TOWER_GRID_SIZE,
} from '../shared/types/towerPlacement';
import { ChunkLoadingIndicator } from './components/ChunkLoadingIndicator';
import { TowerInfoPopup } from './components/TowerInfoPopup';
import { CompactGameEndModal, ShareSessionPayload } from './components/CompactGameEndModal';
import type { ShareSessionResponse, ReplayData, TowerMapEntry } from '../shared/types/api';
import { GridReviewOverlay } from './components/GridReviewOverlay';
import { useThree } from '@react-three/fiber';
import { PerformanceConnector } from './components/PerformanceConnector';
import { InlineGridDisplay, ViewMode } from './components/InlineGridDisplay';
import { getWebViewMode, addWebViewModeListener, removeWebViewModeListener, requestExpandedMode } from '@devvit/web/client';
import { useTournament, TournamentTower } from './hooks/useTournament';
import { TournamentOverlay } from './components/TournamentOverlay';
import { reconstructTowerBlocks } from './utils/reconstructTower';

import { enableServerLogging } from './utils/serverLogger';
import { computeGridRadiusForCapacity, MAX_VISIBLE_TOWERS } from '../shared/constants/towers';
import {
  PLAYER_COLOR_STORAGE_KEY,
  PlayerColorChoice,
  PlayerColorTheme,
  getPlayerColorTheme,
  isPlayerColorChoice,
} from './constants/playerColors';
import { GameEndControls } from './components/GameEndControls';

// Component to log renderer capabilities once
const RendererLogger: React.FC = () => {
  const { gl, scene, camera } = useThree();

  React.useEffect(() => {
    console.log('🎨 Renderer Info:', {
      type: gl.capabilities.isWebGL2 ? 'WebGL2' : 'WebGL1',
      supportsInstancing: gl.capabilities.isWebGL2,
      maxTextureSize: gl.capabilities.maxTextureSize,
      maxVertexUniforms: gl.capabilities.maxVertexUniforms,
      precision: gl.capabilities.precision,
    });
    console.log('📹 Camera:', camera.position, camera.rotation);
    console.log('🎬 Scene children count:', scene.children.length);
  }, [gl, scene, camera]);

  return null;
};

// Toggle to true to inspect App re-render frequency during development.

const CAMERA_SPEED_MIN = 0.25;
const CAMERA_SPEED_MAX = 2;
const CAMERA_SPEED_STEP = 0.25;

const hexToRgb = (hex: string): string | null => {
  const normalized = hex.replace('#', '');
  if (normalized.length !== 6) {
    return null;
  }
  const value = Number.parseInt(normalized, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `${r}, ${g}, ${b}`;
};

type ShareFeedbackTone = 'success' | 'error' | 'info';

interface ShareFeedbackState {
  message: string;
  tone: ShareFeedbackTone;
}


export const App: React.FC = () => {
  const gameStateHook = useGameState();
  const { startGame: startGameHook, resetGame: resetGameHook, gameMode, setGameMode } = gameStateHook;
  const { getGameSession, updateTowerPlacement } = useGameData();

  // Tournament Hook
  const tournament = useTournament();
  const [isTournamentMenuOpen, setIsTournamentMenuOpen] = React.useState(false);
  const [activeTournamentMatch, setActiveTournamentMatch] = React.useState<{ matchId: string; opponent: { userId: string; username: string; elo: number; bestScore?: number }; defeatedSessionId?: string } | null>(null);
  // Separate state for battle HUD display - persists through game end modal
  const [currentBattleInfo, setCurrentBattleInfo] = React.useState<{ opponentName: string; opponentScore: number } | null>(null);

  const challengeSeasonLabel = React.useMemo(() => {
    const endsAt = tournament.status?.seasonEndsAt;
    if (!endsAt || !Number.isFinite(endsAt)) return null;
    const remainingMs = endsAt - Date.now();
    if (remainingMs <= 0) return 'Season ended';
    const totalMinutes = Math.floor(remainingMs / 60000);
    const days = Math.floor(totalMinutes / (60 * 24));
    const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
    const minutes = totalMinutes % 60;
    if (days > 0) return `Season ends in ${days}d ${hours}h`;
    if (hours > 0) return `Season ends in ${hours}h ${minutes}m`;
    return `Season ends in ${minutes}m`;
  }, [tournament.status?.seasonEndsAt]);

  const [tournamentResultData, setTournamentResultData] = React.useState<{
    result: 'win' | 'loss' | 'practice';
    score: number;
    blocks: number;
    perfectStreak: number;
    maxCombo: number;
    opponentName: string;
    opponentScore: number;
    eloChange: number;
    newElo: number;
    ticketsRemaining?: number;
  } | null>(null);

  // Tower placement system for pre-assignment
  const [placementSystem] = React.useState(
    () =>
      new TowerPlacementSystem(
        DEFAULT_TOWER_GRID_SIZE,
        DEFAULT_TOWER_GRID_OFFSET,
        DEFAULT_TOWER_GRID_OFFSET,
        DEFAULT_TOWER_GRID_RADIUS
      )
  );

  const replayData = React.useMemo<ReplayData | null>(() => {
    if (!gameStateHook.gameState || !gameStateHook.gameState.isGameOver) {
      return null;
    }
    return {
      version: 1,
      seed: gameStateHook.gameState.seed,
      gameMode: gameStateHook.gameMode,
      inputs: gameStateHook.recordedInputs,
      finalScore: gameStateHook.gameState.score,
      finalTick: gameStateHook.gameState.tick,
    };
  }, [gameStateHook.gameState, gameStateHook.gameMode, gameStateHook.recordedInputs]);

  const [webViewMode, setWebViewMode] = React.useState<'inline' | 'expanded'>(() => {
    try {
      return getWebViewMode();
    } catch (e) {
      return 'expanded'; // Default to expanded if not in Devvit environment
    }
  });

  const [targetUsername, setTargetUsername] = React.useState<string | null>(null);

  React.useEffect(() => {
    const handleModeChange = (newMode: 'inline' | 'expanded') => {
      setWebViewMode(newMode);
    };
    try {
      addWebViewModeListener(handleModeChange);
      return () => removeWebViewModeListener(handleModeChange);
    } catch (e) {
      console.warn('WebView mode listener not supported');
    }
  }, []);

  // REPLAY MODE DISABLED FOR THIS RELEASE
  // const [replayDataToWatch, setReplayDataToWatch] = React.useState<ReplayData | null>(null);

  const loadSessionData = React.useCallback(async (sessionId: string, replayData?: ReplayData) => {
    console.log('🔍 Loading session data...', sessionId);
    try {
      const sessionData = await getGameSession(sessionId);
      if (sessionData) {
        console.log('✅ Session data loaded:', sessionData);
        let worldX = sessionData.worldX;
        let worldZ = sessionData.worldZ;
        let gridX = sessionData.gridX;
        let gridZ = sessionData.gridZ;

        // If no placement data, assign a deterministic position based on session ID
        if (worldX === undefined || worldZ === undefined) {
          console.log('⚠️ No placement data found, assigning deterministic position');
          // Generate deterministic index from session ID
          let hash = 0;
          for (let i = 0; i < sessionId.length; i++) {
            hash = ((hash << 5) - hash) + sessionId.charCodeAt(i);
            hash |= 0;
          }
          const positiveHash = Math.abs(hash);

          // Get all coordinates
          const coords = placementSystem.getAllCoordinates();
          if (coords.length > 0) {
            // Avoid 0,0 if possible (index 0 might be 0,0 depending on generation order)
            // But actually 0,0 is fine if it's a valid grid spot, unless it's visually blocked
            const index = positiveHash % coords.length;
            const coord = coords[index];
            worldX = coord.worldX;
            worldZ = coord.worldZ;
            gridX = coord.x;
            gridZ = coord.z;
            console.log(`📍 Assigned deterministic position: [${worldX}, ${worldZ}]`);
          } else {
            worldX = 0;
            worldZ = 0;
            gridX = 0;
            gridZ = 0;
          }
        }

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
          playerColorChoice: sessionData.playerColorChoice ?? null,
          worldX: worldX ?? 0,
          worldZ: worldZ ?? 0,
          gridX: gridX ?? 0,
          gridZ: gridZ ?? 0,
        };

        console.log('✅ Player tower loaded:', {
          id: towerEntry.sessionId,
          score: towerEntry.score,
          pos: [towerEntry.worldX, towerEntry.worldZ]
        });
        setPlayerTower(towerEntry);
        console.log('🏰 setPlayerTower called in loadSessionData with:', towerEntry);
        setSelectedTower({ tower: towerEntry });

        // Save the tower placement coordinates to the server
        try {
          console.log(`📍 Saving tower placement for session ${sessionId}: world=[${towerEntry.worldX},${towerEntry.worldZ}], grid=[${towerEntry.gridX},${towerEntry.gridZ}]`);
          await updateTowerPlacement(sessionId, towerEntry.worldX, towerEntry.worldZ, towerEntry.gridX, towerEntry.gridZ);
          console.log(`✅ Tower placement saved successfully`);
        } catch (e) {
          console.error(`❌ Failed to save tower placement:`, e);
        }

        // Keep start screen (InlineGridDisplay) visible for shared posts
        // But ensure we have the data ready for when they click "Enter"
        setShowStartScreen(true);
        setShowGameEndModal(false);

        // REPLAY MODE DISABLED FOR THIS RELEASE
        // if (replayData) {
        //   setReplayDataToWatch(replayData);
        // } else if (sessionData.replayData) {
        //   setReplayDataToWatch(sessionData.replayData);
        // }
      } else {
        console.warn('⚠️ Session data fetch returned null for ID:', sessionId);
        // REPLAY MODE DISABLED FOR THIS RELEASE
        // if (replayData) {
        //   console.log('⚠️ Falling back to replay data for tower construction');
        //   setReplayDataToWatch(replayData);
        //   setShowStartScreen(false);
        //   setShowGameEndModal(true);
        //
        //   setGameEndData({
        //     rank: undefined,
        //     totalPlayers: 0,
        //     madeTheGrid: false,
        //     scoreToGrid: 0,
        //     bestScore: replayData.finalScore,
        //     bestSessionId: sessionId,
        //   });
        // }
      }
    } catch (e) {
      console.error('❌ Error loading session data:', e);
      // REPLAY MODE DISABLED FOR THIS RELEASE
      // if (replayData) {
      //   console.log('⚠️ Error fetching session, using replay data fallback.');
      //   setReplayDataToWatch(replayData);
      //   setShowStartScreen(false);
      //   setShowGameEndModal(true);
      //
      //   setGameEndData({
      //     rank: undefined,
      //     totalPlayers: 0,
      //     madeTheGrid: false,
      //     scoreToGrid: 0,
      //     bestScore: replayData.finalScore,
      //     bestSessionId: sessionId,
      //   });
      // }
    }
  }, [getGameSession, placementSystem]);

  // Fetch initialization data from API (fallback for inline mode)
  React.useEffect(() => {
    const fetchInitData = async () => {
      try {
        const response = await fetch('/api/init');
        if (response.ok) {
          const data = await response.json();
          console.log('🔍 API Init data received:', data);

          if (data.postAuthor) {
            setTargetUsername(data.postAuthor);
          }

          if (data.sessionId) {
            await loadSessionData(data.sessionId, data.replayData);
          }
          // REPLAY MODE DISABLED FOR THIS RELEASE
          // else if (data.replayData) {
          //   console.log('📼 Replay data received from API', data.replayData);
          //   setReplayDataToWatch(data.replayData);
          //   // If only replay data, we can't show the tower in grid, so jump to game/modal
          //   setShowStartScreen(false);
          //   setShowGameEndModal(true);
          // }
        }
      } catch (e) {
        console.error('Failed to fetch init data:', e);
      }
    };

    fetchInitData();
  }, [loadSessionData]);

  React.useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      if (event.data && event.data.type === 'INIT_CONTEXT') {
        const { username, replayData, sessionId } = event.data.payload;

        if (username) {
          setTargetUsername(username);
        }
        // REPLAY MODE DISABLED FOR THIS RELEASE
        // if (replayData && !sessionId) {
        //   // Only replay data
        //   console.log('📼 Replay data received', replayData);
        //   setReplayDataToWatch(replayData);
        //   setShowStartScreen(false);
        //   setShowGameEndModal(true);
        // } else
        if (sessionId) {
          await loadSessionData(sessionId, replayData);
        }
      }
    };

    window.addEventListener('message', handleMessage);
    window.parent.postMessage({ type: 'APP_READY' }, '*');

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [loadSessionData]);

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
  const [glRenderer, setGlRenderer] = React.useState<any>(null);
  const [cameraRotationSpeed, setCameraRotationSpeed] = React.useState(1);
  const [playerColorChoice, setPlayerColorChoice] = React.useState<PlayerColorChoice | null>(() => {
    if (typeof window === 'undefined') {
      return null;
    }
    const stored = window.localStorage?.getItem(PLAYER_COLOR_STORAGE_KEY) ?? null;
    return isPlayerColorChoice(stored) ? stored : null;
  });
  const playerColorTheme = React.useMemo<PlayerColorTheme | null>(
    () => getPlayerColorTheme(playerColorChoice),
    [playerColorChoice]
  );

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

  const handlePlayerColorChange = React.useCallback((choice: PlayerColorChoice) => {
    setPlayerColorChoice(choice);
    if (typeof window !== 'undefined') {
      window.localStorage?.setItem(PLAYER_COLOR_STORAGE_KEY, choice);
    }
  }, []);

  React.useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }
    const root = document.documentElement;
    const resetVars = () => {
      root.style.removeProperty('--tron-player-accent');
      root.style.removeProperty('--tron-player-accent-secondary');
      root.style.removeProperty('--tron-player-accent-rgb');
      root.style.removeProperty('--tron-player-glow');
    };

    if (!playerColorTheme) {
      resetVars();
      return;
    }

    root.style.setProperty('--tron-player-accent', playerColorTheme.accentHex);
    root.style.setProperty('--tron-player-accent-secondary', playerColorTheme.accentSecondaryHex);
    root.style.setProperty('--tron-player-glow', playerColorTheme.uiGlowHex);
    const rgb = hexToRgb(playerColorTheme.accentHex);
    if (rgb) {
      root.style.setProperty('--tron-player-accent-rgb', rgb);
    }
  }, [playerColorTheme]);

  // Enable server logging on mount
  React.useEffect(() => {
    enableServerLogging();
  }, []);

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
    sessionId?: string;
    bestPerfectStreak?: number;
    previousBestPerfectStreak?: number;
    personalBestPerfectStreak?: boolean;
  } | null>(null);

  // Confirmation modal state
  const [showConfirmModal, setShowConfirmModal] = React.useState(false);

  // Session saving state
  const [isSavingSession, setIsSavingSession] = React.useState(false);

  // Start screen state (replaces inline/expanded mode check)
  const [showStartScreen, setShowStartScreen] = React.useState(true);

  // Start-screen grid review state
  const [isGridReviewOpen, setIsGridReviewOpen] = React.useState(false);

  // Leaderboard type state
  const [leaderboardType, setLeaderboardType] = React.useState<ViewMode>('daily');

  // Cycle ID state for time travel
  const [currentCycleId, setCurrentCycleId] = React.useState<string>(() => new Date().toISOString().split('T')[0] || '');

  // Challenge mode state
  const [tournamentTowers, setTournamentTowers] = React.useState<TowerMapEntry[]>([]);
  const [opponentTowers, setOpponentTowers] = React.useState<TowerMapEntry[]>([]);
  const [selectedOpponentTower, setSelectedOpponentTower] = React.useState<TowerMapEntry | null>(null);
  const [ghostTowerBlocks, setGhostTowerBlocks] = React.useState<TowerMapEntry['towerBlocks'] | null>(null);
  const [viewingOpponent, setViewingOpponent] = React.useState(false); // Are we viewing opponent towers?
  const [matchOpponent, setMatchOpponent] = React.useState<{ userId: string; username: string; elo: number } | null>(null);
  const [defeatedTowerIds, setDefeatedTowerIds] = React.useState<Set<string>>(new Set());

  // Tower preloader hook
  const towerPreloader = useTowerPreloader(placementSystem);
  const {
    preAssignedTowers,
    isLoading: isTowerReviewLoading,
    error: towerReviewError,
    totalCount,
    preloadAndAssignTowers,
    clearPreloadedTowers,
  } = towerPreloader;

  React.useEffect(() => {
    // Use the actual tower count if available, otherwise fall back to MAX_VISIBLE_TOWERS
    const effectiveTowerCount = Math.max(totalCount || MAX_VISIBLE_TOWERS, MAX_VISIBLE_TOWERS);
    const dynamicRadius = computeGridRadiusForCapacity(
      effectiveTowerCount,
      gameStateHook.gridDensity
    );
    placementSystem.updateGrid(
      gameStateHook.gridSize,
      gameStateHook.gridOffsetX,
      gameStateHook.gridOffsetZ,
      dynamicRadius
    );

    // Rehydrate occupied coordinates after grid reset to prevent duplicate placements
    if (playerTower && typeof playerTower.gridX === 'number' && typeof playerTower.gridZ === 'number') {
      placementSystem.placeTower(playerTower.gridX, playerTower.gridZ, playerTower.sessionId);
    }
    if (preAssignedTowers && preAssignedTowers.length > 0) {
      preAssignedTowers.forEach((tower) => {
        if (typeof tower.gridX === 'number' && typeof tower.gridZ === 'number' && tower.sessionId) {
          placementSystem.placeTower(tower.gridX, tower.gridZ, tower.sessionId);
        }
      });
    }
  }, [
    gameStateHook.gridDensity,
    gameStateHook.gridSize,
    gameStateHook.gridOffsetX,
    gameStateHook.gridOffsetZ,
    placementSystem,
    totalCount,
    playerTower,
    preAssignedTowers,
  ]);

  const { fetchTournamentTowers, fetchMyTournamentTowers, fetchOpponentTowers } = tournament;

  // Helper to assign grid positions to challenge towers
  const assignPositionsToChallengeTowers = React.useCallback(
    (towers: TowerMapEntry[]): TowerMapEntry[] => {
      // Reset placement system for challenge mode
      placementSystem.reset();

      let currentRank = 0;
      const positionedTowers: TowerMapEntry[] = [];

      towers.forEach((tower) => {
        // Try to use existing position if available
        if (tower.worldX !== undefined && tower.worldZ !== undefined && tower.gridX !== undefined && tower.gridZ !== undefined) {
          const coord = placementSystem.getCoordinateByWorldPos(tower.worldX, tower.worldZ);
          if (coord && placementSystem.placeTower(coord.x, coord.z, tower.sessionId)) {
            positionedTowers.push(tower);
            return;
          }
        }

        // Otherwise assign new coordinates
        const coord = placementSystem.getNextCoordinateForRank(currentRank + 1);
        if (coord && placementSystem.placeTower(coord.x, coord.z, tower.sessionId)) {
          const positionedTower: TowerMapEntry = {
            ...tower,
            worldX: coord.worldX,
            worldZ: coord.worldZ,
            gridX: coord.x,
            gridZ: coord.z,
          };
          positionedTowers.push(positionedTower);
          currentRank++;
        } else {
          // If no position available, include tower without position
          positionedTowers.push(tower);
        }
      });

      return positionedTowers;
    },
    [placementSystem]
  );

  // Automatically load towers in inline mode or game end modal
  React.useEffect(() => {
    if (showStartScreen || showGameEndModal) {
      if (leaderboardType === 'challenge') {
        // Fetch user's own towers OR opponent towers depending on viewing mode
        const fetchChallengeTowers = async () => {
          try {
            let towers: TowerMapEntry[] = [];

            if (viewingOpponent && matchOpponent) {
              // Load opponent towers
              towers = await fetchOpponentTowers(matchOpponent.userId);
              console.log(`🏰 Loaded ${towers.length} opponent towers`);
              console.log('[OPPONENT TOWERS] SessionIds:', towers.map(t => ({ sessionId: t.sessionId, username: t.username, isDefeated: t.isDefeated })));

              // Build defeated tower set from server data
              const defeatedIds = new Set(
                towers.filter(t => t.isDefeated).map(t => t.sessionId)
              );
              setDefeatedTowerIds(defeatedIds);
              console.log('[DEFEATED TOWERS] Loaded from server:', Array.from(defeatedIds));
            } else {
              // Load user's own towers
              towers = await fetchMyTournamentTowers();
              console.log(`🏰 Loaded ${towers.length} of user's challenge towers`);

              // Build defeated tower set from server data
              const defeatedIds = new Set(
                towers.filter(t => t.isDefeated).map(t => t.sessionId)
              );
              setDefeatedTowerIds(defeatedIds);
              console.log('[DEFEATED TOWERS] Loaded from server (my towers):', Array.from(defeatedIds));
            }

            // Assign grid positions to towers
            const positionedTowers = assignPositionsToChallengeTowers(towers);
            console.log(`🏰 Assigned positions to ${positionedTowers.length} challenge towers`);

            setOpponentTowers(positionedTowers);
            setTournamentTowers(positionedTowers);
          } catch (e) {
            console.error('Failed to load challenge towers:', e);
          }
        };

        fetchChallengeTowers();
      } else {
        // Regular leaderboard mode
        preloadAndAssignTowers(leaderboardType, playerTower, currentCycleId);
      }
    }
  }, [showStartScreen, showGameEndModal, leaderboardType, viewingOpponent, matchOpponent, preloadAndAssignTowers, playerTower, currentCycleId, fetchMyTournamentTowers, fetchOpponentTowers, assignPositionsToChallengeTowers]);

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
        setIsSavingSession(true);
        try {
          const sessionData = {
            seed: gameStateHook.gameState!.seed,
            finalScore: gameStateHook.gameState!.score,
            blockCount: gameStateHook.gameState!.blocks.length,
            perfectStreakCount: gameStateHook.gameState!.perfectBlockCount ?? 0,
            maxCombo: gameStateHook.gameState!.maxCombo ?? gameStateHook.gameState!.combo ?? 0,
            gameMode: gameStateHook.gameMode,
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
            playerColorChoice: playerColorChoice ?? null,
          };

          // Save the session using the real API
          const response = await fetch('/api/game/save-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionData,
              replayData: replayData || {
                version: 1,
                seed: gameStateHook.gameState!.seed,
                gameMode: gameStateHook.gameMode,
                inputs: gameStateHook.recordedInputs,
                finalScore: gameStateHook.gameState!.score,
                finalTick: gameStateHook.gameState!.tick,
              }
            }),
          });

          if (response.ok) {
            const result = await response.json();
            console.log('✅ Session saved successfully:', result.sessionId);

            // Submit ghost data for tournament with sessionId (fire and forget)
            if (replayData && gameStateHook.gameState?.score) {
              tournament.submitGhost(replayData, gameStateHook.gameState.score, result.sessionId)
                .then(success => success && console.log('👻 Tournament ghost submitted with sessionId:', result.sessionId))
                .catch(console.error);
            }

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
              sessionId: result.sessionId,
              bestPerfectStreak: result.bestPerfectStreak,
              previousBestPerfectStreak: result.previousBestPerfectStreak,
              personalBestPerfectStreak: result.personalBestPerfectStreak,
            });

            // Create and assign player tower with stable position FIRST
            await handleGameEnd(result.sessionId, result.rank);

            // THEN pre-load other towers (after player tower is placed)
            // We pass the newly created player tower (which handleGameEnd sets in state, but we can't access updated state yet)
            // So we rely on the fact that handleGameEnd sets it, and we might need to wait or pass it explicitly?
            // Actually, handleGameEnd is async and sets state. But state update is not immediate.
            // However, preloadAndAssignTowers uses the `playerTower` from its closure or args.
            // We should probably just trigger it, and let the effect in App.tsx handle the reload if needed?
            // Or better, pass the tower we just created if we can.
            // But handleGameEnd doesn't return the tower object.
            // Let's just call it, and rely on the `playerTower` dependency in the useEffect above to trigger a proper reload with reservation.
            // Actually, calling it here might be redundant if `playerTower` change triggers the effect.
            // Let's remove the explicit call here and let the effect handle it.
            console.log('🏰 Triggering tower reload via state change...');
          } else {
            console.error('❌ Failed to save session:', await response.text());
          }
        } catch (error) {
          console.error('❌ Error saving session or pre-loading towers:', error);
        } finally {
          setIsSavingSession(false);
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

  const handleGameEnd = async (sessionId: string, rank?: number | null) => {
    setHasSharedSuccessfully(false);
    setLastSessionId(sessionId);
    console.log('Game completed! Session saved:', sessionId);

    // Get the saved session data to create tower entry
    try {
      const sessionData = await getGameSession(sessionId);
      if (sessionData && gameStateHook.gameState) {
        // Assign a stable position to the player tower immediately
        // Use provided rank (converted to 0-based) or default to 0 if unknown
        const effectiveRank = (rank !== undefined && rank !== null) ? Math.max(0, rank - 1) : 0;

        const playerCoord =
          placementSystem.getNextCoordinateForRank(effectiveRank, { preferCenter: effectiveRank === 0 }) ??
          placementSystem.getSpreadOutCoordinate(1);

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
          playerColorChoice: sessionData.playerColorChoice ?? playerColorChoice ?? null,
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
        console.log('🏰 setPlayerTower called in handleGameEnd with:', towerEntry);

        // Save the tower placement coordinates to the server
        if (playerCoord) {
          try {
            console.log(`📍 Saving tower placement for new game session ${sessionId}: world=[${playerCoord.worldX},${playerCoord.worldZ}], grid=[${playerCoord.x},${playerCoord.z}]`);
            await updateTowerPlacement(sessionId, playerCoord.worldX, playerCoord.worldZ, playerCoord.x, playerCoord.z);
            console.log(`✅ Tower placement saved successfully`);
          } catch (e) {
            console.error(`❌ Failed to save tower placement:`, e);
          }
        }
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

  const handleCameraSpeedChange = React.useCallback((nextSpeed: number) => {
    setCameraRotationSpeed((prev) => {
      const target = Number.isFinite(nextSpeed) ? nextSpeed : prev;
      const clamped = Math.min(CAMERA_SPEED_MAX, Math.max(CAMERA_SPEED_MIN, target));
      return parseFloat(clamped.toFixed(2));
    });
  }, []);

  const cameraSpeedControls = React.useMemo(
    () => ({
      value: cameraRotationSpeed,
      min: CAMERA_SPEED_MIN,
      max: CAMERA_SPEED_MAX,
      step: CAMERA_SPEED_STEP,
      onChange: handleCameraSpeedChange,
    }),
    [cameraRotationSpeed, handleCameraSpeedChange]
  );

  // Game end modal handlers
  const handleRestartGame = React.useCallback(() => {
    const mode = gameMode ?? 'rotating_block';
    resetGameHook();
    startGameHook(mode);
    setSelectedTower(null);
    setPlayerTower(null);
    setGhostTowerBlocks(null);
    setGameEndData(null);
    setShowGameEndModal(false);
    setCurrentBattleInfo(null); // Clear battle info when restarting
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

          // Try to open via Devvit parent first
          if (window.parent && window.parent !== window) {
            window.parent.postMessage({ type: 'OPEN_LINK', url: result.postUrl }, '*');
          } else {
            try {
              window.open(result.postUrl, '_blank', 'noopener');
            } catch (openError) {
              console.warn('Unable to open share post automatically:', openError);
              showShareFeedback(`${successMessage} Link: ${result.postUrl}`, 'success');
            }
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

  // REPLAY MODE DISABLED FOR THIS RELEASE
  // const handleWatchReplay = () => {
  //   console.log('📼 Watch Replay clicked');
  //   const data = replayData || replayDataToWatch;
  //   if (data) {
  //     setShowGameEndModal(false);
  //     // Start game in replay mode
  //     startGameHook(data.gameMode as any, undefined, data);
  //   }
  // };

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

  React.useEffect(() => {
    // If game ends and we were in a tournament match
    if (gameStateHook.gameState?.isGameOver && activeTournamentMatch) {
      console.log("🏆 Tournament Match Ended. Reporting...");

      // Check if this is a practice match (no real opponent)
      if (activeTournamentMatch.opponent.userId === 'practice') {
        // Practice mode - just save the score without ELO change
        console.log("Practice mode - saving score without ELO");
        setTournamentResultData({
          result: 'practice',
          score: gameStateHook.gameState.score,
          blocks: gameStateHook.gameState.blocks.length,
          perfectStreak: gameStateHook.gameState.perfectBlockCount ?? 0,
          maxCombo: gameStateHook.gameState.maxCombo ?? 0,
          opponentName: activeTournamentMatch.opponent.username,
          opponentScore: 0,
          eloChange: 0,
          newElo: 0,
          ticketsRemaining: tournament.status?.tickets ?? undefined
        });
      } else {
        // Real match - report with ELO calculation
        const result = gameStateHook.gameState.score > (activeTournamentMatch.opponent.bestScore || 0) ? 'win' : 'loss';

        tournament.reportMatch(result, gameStateHook.gameState.score, activeTournamentMatch.defeatedSessionId).then(res => {
          console.log("Match Reported:", res);
          if (res) {
            setTournamentResultData({
              result,
              score: gameStateHook.gameState!.score,
              blocks: gameStateHook.gameState!.blocks.length,
              perfectStreak: gameStateHook.gameState!.perfectBlockCount ?? 0,
              maxCombo: gameStateHook.gameState!.maxCombo ?? 0,
              opponentName: activeTournamentMatch.opponent.username,
              opponentScore: activeTournamentMatch.opponent.bestScore || 0,
              eloChange: res.eloChange,
              newElo: res.newElo,
              ticketsRemaining: res.newTickets
            });

            // Add defeated tower to the client-side set for immediate UI feedback
            // This will be refreshed from server on next opponent tower fetch
            if (result === 'win' && activeTournamentMatch.defeatedSessionId) {
              console.log('[VICTORY] 🏆 Marking tower as defeated (client-side cache):', {
                sessionId: activeTournamentMatch.defeatedSessionId,
              });
              setDefeatedTowerIds(prev => {
                const newSet = new Set([...prev, activeTournamentMatch.defeatedSessionId!]);
                console.log('[VICTORY] Updated defeated towers cache:', Array.from(newSet));
                return newSet;
              });
            }
          }
        });
      }

      // Don't clear activeTournamentMatch here - keep it for the game end modal
      // It will be cleared when user clicks Continue to go back to start screen
    }
  }, [gameStateHook.gameState?.isGameOver, activeTournamentMatch, tournament, gameStateHook.gameState]);

  if (showStartScreen) {
    return (
      <div style={{ width: '100%', height: '100%', position: 'relative' }}>
        <InlineGridDisplay
          preAssignedTowers={leaderboardType === 'challenge' ? tournamentTowers : preAssignedTowers}
          placementSystem={placementSystem}
          playerTower={playerTower}
          targetUsername={targetUsername}
          playerColorChoice={playerColorChoice}
          onPlayerColorChange={handlePlayerColorChange}
          leaderboardType={leaderboardType}
          onLeaderboardTypeChange={setLeaderboardType}
          totalCount={leaderboardType === 'challenge' ? tournamentTowers.length : totalCount}
          currentCycleId={currentCycleId}
          onCycleChange={setCurrentCycleId}
          gameMode={gameMode}
          onGameModeChange={(mode) => {
            setGameMode(mode);
          }}
          challengeTicketCount={tournament.status?.tickets ?? null}
          challengeSeasonLabel={challengeSeasonLabel}
          defeatedTowerIds={leaderboardType === 'challenge' ? defeatedTowerIds : undefined}
          currentPlayerElo={leaderboardType === 'challenge' ? tournament.status?.elo ?? null : null}
          currentPlayerRank={leaderboardType === 'challenge' ? tournament.status?.rank ?? null : null}
          opponentInfo={leaderboardType === 'challenge' && matchOpponent ? {
            username: matchOpponent.username,
            elo: matchOpponent.elo,
            rank: matchOpponent.rank
          } : null}
          battleLabel={leaderboardType === 'challenge' ? (viewingOpponent ? (selectedOpponentTower ? 'START BATTLE' : 'Select a tower') : 'Find Match') : undefined}
          onBattle={leaderboardType === 'challenge' ? async () => {
            if (viewingOpponent) {
              // User must select a tower before battle
              if (!selectedOpponentTower) {
                console.log('Please select an opponent tower first');
                return;
              }

              // Start battle with selected opponent tower
              try {
                // Use the replayData from the tower object directly
                const ghostReplay = selectedOpponentTower.replayData;

                console.log('[BATTLE START] 🎮 Starting battle with selected opponent tower');
                console.log('[BATTLE START] Tower ID:', selectedOpponentTower.towerId);
                console.log('[BATTLE START] Tower Score:', selectedOpponentTower.score);
                console.log('[BATTLE START] Replay Data exists:', !!ghostReplay);
                if (ghostReplay) {
                  console.log('[BATTLE START] Replay seed:', ghostReplay.seed);
                  console.log('[BATTLE START] Replay inputs count:', ghostReplay.inputs?.length || 0);
                  console.log('[BATTLE START] Replay gameMode:', ghostReplay.gameMode);
                }

                if (!ghostReplay) throw new Error('No replay data found');

                // CRITICAL: Reset game state FIRST to clear any previous ghost/game data
                gameStateHook.resetGame();

                // Start the match with updated opponent info including the tower's score
                const nextGhostBlocks = Array.isArray(selectedOpponentTower.towerBlocks)
                  ? selectedOpponentTower.towerBlocks
                  : null;
                console.log('[BATTLE START] Ghost tower blocks set:', {
                  hasBlocks: !!nextGhostBlocks,
                  count: nextGhostBlocks?.length ?? 0,
                });
                if (nextGhostBlocks && nextGhostBlocks.length > 0) {
                  const lastBlock = nextGhostBlocks[nextGhostBlocks.length - 1];
                  console.log('[BATTLE START] Ghost tower last block sample:', {
                    x: lastBlock.x,
                    y: lastBlock.y,
                    z: lastBlock.z,
                    width: lastBlock.width,
                    height: lastBlock.height,
                    depth: lastBlock.depth,
                    rotation: lastBlock.rotation,
                  });
                }
                setGhostTowerBlocks(nextGhostBlocks);
                setActiveTournamentMatch({
                  matchId: `match_${Date.now()}`,
                  opponent: {
                    ...matchOpponent!,
                    bestScore: selectedOpponentTower.score,
                  },
                  defeatedSessionId: selectedOpponentTower.sessionId, // Store for match reporting
                });
                // Set battle info for HUD display
                setCurrentBattleInfo({
                  opponentName: matchOpponent!.username,
                  opponentScore: selectedOpponentTower.score,
                });
                setShowStartScreen(false);
                console.log('[BATTLE START] 🚀 Calling gameStateHook.startGhost with replay data');
                gameStateHook.startGhost(ghostReplay);
                startGameHook(ghostReplay.gameMode as any);
                setViewingOpponent(false);
                setSelectedOpponentTower(null);
              } catch (e) {
                console.error('Failed to start battle:', e);
              }
            } else {
              // Try to find a match
              try {
                const match = await tournament.findMatch();
                if (match) {
                  // Fetch opponent towers
                  setMatchOpponent(match.opponent);
                  setViewingOpponent(true);
                  setSelectedOpponentTower(null);
                } else {
                  // No opponent found - stay on selection screen
                  console.log('No opponent found - staying on match selection');
                  setMatchOpponent(null);
                  setViewingOpponent(false);
                  setSelectedOpponentTower(null);
                  setGhostTowerBlocks(null);
                }
              } catch (e) {
                console.error('Error finding match:', e);
                // Fallback to practice mode on error
                setActiveTournamentMatch({
                  matchId: `practice_${Date.now()}`,
                  opponent: {
                    userId: 'practice',
                    username: 'Practice Mode',
                    elo: 0,
                  },
                });
                // Don't set battle info for practice mode
                setCurrentBattleInfo(null);
                setShowStartScreen(false);
                startGameHook(gameMode || 'rotating_block');
              }
            }
          } : undefined}
          onTowerSelect={leaderboardType === 'challenge' && viewingOpponent ? (tower) => {
            // Select this tower for battle
            console.log('[TOWER SELECT] 🎯 Tower selected:', tower.towerId);
            console.log('[TOWER SELECT] Tower score:', tower.score);
            console.log('[TOWER SELECT] Tower has replayData:', !!tower.replayData);
            if (tower.replayData) {
              console.log('[TOWER SELECT] Replay seed:', tower.replayData.seed);
              console.log('[TOWER SELECT] Replay inputs:', tower.replayData.inputs?.length || 0);
            }
            console.log(
              '[TOWER SELECT] Tower blocks count:',
              Array.isArray(tower.towerBlocks) ? tower.towerBlocks.length : 0
            );
            if (Array.isArray(tower.towerBlocks) && tower.towerBlocks.length > 0) {
              const lastBlock = tower.towerBlocks[tower.towerBlocks.length - 1];
              console.log('[TOWER SELECT] Tower last block sample:', {
                x: lastBlock.x,
                y: lastBlock.y,
                z: lastBlock.z,
                width: lastBlock.width,
                height: lastBlock.height,
                depth: lastBlock.depth,
                rotation: lastBlock.rotation,
              });
            }
            setSelectedOpponentTower(tower);
            setTargetUsername(tower.username);
          } : undefined}
          onRequestFullscreen={() => {
            try {
              requestExpandedMode();
            } catch (e) {
              console.warn('Fullscreen request failed:', e);
            }
          }}
          onExpand={async () => {
            if (leaderboardType === 'challenge') {
              // In challenge mode, onExpand is replaced by onBattle
              return;
            }
            setShowStartScreen(false);
            // REPLAY MODE DISABLED FOR THIS RELEASE
            // if (replayDataToWatch) {
            //   console.log('📼 Starting replay from inline expansion');
            //   startGameHook(replayDataToWatch.gameMode as any, undefined, replayDataToWatch);
            // } else {
            handleRestartGame();
            // }
          }}
        />
        {/* Tournament Entry Button - Top Left (Disabled for now) */}
        {/* <div style={{ position: 'absolute', top: 16, left: 16, zIndex: 10 }}>
          <button
            onClick={() => {
              setIsTournamentMenuOpen(true);
              tournament.fetchStatus();
            }}
            style={{
              background: 'rgba(0, 8, 20, 0.8)',
              border: '1px solid #00f2fe',
              color: '#00f2fe',
              padding: '8px 16px',
              fontFamily: '"Orbitron", monospace',
              fontSize: '12px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              boxShadow: '0 0 10px rgba(0, 242, 254, 0.2)'
            }}
          >
            <span>⚔</span>
            <span>TOURNAMENT</span>
          </button>
        </div> */}

        {/* Tournament Overlay (Can appear over start screen too) */}
        {false && (
          <TournamentOverlay
            status={tournament.status}
            loading={tournament.loading}
            error={tournament.error}
            isFindingMatch={tournament.isFindingMatch}
            currentMatch={tournament.currentMatch}
            onFindMatch={tournament.findMatch}
            onStartMatch={() => {
              if (tournament.currentMatch) {
                try {
                  // The ghost data is a JSON string of ReplayData
                  const ghostReplay = JSON.parse(tournament.currentMatch.opponent.ghostData);
                  setActiveTournamentMatch(tournament.currentMatch);
                  setIsTournamentMenuOpen(false);
                  setShowStartScreen(false);
                  // Start Ghost Mode
                  gameStateHook.startGhost(ghostReplay);
                  // Start Player Game (Standard Mode)
                  startGameHook(ghostReplay.gameMode as any);
                } catch (e) {
                  console.error("Failed to parse ghost data", e);
                }
              }
            }}
            onClose={() => setIsTournamentMenuOpen(false)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="relative w-full h-screen bg-gradient-to-b from-gray-900 via-slate-900 to-black overflow-hidden">
      {/* Tron Loading Screen */}
      {/* <TronLoadingScreen
        isLoading={isLoading}
        progress={isLoading ? 85 : 100}
        message="INITIALIZING GRID"
      /> */}

      {/* Three.js Canvas - render when game is playing OR when game is over (for tower display) */}
      {(() => {
        const hasActiveGame = gameStateHook.gameState && (gameStateHook.isPlaying || gameStateHook.gameState.isGameOver);
        const isViewingTower = playerTower && !showStartScreen;
        // Don't render main canvas if Game End Modal (InlineGridDisplay) is showing
        const shouldRender = (hasActiveGame || isViewingTower) && !showGameEndModal;
        return shouldRender;
      })() && (
          <Canvas
            dpr={canvasDpr} // Adaptive pixel ratio for better performance
            className="absolute inset-0"
            shadows={false} // Disable shadows for better performance
            gl={{
              antialias: false,
              // powerPreference: "high-performance",
              alpha: false,
              stencil: false,
              depth: true,
              logarithmicDepthBuffer: false,
              precision: "lowp",
            }}
            data-game-canvas="true"
            frameloop="always" // Keep always for game loop
          >
            <RendererLogger />
            <PerformanceConnector onRendererReady={setGlRenderer} />
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
              gameState={gameStateHook.gameState || (playerTower ? { isGameOver: true, blocks: [], score: 0, tick: 0, combo: 0, currentBlock: null, recentTrimEffects: [], perfectBlockCount: 0, maxCombo: 0, seed: 0 } as any : null)}
              gridSize={gameStateHook.gridSize}
              gridOffsetX={gameStateHook.gridOffsetX}
              gridOffsetZ={gameStateHook.gridOffsetZ}
              gridDensity={gameStateHook.gridDensity}
              gridLineWidth={gameStateHook.gridLineWidth}
              enableDebugWireframe={false}
              playerTower={playerTower}
              selectedTower={selectedTower?.tower || null}
              playerColorTheme={playerColorTheme}
              onCameraDebugUpdate={() => { }}
              onCameraReady={() => { }}
              onTowerClick={handleTowerClick}
              onTowerPlacementSave={async (sessionId, worldX, worldZ, gridX, gridZ) => {
                await updateTowerPlacement(sessionId, worldX, worldZ, gridX, gridZ);
              }}
              preAssignedTowers={preAssignedTowers}
              placementSystem={placementSystem}
              onRestartGame={handleRestartGame}
              stepSimulationFrame={gameStateHook.stepSimulationFrame}
              isPlaying={gameStateHook.isPlaying}
              timeScale={1.0}
              cameraRotationSpeed={cameraRotationSpeed}
              ghostState={gameStateHook.ghostState}
              ghostTowerBlocks={ghostTowerBlocks}
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
          {/* {console.log('🎮 App: Rendering GameUI condition met', {
            isLoading,
            isGameOver: gameStateHook.gameState?.isGameOver,
            isGridReviewOpen,
            currentBattleInfo: currentBattleInfo,
            isPlaying: gameStateHook.isPlaying,
            hasGameState: !!gameStateHook.gameState
          })} */}
          {/* {console.log('🎮 GameUI Props:', {
            hideHud: isTournamentMenuOpen,
            battleInfo: currentBattleInfo,
            isTournamentMenuOpen
          })} */}
          <GameUI
            gameState={gameStateHook}
            onShowTowerReview={handleOpenGridReview}
            isTowerReviewLoading={isTowerReviewLoading}
            towerReviewError={towerReviewError}
            playerColorChoice={playerColorChoice}
            playerColorTheme={playerColorTheme}
            onPlayerColorChange={handlePlayerColorChange}
            hideHud={isTournamentMenuOpen}
            battleInfo={currentBattleInfo}
          />
          {/* {console.log('🎮 GameUI Props: ', { hideHud: isTournamentMenuOpen, battleInfo: currentBattleInfo, isTournamentMenuOpen })} */}
        </>
      )}

      {/* TOURNAMENT OVERLAY */}
      {false && (
        <TournamentOverlay
          status={tournament.status}
          loading={tournament.loading}
          error={tournament.error}
          isFindingMatch={tournament.isFindingMatch}
          currentMatch={tournament.currentMatch}
          onFindMatch={tournament.findMatch}
          onStartMatch={() => {
            if (tournament.currentMatch) {
              try {
                // Fix: Backend sends raw JSON string, not Base64
                const ghostReplay = JSON.parse(tournament.currentMatch.opponent.ghostData);
                setActiveTournamentMatch(tournament.currentMatch);
                setIsTournamentMenuOpen(false);
                setShowStartScreen(false);

                // Explicitly start the main game AND the ghost
                // 'rotating_block' is hardcoded for now, should match tournament config
                startGameHook('rotating_block');

                // Small delay to ensure state is ready? 
                // No, hooks batch updates. But startGhost might rely on game being reset.
                // startGameHook resets the game.

                // We need to set ghost state AFTER start game clears everything.
                // But React batching might make this tricky.
                // Better to pass ghostReplay to startGameHook if supported?
                // Currently not supported.

                // Let's rely on standard concurrent execution.
                setTimeout(() => {
                  gameStateHook.startGhost(ghostReplay);
                }, 50);

              } catch (e) {
                console.error("Failed to parse ghost data", e);
              }
            }
          }}
          onClose={() => setIsTournamentMenuOpen(false)}
        />
      )}

      {/* 
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
          playerTower={playerTower}
        />
      )} */}



      {/* Success message for completed games */}
      {/* {lastSessionId && (
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
      )} */}

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
      {/* {selectedTower && !showGameEndModal && (
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
      )} */}

      {/* Performance Settings UI - Hidden for production */}
      {/* <PerformanceSettingsUI visible={showPerformanceSettings} /> */}
      {/* <PerformanceDisplay /> */}

      {/* TournamentResultModal - Disabled */}
      {/* <TournamentResultModal
        isVisible={!!tournamentResultData}
        result={tournamentResultData?.result || null}
        score={tournamentResultData?.score || 0}
        blocks={tournamentResultData?.blocks || 0}
        perfectStreak={tournamentResultData?.perfectStreak || 0}
        maxCombo={tournamentResultData?.maxCombo || 0}
        opponentName={tournamentResultData?.opponentName || ''}
        opponentScore={tournamentResultData?.opponentScore || 0}
        eloChange={tournamentResultData?.eloChange || 0}
        newElo={tournamentResultData?.newElo || 0}
        ticketsRemaining={tournamentResultData?.ticketsRemaining ?? null}
        onContinue={() => {
          setTournamentResultData(null);
          setShowGameEndModal(true);
          setIsTournamentMenuOpen(false);
          // Clear active match when continuing
          setActiveTournamentMatch(null);
          setCurrentBattleInfo(null);
        }}
        onRetry={() => {
          setTournamentResultData(null);
          setIsTournamentMenuOpen(true);
          setShowGameEndModal(false);
          // Clear active match when retrying
          setActiveTournamentMatch(null);
          setCurrentBattleInfo(null);
        }}
      /> */}

      {/* Game End Screen - Reusing InlineGridDisplay */}
      {showGameEndModal && (
        <div className="absolute inset-0 z-50 bg-black w-full h-full">
          <InlineGridDisplay
            preAssignedTowers={leaderboardType === 'challenge'
              ? (viewingOpponent ? opponentTowers : tournamentTowers)
              : preAssignedTowers}
            placementSystem={placementSystem}
            playerTower={leaderboardType === 'challenge' && viewingOpponent ? null : playerTower}
            targetUsername={targetUsername}
            playerColorChoice={playerColorChoice}
            onPlayerColorChange={handlePlayerColorChange}
            leaderboardType={leaderboardType}
            onLeaderboardTypeChange={setLeaderboardType}
            totalCount={leaderboardType === 'challenge' ? (viewingOpponent ? opponentTowers.length : tournamentTowers.length) : totalCount}
            currentCycleId={currentCycleId}
            onCycleChange={setCurrentCycleId}
            challengeTicketCount={tournament.status?.tickets ?? null}
            challengeSeasonLabel={challengeSeasonLabel}
            currentPlayerElo={leaderboardType === 'challenge' ? tournament.status?.elo ?? null : null}
            currentPlayerRank={leaderboardType === 'challenge' ? tournament.status?.rank ?? null : null}
            opponentInfo={leaderboardType === 'challenge' && matchOpponent ? {
              username: matchOpponent.username,
              elo: matchOpponent.elo,
              rank: matchOpponent.rank
            } : null}
            defeatedTowerIds={leaderboardType === 'challenge' ? defeatedTowerIds : undefined}
            battleLabel={leaderboardType === 'challenge' ? (viewingOpponent ? (selectedOpponentTower ? 'START BATTLE' : 'Select a tower') : 'Find Match') : undefined}
            onTowerSelect={leaderboardType === 'challenge' && viewingOpponent ? (tower) => {
              console.log('[TOWER SELECT - MODAL] 🎯 Tower selected:', tower.towerId);
              setSelectedOpponentTower(tower);
              setTargetUsername(tower.username);
            } : undefined}
            onBattle={leaderboardType === 'challenge' ? async () => {
              if (viewingOpponent) {
                // User must select a tower before battle
                if (!selectedOpponentTower) {
                  console.log('Please select an opponent tower first');
                  return;
                }

                // Start battle with selected opponent tower
                try {
                  // Use the replayData from the tower object directly
                  const ghostReplay = selectedOpponentTower.replayData;

                  console.log('[BATTLE START - MODAL] 🎮 Starting battle with selected opponent tower');
                  console.log('[BATTLE START - MODAL] Tower ID:', selectedOpponentTower.towerId);
                  console.log('[BATTLE START - MODAL] Tower Score:', selectedOpponentTower.score);
                  console.log('[BATTLE START - MODAL] Replay Data exists:', !!ghostReplay);
                  if (ghostReplay) {
                    console.log('[BATTLE START - MODAL] Replay seed:', ghostReplay.seed);
                    console.log('[BATTLE START - MODAL] Replay inputs count:', ghostReplay.inputs?.length || 0);
                    console.log('[BATTLE START - MODAL] Replay gameMode:', ghostReplay.gameMode);
                  }

                  if (!ghostReplay) throw new Error('No replay data found');

                  // CRITICAL: Reset game state FIRST to clear any previous ghost/game data
                  gameStateHook.resetGame();

                  // Start the match with updated opponent info including the tower's score
                  const nextGhostBlocks = Array.isArray(selectedOpponentTower.towerBlocks)
                    ? selectedOpponentTower.towerBlocks
                    : null;
                  console.log('[BATTLE START - MODAL] Ghost tower blocks set:', {
                    hasBlocks: !!nextGhostBlocks,
                    count: nextGhostBlocks?.length ?? 0,
                  });
                  if (nextGhostBlocks && nextGhostBlocks.length > 0) {
                    const lastBlock = nextGhostBlocks[nextGhostBlocks.length - 1];
                    console.log('[BATTLE START - MODAL] Ghost tower last block sample:', {
                      x: lastBlock.x,
                      y: lastBlock.y,
                      z: lastBlock.z,
                      width: lastBlock.width,
                      height: lastBlock.height,
                      depth: lastBlock.depth,
                      rotation: lastBlock.rotation,
                    });
                  }
                  setGhostTowerBlocks(nextGhostBlocks);
                  setActiveTournamentMatch({
                    matchId: `match_${Date.now()}`,
                    opponent: {
                      ...matchOpponent!,
                      bestScore: selectedOpponentTower.score,
                    },
                    defeatedSessionId: selectedOpponentTower.sessionId, // Store for match reporting
                  });
                  setCurrentBattleInfo({
                    opponentName: selectedOpponentTower.username,
                    opponentScore: selectedOpponentTower.score,
                  });
                  setShowStartScreen(false);
                  setShowGameEndModal(false);
                  setIsTournamentMenuOpen(false);
                  console.log('[BATTLE START - MODAL] 🚀 Calling gameStateHook.startGhost with replay data');
                  gameStateHook.startGhost(ghostReplay);
                  startGameHook(ghostReplay.gameMode as any);
                  setViewingOpponent(false);
                  setSelectedOpponentTower(null);
                } catch (e) {
                  console.error('Failed to start battle:', e);
                }
              } else {
                // Find a match
                try {
                  console.log('[MATCHMAKING] UI requested findMatch (modal)', {
                    hasStatus: !!tournament.status,
                    tickets: tournament.status?.tickets ?? null,
                    isFindingMatch: tournament.isFindingMatch,
                  });
                  if (!tournament.status) {
                    console.log('[MATCHMAKING] Blocked: status not ready (fetching status)');
                    await tournament.fetchStatus();
                    return;
                  }
                  if ((tournament.status?.tickets ?? 0) <= 0) {
                    console.log('[MATCHMAKING] Blocked: no tickets available');
                    return;
                  }
                  const match = await tournament.findMatch();
                  if (match) {
                    // Fetch opponent towers
                    setMatchOpponent(match.opponent);
                    setViewingOpponent(true);
                    setSelectedOpponentTower(null);
                  } else {
                    if (tournament.error) {
                      console.log('[MATCHMAKING] Failed to find match:', tournament.error);
                      return;
                    }
                    // No opponent found - stay on selection screen
                    console.log('No opponent found - staying on match selection');
                    setMatchOpponent(null);
                    setViewingOpponent(false);
                    setSelectedOpponentTower(null);
                    setGhostTowerBlocks(null);
                  }
                } catch (e) {
                  console.error('Error finding match:', e);
                }
              }
            }
              : undefined}
            bottomControls={
              <GameEndControls
                onPlayAgain={leaderboardType === 'challenge'
                  ? () => {
                    // Run find-match flow directly
                    (async () => {
                      console.log('[PLAY AGAIN] UI requested findMatch (challenge mode)', {
                        hasStatus: !!tournament.status,
                        tickets: tournament.status?.tickets ?? null,
                        isFindingMatch: tournament.isFindingMatch,
                      });
                      if (!tournament.status) {
                        console.log('[PLAY AGAIN] Blocked: status not ready (fetching status)');
                        await tournament.fetchStatus();
                        return;
                      }
                      if ((tournament.status?.tickets ?? 0) <= 0) {
                        console.log('[PLAY AGAIN] Blocked: no tickets available');
                        return;
                      }
                      const match = await tournament.findMatch();
                      if (match) {
                        // Fetch opponent towers and transition to tower selection
                        setMatchOpponent(match.opponent);
                        setViewingOpponent(true);
                        setSelectedOpponentTower(null);
                      } else {
                        if (tournament.error) {
                          console.log('[PLAY AGAIN] Failed to find match:', tournament.error);
                          return;
                        }
                        // No opponent found - stay on selection screen
                        console.log('No opponent found - staying on match selection');
                        setMatchOpponent(null);
                        setViewingOpponent(false);
                        setSelectedOpponentTower(null);
                        setGhostTowerBlocks(null);
                      }
                    })();
                  }
                  : handleRestartGame
                }
                playAgainLabel={leaderboardType === 'challenge' ? "NEW MATCH" : "TRY AGAIN"}
                onShare={() => {
                  handleShare({
                    sessionId: gameEndData?.sessionId || playerTower?.sessionId || '',
                    score: gameStateHook.gameState?.score || playerTower?.score || 0,
                    blocks:
                      gameStateHook.gameState?.blocks.length || playerTower?.blockCount || 0,
                    perfectStreak:
                      gameStateHook.gameState?.perfectBlockCount ||
                      playerTower?.perfectStreak ||
                      0,
                    username: targetUsername || 'PLAYER',
                    rank: gameEndData?.rank,
                    totalPlayers: gameEndData?.totalPlayers,
                    madeTheGrid: gameEndData?.madeTheGrid,
                  });
                }}
                onViewTower={() => {
                  // Just focus on the player tower within the modal
                  // We don't close the modal because the modal IS the grid view now
                  if (playerTower) {
                    // InlineGridDisplay will handle focus if we pass it, but currently it manages its own focus state.
                    // However, we can force a re-render or update by ensuring playerTower is set.
                    // Since InlineGridDisplay has an effect to update focus when playerTower changes,
                    // we might need to ensure it knows we want to focus it.
                    // But actually, the user wants to "View Tower" which implies zooming in.
                    // InlineGridDisplay's camera controller handles zooming to `selectedTower`.
                    // If we want to "reset" the view to the player tower, we might need a way to signal that.
                    // For now, let's just NOT close the modal, as that was the bug.
                    // And maybe we can trigger a focus update if needed.
                    console.log('Focusing on player tower in grid view');
                  }
                }}
                isSharing={isSharing}
                isSavingSession={isSavingSession}
                hasSharedSuccessfully={hasSharedSuccessfully}
                // Challenge mode props
                isViewingOpponent={leaderboardType === 'challenge' && viewingOpponent}
                selectedTowerForBattle={leaderboardType === 'challenge' ? selectedOpponentTower : undefined}
                isFindingMatch={leaderboardType === 'challenge' ? tournament.isFindingMatch : undefined}
                challengeTicketCount={leaderboardType === 'challenge' ? tournament.status?.tickets ?? null : null}
                onBattle={leaderboardType === 'challenge' && viewingOpponent ? async () => {
                  if (!selectedOpponentTower) {
                    console.log('Please select an opponent tower first');
                    return;
                  }

                  try {
                    const ghostReplay = selectedOpponentTower.replayData;

                    console.log('[BATTLE START] 🎮 Starting battle with selected opponent tower');
                    console.log('[BATTLE START] Tower ID:', selectedOpponentTower.towerId);
                    console.log('[BATTLE START] Tower Score:', selectedOpponentTower.score);
                    console.log('[BATTLE START] Replay Data exists:', !!ghostReplay);

                    if (!ghostReplay) throw new Error('No replay data found');

                    gameStateHook.resetGame();

                    const nextGhostBlocks = Array.isArray(selectedOpponentTower.towerBlocks)
                      ? selectedOpponentTower.towerBlocks
                      : null;
                    setGhostTowerBlocks(nextGhostBlocks);
                    setActiveTournamentMatch({
                      matchId: `match_${Date.now()}`,
                      opponent: {
                        ...matchOpponent!,
                        bestScore: selectedOpponentTower.score,
                      },
                      defeatedSessionId: selectedOpponentTower.sessionId, // Store for match reporting
                    });
                    console.log('[GAME END CONTROLS BATTLE] Setting currentBattleInfo:', {
                      opponentName: selectedOpponentTower.username,
                      opponentScore: selectedOpponentTower.score,
                    });
                    setCurrentBattleInfo({
                      opponentName: selectedOpponentTower.username,
                      opponentScore: selectedOpponentTower.score,
                    });
                    console.log('[GAME END CONTROLS BATTLE] Closing modal and tournament menu');
                    setShowGameEndModal(false);
                    setIsTournamentMenuOpen(false);
                    gameStateHook.startGhost(ghostReplay);
                    startGameHook(ghostReplay.gameMode as any);
                    setViewingOpponent(false);
                    setSelectedOpponentTower(null);
                  } catch (e) {
                    console.error('Failed to start battle:', e);
                  }
                } : undefined}
              />
            }
          />
        </div>
      )}

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
