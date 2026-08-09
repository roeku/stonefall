/**
 * ARCHIVED — dead code removed from src/client/App.tsx, GameUI.tsx and
 * PerformanceConnector.tsx during the pre-pivot cleanup.
 *
 * All of it was already disabled before this pass: either commented out in place, or state that
 * was written but whose only reader was itself commented out. `tsc` with `noUnusedLocals` had
 * been flagging the leftovers; the fix that surfaced them silenced them with `_` prefixes and
 * comment blocks, which was reverted in favour of deleting them outright.
 *
 * This file is a record, not a module. It is outside every tsconfig project and is not compiled,
 * linted, or bundled. Identifiers here refer to App.tsx scope that no longer exists.
 */

// ---------------------------------------------------------------------------
// 1. Replay-viewing mode — "REPLAY MODE DISABLED FOR THIS RELEASE"
//
// A feature to re-watch a finished run. The state, its setters and every branch that fed it were
// commented out across ~8 sites in App.tsx plus the `replayDataToWatch` prop threaded into GameUI.
//
// NOTE: replay *data* is still very much live — it is the basis of server-side score verification
// in gameDataService.verifyGameReplay() and of tournament ghosts. Only the client-side playback
// UI was disabled. Do not confuse the two when reading this back.
// ---------------------------------------------------------------------------

const [replayDataToWatch, setReplayDataToWatch] = React.useState<ReplayData | null>(null);

// …in loadSessionData(), on successful fetch:
if (replayData) {
  setReplayDataToWatch(replayData);
} else if (sessionData.replayData) {
  setReplayDataToWatch(sessionData.replayData);
}

// …in loadSessionData(), when the fetch returned null:
if (replayData) {
  console.log('⚠️ Falling back to replay data for tower construction');
  setReplayDataToWatch(replayData);
}

// …in loadSessionData(), on error:
if (replayData) {
  console.log('⚠️ Error fetching session, using replay data fallback.');
  setReplayDataToWatch(replayData);
}

// …in the /api/init handler:
else if (data.replayData) {
  console.log('📼 Replay data received from API', data.replayData);
  setReplayDataToWatch(data.replayData);
}

if (replayData && !sessionId) {
  // Only replay data
  console.log('📼 Replay data received', replayData);
  setReplayDataToWatch(replayData);
}

const handleWatchReplay = () => {
  console.log('📼 Watch Replay clicked');
  const data = replayData || replayDataToWatch;
  if (data) {
    setShowGameEndModal(false);
    // Start game in replay mode
    startGameHook(data.gameMode as any, undefined, data);
  }
};

// …on inline expansion:
if (replayDataToWatch) {
  console.log('📼 Starting replay from inline expansion');
  startGameHook(replayDataToWatch.gameMode as any, undefined, replayDataToWatch);
}

// ---------------------------------------------------------------------------
// 2. TowerInfoPopup — handlers plus the JSX that consumed them
// ---------------------------------------------------------------------------

const handleCloseTowerInfo = () => {
  setSelectedTower(null);
};

const handleVisitProfile = (username: string) => {
  console.log('Visit profile:', username);
  // TODO: Implement profile navigation
  setSelectedTower(null);
};

// …and the disabled JSX it served:
// <TowerInfoPopup
//   …
//   onClose={handleCloseTowerInfo}
//   onVisitProfile={handleVisitProfile}
// />

// ---------------------------------------------------------------------------
// 3. GridReviewOverlay close handler
// ---------------------------------------------------------------------------

const handleCloseGridReview = () => {
  setSelectedTower(null);
  setIsGridReviewOpen(false);
};

// ---------------------------------------------------------------------------
// 4. Camera speed control — never wired to any UI
//
// `cameraRotationSpeed` itself survives, but as a plain `const … = 1`: it is still read by
// GameScene, only its setter was dead. These constants existed solely for the absent slider.
// ---------------------------------------------------------------------------

const CAMERA_SPEED_MIN = 0.25;
const CAMERA_SPEED_MAX = 2;
const CAMERA_SPEED_STEP = 0.25;

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

// ---------------------------------------------------------------------------
// 5. Game-end modal handlers — obsolete since the modal became the grid view itself
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 6. TournamentResultModal — state written at two live sites, read only by disabled JSX
//
// The win/loss/practice result screen. Both `setTournamentResultData({…})` calls were still
// executing on every tournament match end, building an object nothing ever displayed.
// ---------------------------------------------------------------------------

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
  ticketsRemaining?: number | undefined;
} | null>(null);

// …practice-match branch:
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
  ticketsRemaining: tournament.status?.tickets ?? undefined,
});

// …ranked-match branch, inside tournament.reportMatch(...).then(res => { ... }):
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
  ticketsRemaining: res.newTickets,
});

// …and the disabled JSX, whose onContinue/onRetry were the only readers:
// <TournamentResultModal
//   isVisible={!!tournamentResultData}
//   result={tournamentResultData?.result || null}
//   … onContinue / onRetry cleared it and reset the match state …
// />

// ---------------------------------------------------------------------------
// 7. WebView inline/expanded mode tracking — written, never read
// ---------------------------------------------------------------------------

const [webViewMode, setWebViewMode] = React.useState<'inline' | 'expanded'>(() => {
  try {
    return getWebViewMode();
  } catch (e) {
    return 'expanded'; // Default to expanded if not in Devvit environment
  }
});

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

// ---------------------------------------------------------------------------
// 8. lastSessionId — drove a "session saved" toast that no longer exists
// ---------------------------------------------------------------------------

const [lastSessionId, setLastSessionId] = React.useState<string | null>(null);
// …set in handleGameEnd: setLastSessionId(sessionId);
// …and cleared: setTimeout(() => setLastSessionId(null), 3000);

// ---------------------------------------------------------------------------
// 9. PerformanceConnector — the whole component
//
// It existed only to lift the three.js renderer out of the Canvas into App's `glRenderer` state,
// which nothing read. With that state gone the component had no purpose, so
// src/client/components/system/PerformanceConnector.tsx was archived alongside it.
// Its sibling <RendererLogger /> (defined inline in App.tsx) is kept — it still logs renderer
// info on mount and is useful when debugging GPU selection.
// ---------------------------------------------------------------------------

const [glRenderer, setGlRenderer] = React.useState<any>(null);
// …usage inside <Canvas>: <PerformanceConnector onRendererReady={setGlRenderer} />

// ---------------------------------------------------------------------------
// 10. GameUI.tsx — selectedMode, written but never read
//
// The mode selector calls setSelectedMode(newMode) and an effect syncs it from the `gameMode`
// prop, but the value was never rendered; GameUI reads `gameMode` from the game-state hook
// directly. Both writes were removed along with the state.
// ---------------------------------------------------------------------------

const [selectedMode, setSelectedMode] = useState<GameMode>(gameMode || 'rotating_block');

// Sync selectedMode if gameMode changes externally
useEffect(() => {
  if (gameMode) {
    setSelectedMode(gameMode);
  }
}, [gameMode]);

// ---------------------------------------------------------------------------
// 11. useFrustumCulling.ts — culling-stats instrumentation
//
// A per-60-frame block that computed a culled-percentage string for a console.log that was
// already commented out.
// ---------------------------------------------------------------------------

if (frameCount.current % 60 === 0) {
  const culledCount = blocks.length - currentVisible.size;
  const culledPercent =
    blocks.length === 0 ? '0.0' : ((culledCount / blocks.length) * 100).toFixed(1);
  // console.log(`🔍 Frustum Culling: ${currentVisible.size}/${blocks.length} visible (${culledPercent}% culled)`);
}
