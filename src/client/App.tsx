import React from 'react';
import { Canvas } from '@react-three/fiber';
import { GameUI } from './components/ui/GameUI';
import { useGameState } from './hooks/useGameState';
import { GameScene } from './components/game/GameScene_Simple';
import { useGameData } from './hooks/useGameData';
import { useCommunityGrid } from './hooks/useCommunityGrid';
import {
  TowerPlacementSystem,
  DEFAULT_TOWER_GRID_OFFSET,
  DEFAULT_TOWER_GRID_RADIUS,
  DEFAULT_TOWER_GRID_SIZE,
} from '../shared/types/towerPlacement';
import { ChunkLoadingIndicator } from './components/ui/ChunkLoadingIndicator';
import type {
  FindMatchResponse,
  ShareSessionRequest,
  ShareSessionResponse,
  ReplayData,
  TowerMapEntry,
  TournamentLeaderboardResponse,
  PlayerRegion,
} from '../shared/types/api';
import { useThree } from '@react-three/fiber';
import { InlineGridDisplay, ViewMode } from './components/ui/InlineGridDisplay';
import { useTournament } from './hooks/useTournament';
import { usePlayerGrid } from './hooks/usePlayerGrid';
import { useViewState } from './hooks/useViewState';
import { TournamentOverlay } from './components/ui/TournamentOverlay';
import { EloLeaderboardOverlay } from './components/ui/EloLeaderboardOverlay';

import { enableServerLogging } from './utils/serverLogger';
import { computeGridRadiusForCapacity, MAX_VISIBLE_TOWERS } from '../shared/constants/towers';
import {
  PLAYER_COLOR_STORAGE_KEY,
  PlayerColorChoice,
  PlayerColorTheme,
  getPlayerColorTheme,
  isPlayerColorChoice,
} from './constants/playerColors';
import { GameEndControls } from './components/ui/GameEndControls';

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

  // Home grid placement. Runs immediately after a tower fails: the player positions the tower
  // they just built, then confirms. Every interaction is a button, because inline posts permit
  // tap input only -- no drag, scroll or pinch.
  const playerGrid = usePlayerGrid();
  // Placement is a mode of the grid now, so all it needs is a flag. This used to be a hook
  // owning a cursor, camera zoom and rotation -- all of which the grid itself now provides.
  const [isPlacementActive, setIsPlacementActive] = React.useState(false);
  const [pendingPlacementSessionId, setPendingPlacementSessionId] = React.useState<string | null>(
    null
  );
  const [isPlacing, setIsPlacing] = React.useState(false);
  // The player's buildable area in the shared grid, and what already occupies its cells.
  // Both come from the server, which is also what enforces them.
  const [playerRegion, setPlayerRegion] = React.useState<PlayerRegion | null>(null);
  const [placementCells, setPlacementCells] = React.useState<
    ReadonlyMap<string, { count: number; height: number }>
  >(new Map());

  // One source of truth for which screen is showing. Replaces six independent booleans that
  // had no rule keeping them exclusive and nearly all rendered at z-50, so what ended up on
  // top was source order rather than intent.
  const viewState = useViewState('start');

  // Tournament Hook
  const tournament = useTournament();
  // Derived from the view machine. The names are kept because they read well at the call
  // sites; what changed is that they can no longer disagree with one another.
  const isTournamentMenuOpen = viewState.isOverlayOpen('tournament');
  const setIsTournamentMenuOpen = (open: boolean) =>
    open ? viewState.openOverlay('tournament') : viewState.closeOverlay('tournament');
  const [activeTournamentMatch, setActiveTournamentMatch] = React.useState<{ matchId: string; opponent: FindMatchResponse['opponent']; defeatedSessionId?: string } | null>(null);
  const isEloLeaderboardOpen = viewState.isOverlayOpen('eloLeaderboard');
  const setIsEloLeaderboardOpen = (open: boolean) =>
    open ? viewState.openOverlay('eloLeaderboard') : viewState.closeOverlay('eloLeaderboard');
  const [eloLeaderboard, setEloLeaderboard] = React.useState<TournamentLeaderboardResponse | null>(null);
  const [isEloLeaderboardLoading, setIsEloLeaderboardLoading] = React.useState(false);
  const [eloLeaderboardError, setEloLeaderboardError] = React.useState<string | null>(null);
  const [isLeaderboardPostView, setIsLeaderboardPostView] = React.useState(false);
  const hasEnteredGridRef = React.useRef(false);
  const [eloLeaderboardView, setEloLeaderboardView] = React.useState<'top' | 'around'>('around');
  const [eloLeaderboardPage, setEloLeaderboardPage] = React.useState(1);
  const eloLeaderboardViewRef = React.useRef<'top' | 'around'>('around');
  const eloLeaderboardPageRef = React.useRef(1);

  React.useEffect(() => {
    eloLeaderboardViewRef.current = eloLeaderboardView;
  }, [eloLeaderboardView]);

  React.useEffect(() => {
    eloLeaderboardPageRef.current = eloLeaderboardPage;
  }, [eloLeaderboardPage]);
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

  const reportedTournamentMatchIdsRef = React.useRef<Set<string>>(new Set());

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

  const [targetUsername, setTargetUsername] = React.useState<string | null>(null);


  const loadSessionData = React.useCallback(async (sessionId: string, _replayData?: ReplayData) => {
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
            const coord = coords[index]!;
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

        // Keep start screen (InlineGridDisplay) visible for shared posts,
        // unless the user has already entered the grid while async data was loading.
        if (!hasEnteredGridRef.current) {
          viewState.goTo('start');
        }
        viewState.goTo('playing');

      } else {
        console.warn('⚠️ Session data fetch returned null for ID:', sessionId);
      }
    } catch (e) {
      console.error('❌ Error loading session data:', e);
    }
  }, [getGameSession, placementSystem]);

  const loadEloLeaderboard = React.useCallback(async (override?: {
    view?: 'top' | 'around';
    page?: number;
  }) => {
    setIsEloLeaderboardLoading(true);
    setEloLeaderboardError(null);
    try {
      const nextView = override?.view ?? eloLeaderboardViewRef.current;
      const nextPage = override?.page ?? eloLeaderboardPageRef.current;

      const data = await tournament.fetchEloLeaderboard({
        view: nextView,
        page: nextPage,
        pageSize: 5,
      });
      if (!data) {
        setEloLeaderboardError('Could not load Elo rankings.');
        return;
      }
      setEloLeaderboard(data);
      setEloLeaderboardView(data.view);
      setEloLeaderboardPage(data.page);
    } catch (e) {
      setEloLeaderboardError('Could not load Elo rankings.');
    } finally {
      setIsEloLeaderboardLoading(false);
    }
  }, [tournament]);

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

          if (data.leaderboardView === true) {
            setIsLeaderboardPostView(true);
            setEloLeaderboardView('around');
            setEloLeaderboardPage(1);
            setIsEloLeaderboardOpen(true);
            viewState.goTo('leaderboardPost');
            viewState.openOverlay('eloLeaderboard');
            await loadEloLeaderboard({ view: 'around', page: 1 });
          }

          if (data.sessionId) {
            await loadSessionData(data.sessionId, data.replayData);
          }
        }
      } catch (e) {
        console.error('Failed to fetch init data:', e);
      }
    };

    fetchInitData();
  }, [loadSessionData, loadEloLeaderboard]);

  React.useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      if (event.data && event.data.type === 'INIT_CONTEXT') {
        const { username, replayData, sessionId } = event.data.payload;

        if (username) {
          setTargetUsername(username);
        }
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
  // Read only by the disabled save toast below; the setter is still live.
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
  const cameraRotationSpeed = 1;
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
  const showGameEndModal = viewState.isGridView;
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
  const showConfirmModal = viewState.isOverlayOpen('confirmReset');
  const setShowConfirmModal = (open: boolean) =>
    open ? viewState.openOverlay('confirmReset') : viewState.closeOverlay('confirmReset');

  // Session saving state
  const [isSavingSession, setIsSavingSession] = React.useState(false);

  // Start screen state (replaces inline/expanded mode check)
  const showStartScreen = viewState.is('start');

  // Start-screen grid review state

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
  const [matchOpponent, setMatchOpponent] = React.useState<FindMatchResponse['opponent'] | null>(null);
  const [defeatedTowerIds, setDefeatedTowerIds] = React.useState<Set<string>>(new Set());
  const challengeTowerFetchRef = React.useRef<{ inFlightKey: string | null; completedKey: string | null }>({
    inFlightKey: null,
    completedKey: null,
  });

  // Tower preloader hook
  // Towers come from placements now, already positioned. Nothing to assign on the client.
  const communityGrid = useCommunityGrid();
  const {
    towers: preAssignedTowers,
    isLoading: isTowerReviewLoading,
    error: towerReviewError,
    totalCount,
    refresh: preloadAndAssignTowers,
    clear: clearPreloadedTowers,
  } = communityGrid;

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
    // No rehydration of occupied cells here any more. Towers arrive from the server already
    // positioned at the cells their owners chose, so there is nothing for the client to
    // reserve -- and reserving here is what used to overwrite those choices.
  }, [gameStateHook.gridSize, gameStateHook.gridOffsetX, gameStateHook.gridOffsetZ, gameStateHook.gridDensity, placementSystem, totalCount]);

  const { fetchMyTournamentTowers, fetchOpponentTowers } = tournament;

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
    const challengeFetchKey =
      leaderboardType === 'challenge'
        ? `${showStartScreen ? 'start' : 'modal'}:${viewingOpponent && matchOpponent?.userId ? `opponent:${matchOpponent.userId}` : 'self'}`
        : null;

    if (showStartScreen || showGameEndModal) {
      if (leaderboardType === 'challenge') {
        if (challengeFetchKey) {
          const { inFlightKey, completedKey } = challengeTowerFetchRef.current;
          if (inFlightKey === challengeFetchKey || completedKey === challengeFetchKey) {
            return;
          }
          challengeTowerFetchRef.current.inFlightKey = challengeFetchKey;
        }

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
            if (challengeFetchKey) {
              challengeTowerFetchRef.current.completedKey = challengeFetchKey;
            }
          } catch (e) {
            console.error('Failed to load challenge towers:', e);
            if (challengeFetchKey) {
              challengeTowerFetchRef.current.completedKey = null;
            }
          } finally {
            if (challengeFetchKey && challengeTowerFetchRef.current.inFlightKey === challengeFetchKey) {
              challengeTowerFetchRef.current.inFlightKey = null;
            }
          }
        };

        fetchChallengeTowers();
      } else {
        challengeTowerFetchRef.current.inFlightKey = null;
        challengeTowerFetchRef.current.completedKey = null;
        // Regular leaderboard mode
        preloadAndAssignTowers();
      }
    } else {
      challengeTowerFetchRef.current.inFlightKey = null;
      challengeTowerFetchRef.current.completedKey = null;
    }
  }, [showStartScreen, showGameEndModal, leaderboardType, viewingOpponent, matchOpponent, preloadAndAssignTowers, playerTower, currentCycleId, fetchMyTournamentTowers, fetchOpponentTowers, assignPositionsToChallengeTowers]);

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
      viewState.goTo('playing'); // Hide modal when starting new game
      setGameEndData(null); // Clear game end data
      setHasSharedSuccessfully(false);
    }

    prevIsPlayingRef.current = isCurrentlyPlaying;
  }, [gameStateHook.isPlaying, gameStateHook.gameState?.isGameOver, clearPreloadedTowers]);

  const handleConfirmPlacement = React.useCallback(async (gridX: number, gridZ: number) => {
    if (!pendingPlacementSessionId) return;

    setIsPlacing(true);
    try {
      const placed = await playerGrid.placeTower(pendingPlacementSessionId, gridX, gridZ);
      // On failure the hook has already surfaced the server's reason, and placement mode stays
      // open so the player can pick a different cell rather than losing the tower.
      if (placed) {
        setIsPlacementActive(false);
        setPendingPlacementSessionId(null);
        // Land on the player's own grid so the tower they just placed is visible. Returning to
        // the community grid made a successful placement look like it had done nothing.
        await playerGrid.fetchGridTowers();
        viewState.goTo('grid');
      }
    } finally {
      setIsPlacing(false);
    }
  }, [pendingPlacementSessionId, playerGrid, viewState]);

  const handleCancelPlacement = React.useCallback(() => {
    // Skipping placement is allowed -- the tower still exists and can be placed later from the
    // grid view. Nothing is destroyed here.
    setIsPlacementActive(false);
    setPendingPlacementSessionId(null);
    playerGrid.clearError();
    viewState.goTo('grid');
  }, [playerGrid, viewState]);

  // Leave the play screen when a run ends.
  //
  // Guarded on being *on* the playing view, not on a derived "is a grid showing" boolean.
  // That distinction is the whole bug this replaces: showGameEndModal is now derived from the
  // view (community || myGrid), so it goes false the moment placement opens. Keying the effect
  // off it meant entering placement re-triggered this and yanked the player straight back to
  // the community grid within a frame -- placement was unreachable, and every run ended
  // looking exactly like it did before any of this existed.
  //
  // Phrased as a one-way transition out of 'playing', it can only fire once per run.
  React.useEffect(() => {
    if (gameStateHook.gameState?.isGameOver && viewState.is('playing')) {
      setSelectedTower(null);
      viewState.goTo('grid');
    }
  }, [gameStateHook.gameState?.isGameOver, viewState]);

  React.useEffect(() => {
    if (gameStateHook.isPlaying) {
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

            // The run is over and the tower is saved -- this is the moment to place it.
            // One round trip gets both halves: the grid, so the cursor can report what's in
            // each cell (empty, stackable, full), and the towers themselves, so the scene shows
            // the player's own board rather than the community grid they were just browsing.
            setPendingPlacementSessionId(result.sessionId);
            const { grid: existingGrid, region } = await playerGrid.fetchGridTowers();
            setPlayerRegion(region);
            // Cell occupancy, derived once so the grid can report "stacking on 2" without
            // recomputing per tap. Heights are fixed-point; the scene works in world units.
            const cells = new Map<string, { count: number; height: number }>();
            for (const p of existingGrid?.placements ?? []) {
              const key = `${p.gridX},${p.gridZ}`;
              const prev = cells.get(key);
              cells.set(key, {
                count: (prev?.count ?? 0) + 1,
                height: (prev?.height ?? 0) + p.height / 1000,
              });
            }
            setPlacementCells(cells);
            setIsPlacementActive(true);
            viewState.goTo('grid');

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

  const handleGameEnd = async (sessionId: string, _rank?: number | null) => {
    setHasSharedSuccessfully(false);
    console.log('Game completed! Session saved:', sessionId);

    // Get the saved session data to create tower entry
    try {
      const sessionData = await getGameSession(sessionId);
      if (sessionData && gameStateHook.gameState) {
        // No position is assigned here. This used to auto-place the tower by score rank and
        // persist that immediately -- before placement mode ever opened -- so the cell the
        // player then chose was overwritten before they chose it, and the grid rendered the
        // rank-assigned position instead. A tower now has no position until it is placed.
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
        };

        // Held for the placement flow to draw as a ghost. It reaches the grid only once the
        // player commits it.
        setPlayerTower(towerEntry);
      }
    } catch (error) {
      console.error('Failed to load session data:', error);
    }
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

  /**
   * "Tower review" from the start screen.
   *
   * This used to flip an isGridReviewOpen flag whose overlay had already been commented out,
   * so pressing it hid the HUD and showed nothing at all. It now goes to the community grid,
   * which is what the button was always describing.
   */
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
      viewState.goTo('grid');
    }
  }, [preAssignedTowers, isTowerReviewLoading, preloadAndAssignTowers, viewState]);

  // Game end modal handlers
  const handleRestartGame = React.useCallback(() => {
    const mode = gameMode ?? 'rotating_block';
    resetGameHook();
    startGameHook(mode);
    setSelectedTower(null);
    setPlayerTower(null);
    setGhostTowerBlocks(null);
    setGameEndData(null);
    viewState.goTo('playing');
    setCurrentBattleInfo(null); // Clear battle info when restarting
  }, [gameMode, resetGameHook, startGameHook]);

  const handleShare = React.useCallback(
    async (sessionData: ShareSessionRequest) => {
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
        viewState.goTo('playing');
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
      const matchId = activeTournamentMatch.matchId;
      if (!matchId) {
        return;
      }

      if (reportedTournamentMatchIdsRef.current.has(matchId)) {
        console.log('[TOURNAMENT REPORT] Skipping duplicate report for match:', matchId);
        return;
      }

      reportedTournamentMatchIdsRef.current.add(matchId);
      console.log("🏆 Tournament Match Ended. Reporting...");

      // Check if this is a practice match (no real opponent)
      if (activeTournamentMatch.opponent.userId === 'practice') {
        // Practice mode - no ELO change, and nothing to report to the server
        console.log("Practice mode - saving score without ELO");
      } else {
        // Real match - report with ELO calculation
        const result = gameStateHook.gameState.score > (activeTournamentMatch.opponent.bestScore || 0) ? 'win' : 'loss';

        tournament.reportMatch(result, gameStateHook.gameState.score, activeTournamentMatch.defeatedSessionId).then(res => {
          console.log("Match Reported:", res);
          if (res) {
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
          } else {
            // Allow retry on a future state transition if report failed
            reportedTournamentMatchIdsRef.current.delete(matchId);
          }
        }).catch((error) => {
          console.error('[TOURNAMENT REPORT] reportMatch failed:', error);
          // Allow retry on a future state transition if report failed
          reportedTournamentMatchIdsRef.current.delete(matchId);
        });
      }

      // Don't clear activeTournamentMatch here - keep it for the game end modal
      // It will be cleared when user clicks Continue to go back to start screen
    }
  }, [
    gameStateHook.gameState?.isGameOver,
    gameStateHook.gameState?.score,
    gameStateHook.gameState?.blocks,
    gameStateHook.gameState?.perfectBlockCount,
    gameStateHook.gameState?.maxCombo,
    activeTournamentMatch,
    tournament.reportMatch,
    tournament.status?.tickets,
  ]);

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
                  const lastBlock = nextGhostBlocks[nextGhostBlocks.length - 1]!;
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
                viewState.goTo('playing');
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
                    rank: 'N/A',
                    elo: 0,
                  },
                });
                // Don't set battle info for practice mode
                setCurrentBattleInfo(null);
                viewState.goTo('playing');
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
              const lastBlock = tower.towerBlocks[tower.towerBlocks.length - 1]!;
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
          // InlineGridDisplay issues the expanded-mode request itself (it needs the
          // trusted click event); this prop only gates whether the button is shown.
          onRequestFullscreen={() => {}}
          onExpand={async () => {
            if (leaderboardType === 'challenge') {
              // In challenge mode, onExpand is replaced by onBattle
              return;
            }
            hasEnteredGridRef.current = true;
            viewState.goTo('playing');
            handleRestartGame();
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
                  // The ghost data is a JSON string of ReplayData (absent for practice matches)
                  const ghostData = tournament.currentMatch.opponent.ghostData;
                  if (!ghostData) {
                    throw new Error('Match has no ghost data');
                  }
                  const ghostReplay = JSON.parse(ghostData);
                  setActiveTournamentMatch(tournament.currentMatch);
                  setIsTournamentMenuOpen(false);
                  viewState.goTo('playing');
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

  if (isLeaderboardPostView) {
    return (
      <div className="w-full h-screen bg-slate-950 overflow-hidden">
        <EloLeaderboardOverlay
          isOpen={true}
          loading={isEloLeaderboardLoading}
          error={eloLeaderboardError}
          data={eloLeaderboard}
          onViewChange={(view) => {
            setEloLeaderboardView(view);
            setEloLeaderboardPage(1);
            loadEloLeaderboard({ view, page: 1 });
          }}
          onPreviousPage={() => {
            if (!eloLeaderboard || eloLeaderboard.view !== 'top') return;
            const previousPage = Math.max(1, eloLeaderboard.page - 1);
            setEloLeaderboardPage(previousPage);
            loadEloLeaderboard({ view: 'top', page: previousPage });
          }}
          onNextPage={() => {
            if (!eloLeaderboard || eloLeaderboard.view !== 'top') return;
            const nextPage = Math.min(eloLeaderboard.totalPages, eloLeaderboard.page + 1);
            setEloLeaderboardPage(nextPage);
            loadEloLeaderboard({ view: 'top', page: nextPage });
          }}
          standalone={true}
        />
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
        // Suppress this canvas on every screen that brings its own.
        //
        // This used to test !showGameEndModal, which covered the community grid but not the
        // placement or home-grid screens -- both added later, and both false under that check.
        // The result was two live WebGL contexts stacked on top of each other: invisible, but
        // both rendering every frame, which mobile GPUs will not forgive.
        const gridScreenShowing =
          viewState.isGridView;
        const shouldRender = (hasActiveGame || isViewingTower) && !gridScreenShowing;
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
      {devToolsEnabled && (
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
      {!isLeaderboardPostView && (
        <button
          onClick={() => {
            if (isEloLeaderboardOpen) {
              setIsEloLeaderboardOpen(false);
              return;
            }

            setIsEloLeaderboardOpen(true);
            setEloLeaderboardView('around');
            setEloLeaderboardPage(1);
            loadEloLeaderboard({ view: 'around', page: 1 });
          }}
          className="absolute top-4 left-4 z-50 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200"
          style={{
            background: 'rgba(0, 8, 20, 0.85)',
            color: '#00f2fe',
            border: '1px solid rgba(0, 242, 254, 0.6)',
            backdropFilter: 'blur(10px)',
          }}
        >
          🏆 Leaderboard
        </button>
      )}

      <ChunkLoadingIndicator
        loadingChunks={loadingChunks}
        totalChunks={9} // 3x3 grid around camera
        cameraPosition={cameraPos}
      />

      {/* UI Overlay */}
      {!isLoading && !gameStateHook.gameState?.isGameOver && (
        <>
          {/* {console.log('🎮 App: Rendering GameUI condition met', {
            isLoading,
            isGameOver: gameStateHook.gameState?.isGameOver,
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
                // Fix: Backend sends raw JSON string, not Base64 (absent for practice matches)
                const ghostData = tournament.currentMatch.opponent.ghostData;
                if (!ghostData) {
                  throw new Error('Match has no ghost data');
                }
                const ghostReplay = JSON.parse(ghostData);
                setActiveTournamentMatch(tournament.currentMatch);
                setIsTournamentMenuOpen(false);
                viewState.goTo('playing');

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

      {/* Game End Screen - Reusing InlineGridDisplay */}
      <EloLeaderboardOverlay
        isOpen={isEloLeaderboardOpen}
        loading={isEloLeaderboardLoading}
        error={eloLeaderboardError}
        data={eloLeaderboard}
        onViewChange={(view) => {
          setEloLeaderboardView(view);
          setEloLeaderboardPage(1);
          loadEloLeaderboard({ view, page: 1 });
        }}
        onPreviousPage={() => {
          if (!eloLeaderboard || eloLeaderboard.view !== 'top') return;
          const previousPage = Math.max(1, eloLeaderboard.page - 1);
          setEloLeaderboardPage(previousPage);
          loadEloLeaderboard({ view: 'top', page: previousPage });
        }}
        onNextPage={() => {
          if (!eloLeaderboard || eloLeaderboard.view !== 'top') return;
          const nextPage = Math.min(eloLeaderboard.totalPages, eloLeaderboard.page + 1);
          setEloLeaderboardPage(nextPage);
          loadEloLeaderboard({ view: 'top', page: nextPage });
        }}
      />

      {viewState.is('grid') && (
        <div className="absolute inset-0 z-50 bg-black w-full h-full">
          <InlineGridDisplay
            preAssignedTowers={leaderboardType === 'challenge'
              ? (viewingOpponent ? opponentTowers : tournamentTowers)
              : preAssignedTowers}
            placementSystem={placementSystem}
            placement={
              isPlacementActive && playerTower && playerRegion
                ? {
                    tower: playerTower,
                    region: playerRegion,
                    occupied: placementCells,
                    isSaving: isPlacing,
                    error: playerGrid.error,
                    onPlace: handleConfirmPlacement,
                    onCancel: handleCancelPlacement,
                  }
                : null
            }
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
                    const lastBlock = nextGhostBlocks[nextGhostBlocks.length - 1]!;
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
                  viewState.goTo('playing');
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
                    viewState.goTo('playing');
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

      {/* Placement is its own screen, layered above the game-end view rather than mixed into
          it. Nothing from the game-end HUD shows through. */}


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
