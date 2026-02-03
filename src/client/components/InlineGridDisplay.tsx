import React from 'react';
import { Canvas } from '@react-three/fiber';
import { TowerMapEntry } from '../../shared/types/api';
import { TowerPlacementSystem, DEFAULT_TOWER_GRID_OFFSET, DEFAULT_TOWER_GRID_SIZE } from '../../shared/types/towerPlacement';
import { GPUInstancedTowerSystem } from './GPUInstancedTowerSystem';
import { TowerCameraController } from './TowerCameraController';
import { TronBackground } from './TronBackground';
import { EffectsRenderer } from './EffectsRenderer';
import { useTowerColorStats } from '../hooks/useTowerColorStats';
import { mixGridTintHex } from '../utils/gridColors';
import { GameBalanceBar } from './GameBalanceBar';
import { TowerCountDisplay } from './TowerCountDisplay';
import { TronHud } from './TronHud';
import { PLAYER_COLOR_THEMES, PlayerColorChoice } from '../constants/playerColors';
import { CycleScrubber } from './CycleScrubber';
import { requestExpandedMode, getWebViewMode, addWebViewModeListener, removeWebViewModeListener } from '@devvit/web/client';
import { GameMode } from '../../shared/simulation';

export type ViewMode = 'all-time' | 'daily' | 'challenge';

interface InlineGridDisplayProps {
  preAssignedTowers?: TowerMapEntry[] | null;
  placementSystem: TowerPlacementSystem;
  playerTower?: TowerMapEntry | null;
  targetUsername?: string | null;
  onExpand?: (event: React.MouseEvent) => void | Promise<void>;
  playerColorChoice?: PlayerColorChoice | null;
  onPlayerColorChange?: (color: PlayerColorChoice) => void;
  leaderboardType?: ViewMode;
  onLeaderboardTypeChange?: (type: ViewMode) => void;
  totalCount?: number;
  bottomControls?: React.ReactNode;
  currentCycleId?: string;
  onCycleChange?: (cycleId: string) => void;
  onRequestFullscreen?: () => void;
  gameMode?: GameMode;
  onGameModeChange?: (mode: GameMode) => void;
  onBattle?: (() => void) | undefined; // Callback when battle button is clicked in challenge mode
  battleLabel?: string;
  onTowerSelect?: (tower: TowerMapEntry) => void; // Callback when a tower is selected/clicked
  defeatedTowerIds?: Set<string> | undefined; // IDs of towers that have been defeated
  challengeTicketCount?: number | null;
  challengeSeasonLabel?: string | null;
  currentPlayerElo?: number | null;
  currentPlayerRank?: string | null;
  opponentInfo?: { username: string; elo: number; rank?: string } | null;
}

const stubGameState = { isGameOver: true } as const;
const COLOR_OPTIONS = Object.values(PLAYER_COLOR_THEMES);

const hexToRgb = (hex: string) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? `${parseInt(result[1]!, 16)}, ${parseInt(result[2]!, 16)}, ${parseInt(result[3]!, 16)}` : '0, 242, 254';
};

export const InlineGridDisplay: React.FC<InlineGridDisplayProps> = ({
  preAssignedTowers,
  placementSystem,
  playerTower = null,
  targetUsername,
  onExpand,
  playerColorChoice,
  onPlayerColorChange,
  leaderboardType = 'daily',
  onLeaderboardTypeChange,
  totalCount,
  bottomControls,
  currentCycleId,
  onCycleChange,
  onRequestFullscreen,
  gameMode = 'rotating_block',
  onGameModeChange,
  onBattle,
  battleLabel,
  onTowerSelect,
  defeatedTowerIds,
  challengeTicketCount = null,
  challengeSeasonLabel = null,
  currentPlayerElo = null,
  currentPlayerRank = null,
  opponentInfo = null,
}) => {
  const statsCycleId = leaderboardType === 'daily' ? currentCycleId : undefined;

  // Unconditionally call the hook to prevent React errors/crashes when switching modes
  const isStatsEnabled = leaderboardType !== 'challenge';
  const statsType = leaderboardType === 'challenge' ? 'daily' : leaderboardType;
  const towerStats = useTowerColorStats(undefined, statsType, statsCycleId, isStatsEnabled);

  // Lock the unknown-tower distribution for the current view so colors don't shift mid-stream.
  const distributionKey = React.useMemo(
    () => `${leaderboardType}:${statsCycleId ?? ''}`,
    [leaderboardType, statsCycleId]
  );
  const currentBluePct =
    typeof towerStats?.colorTotals?.blue?.percentage === 'number'
      ? towerStats.colorTotals.blue.percentage
      : null;
  const [lockedDistributionKey, setLockedDistributionKey] = React.useState(distributionKey);
  const [lockedBluePct, setLockedBluePct] = React.useState<number | null>(currentBluePct);

  React.useEffect(() => {
    if (lockedDistributionKey !== distributionKey) {
      setLockedDistributionKey(distributionKey);
      setLockedBluePct(null);
    }
  }, [distributionKey, lockedDistributionKey]);

  React.useEffect(() => {
    if (lockedBluePct === null && currentBluePct !== null) {
      setLockedBluePct(currentBluePct);
    }
  }, [lockedBluePct, currentBluePct]);
  const gridConfig = React.useMemo(() => placementSystem?.getConfiguration?.(), [placementSystem]);
  const inlineGridSize = gridConfig?.gridSize ?? DEFAULT_TOWER_GRID_SIZE;
  const inlineGridOffsetX = gridConfig?.gridOffsetX ?? DEFAULT_TOWER_GRID_OFFSET;
  const inlineGridOffsetZ = gridConfig?.gridOffsetZ ?? DEFAULT_TOWER_GRID_OFFSET;

  const [webViewMode, setWebViewMode] = React.useState<'inline' | 'expanded'>(getWebViewMode());

  React.useEffect(() => {
    const handleModeChange = (newMode: 'inline' | 'expanded') => {
      setWebViewMode(newMode);
    };

    addWebViewModeListener(handleModeChange);
    return () => removeWebViewModeListener(handleModeChange);
  }, []);

  const [focusedTower, setFocusedTower] = React.useState<TowerMapEntry | null>(playerTower ?? null);

  // Update focused tower when playerTower changes (e.g. when game ends)
  React.useEffect(() => {
    if (playerTower) {
      setFocusedTower(playerTower);
    }
  }, [playerTower]);

  const handleFullscreen = async (e: React.MouseEvent) => {
    try {
      await requestExpandedMode(e.nativeEvent, 'game');
    } catch (err) {
      console.error('Failed to enter expanded mode:', err);
    }
  };
  const safePreAssignedTowers = React.useMemo(() => {
    if (!preAssignedTowers) return [];
    if (Array.isArray(preAssignedTowers)) return preAssignedTowers;
    console.warn('InlineGridDisplay: preAssignedTowers is not an array', preAssignedTowers);
    return [];
  }, [preAssignedTowers]);

  const allTowers = React.useMemo(() => {
    // console.log('DEBUG: Calculating allTowers');
    const towers: TowerMapEntry[] = [];
    const occupiedPositions = new Set<string>();

    if (playerTower && typeof playerTower === 'object' && typeof playerTower.worldX === 'number' && typeof playerTower.worldZ === 'number') {
      towers.push(playerTower);
      occupiedPositions.add(`${playerTower.worldX},${playerTower.worldZ}`);
    }

    try {
      safePreAssignedTowers.forEach(t => {
        if (!t || typeof t !== 'object') return;
        if (t.sessionId !== playerTower?.sessionId && typeof t.worldX === 'number' && typeof t.worldZ === 'number') {
          const posKey = `${t.worldX},${t.worldZ}`;
          // Prevent overlapping towers (z-fighting ghosts)
          if (!occupiedPositions.has(posKey)) {
            towers.push(t);
            occupiedPositions.add(posKey);
          }
        }
      });
    } catch (e) {
      console.error('Error processing safePreAssignedTowers', e);
    }
    return towers;
  }, [playerTower, safePreAssignedTowers]);

  const targetTower = React.useMemo(() => {
    // If we have a specific player tower loaded (from session), that is our target
    if (playerTower) return playerTower;

    if (!targetUsername) return null;
    return allTowers.find(t => t.username === targetUsername) || null;
  }, [allTowers, targetUsername, playerTower]);

  // Update focused tower when target changes
  // We use a ref to prevent re-selecting the same target if the user manually deselected it
  const lastTargetIdRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (targetTower) {
      // Only update focus if the target has actually changed (new ID)
      if (targetTower.sessionId !== lastTargetIdRef.current) {
        setFocusedTower(targetTower);
        lastTargetIdRef.current = targetTower.sessionId;
      }
    }
  }, [targetTower]);

  const activeTower = focusedTower;

  const activeTowerRank = React.useMemo(() => {
    // console.log('DEBUG: Calculating rank', { activeTower: !!activeTower, allTowersIsArray: Array.isArray(allTowers), length: allTowers?.length });
    if (!activeTower || !allTowers || !Array.isArray(allTowers) || allTowers.length === 0) return undefined;

    try {
      // Ensure allTowers is iterable before spreading
      const safeTowers = Array.isArray(allTowers) ? allTowers : [];
      const sorted = [...safeTowers].sort((a, b) => (b.score || 0) - (a.score || 0));
      // Safe findIndex
      const index = sorted.findIndex(t => t && t.sessionId === activeTower.sessionId);
      return index >= 0 ? index : undefined;
    } catch (e) {
      console.error('Error calculating rank', e);
      return undefined;
    }
  }, [activeTower, allTowers]);

  const bluePercentage = towerStats?.colorTotals.blue.percentage ?? null;
  const gridTintHex = React.useMemo(() => mixGridTintHex(bluePercentage), [bluePercentage]);

  const activeTheme = React.useMemo(() => {
    return COLOR_OPTIONS.find(c => c.id === playerColorChoice) || COLOR_OPTIONS[0];
  }, [playerColorChoice]);

  const formatScore = (score: number) => {
    return new Intl.NumberFormat('en-US', {
      notation: 'compact',
      compactDisplay: 'short' // 'short' for 'k', 'm', 't', 'long' for 'thousand', 'million', 'trillion'
    }).format(score);
  };

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', cursor: 'pointer', overflow: 'hidden' }}>
      <Canvas
        dpr={[0.6, 1.1]}
        camera={{ position: [30.4, 21.1, 30], fov: 25, near: 1.86, far: 3500 }}
        gl={{ antialias: false, alpha: false, powerPreference: 'high-performance' }}
        frameloop="always"
      // style={{ pointerEvents: 'none' }}
      >
        <color attach="background" args={["#000814"]} />

        <TronBackground
          gameState={stubGameState}
          gridSize={inlineGridSize}
          gridOffsetX={inlineGridOffsetX}
          gridOffsetZ={inlineGridOffsetZ}
          gridLineWidth={3}
          gridColorHex={gridTintHex}
        />
        <EffectsRenderer />

        <GPUInstancedTowerSystem
          isGameOver={true}
          playerTower={playerTower}
          preAssignedTowers={safePreAssignedTowers}
          selectedTower={activeTower}
          expectedTotalTowers={totalCount ?? 0}
          leadingColor={towerStats?.leadingColor === 'blue' || towerStats?.leadingColor === 'orange' ? towerStats.leadingColor : null}
          fallbackBluePercentage={lockedBluePct}
          defeatedTowerIds={defeatedTowerIds}
          onTowerClick={(tower) => {
            // Prevent selecting defeated towers in challenge mode
            if (leaderboardType === 'challenge' && defeatedTowerIds?.has(tower.sessionId)) {
              console.log('[TOWER SELECT] ❌ Cannot select defeated tower:', {
                sessionId: tower.sessionId,
                defeatedTowerIds: Array.from(defeatedTowerIds || []),
              });
              return;
            }

            console.log('[TOWER SELECT] ✅ Selecting tower:', {
              sessionId: tower.sessionId,
              isDefeated: defeatedTowerIds?.has(tower.sessionId) ?? false,
              defeatedCount: defeatedTowerIds?.size ?? 0,
            });

            if (activeTower?.sessionId === tower.sessionId) {
              setFocusedTower(null);
            } else {
              setFocusedTower(tower);
            }
            onTowerSelect?.(tower);
          }}
        />

        <TowerCameraController
          selectedTower={activeTower}
          isGameOver={true}
          getTowersData={() => allTowers}
          rotationSpeedMultiplier={0.5}
        />
      </Canvas>

      {/* Tron Styled Overlay - Using shared GameUI styles */}
      <div style={{ top: 0 }} >
        {/* Top Gradient */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '128px', background: 'linear-gradient(to bottom, rgba(0,0,0,0.8), transparent)', pointerEvents: 'none' }} />

        {/* Bottom Gradient */}
        <div style={{ pointerEvents: 'none', position: 'absolute', bottom: 0, left: 0, right: 0, height: '192px', background: 'linear-gradient(to top, rgba(0,0,0,0.9), rgba(0,0,0,0.5), transparent)' }} />

        {/* Top HUD */}
        <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', width: 'auto', pointerEvents: 'none', padding: '24px', top: '0px' }}>
          <TronHud>
            {leaderboardType === 'challenge' ? (
              <div style={{ display: 'flex', gap: '24px', alignItems: 'center', justifyContent: 'center' }}>
                {/* Current Player */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                  <div className="tron-hud-label" style={{ fontSize: '9px' }}>YOU</div>
                  <div className="tron-hud-value" style={{ fontSize: '16px', color: '#00f2fe' }}>
                    {currentPlayerRank ?? '-'}
                  </div>
                  <div className="tron-hud-label" style={{ fontSize: '8px', opacity: 0.7 }}>
                    {currentPlayerElo ?? '-'}
                  </div>
                </div>

                {/* Divider */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                  <div className="tron-hud-label" style={{ fontSize: '9px' }}>CREDITS</div>
                  <div className="tron-hud-value" style={{ color: (challengeTicketCount ?? 0) > 0 ? '#7bff4b' : '#ff4b4b', fontSize: '20px' }}>
                    {challengeTicketCount ?? '-'}
                  </div>
                </div>

                {/* Opponent */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                  <div className="tron-hud-label" style={{ fontSize: '9px' }}>
                    {opponentInfo ? opponentInfo.username.toUpperCase() : 'OPPONENT'}
                  </div>
                  <div className="tron-hud-value" style={{ fontSize: '16px', color: '#ff4b4b' }}>
                    {opponentInfo?.rank ?? '-'}
                  </div>
                  <div className="tron-hud-label" style={{ fontSize: '8px', opacity: 0.7 }}>
                    {opponentInfo?.elo ?? '-'}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: '24px', alignItems: 'center' }}>
                <GameBalanceBar type={leaderboardType} />
                <TowerCountDisplay count={totalCount ?? 0} />
              </div>
            )}
            {/* Active Tower Stats - Positioned below main HUD */}

            {leaderboardType !== 'challenge' && activeTower && (
              <div style={{ display: 'flex', gap: '24px', justifyContent: 'space-between', width: '100%' }}>
                {/* Identity */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <div className="tron-hud-label"><span>{activeTower.username.toUpperCase()}</span></div>
                  <div className="tron-hud-value" style={{ fontSize: '18px', height: '24px', minWidth: 'auto', display: 'flex', alignItems: 'center', gap: '8px', whiteSpace: 'nowrap' }}>
                    {activeTowerRank !== undefined && (
                      <span style={{ color: '#ffe8d2', fontSize: '0.7em', opacity: 0.8 }}>#{activeTowerRank + 1}</span>
                    )}
                  </div>
                </div>

                {/* Score */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <div className="tron-hud-label">SCORE</div>
                  <div className="tron-hud-value" style={{ fontSize: '18px', height: '24px', minWidth: 'auto', fontWeight: 800, textShadow: '0 0 6px rgba(255, 255, 255, 0.4)' }}>
                    {formatScore(activeTower.score)}
                  </div>
                </div>

                {/* Blocks */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <div className="tron-hud-label">HEIGHT</div>
                  <div className="tron-hud-value" style={{ fontSize: '18px', height: '24px', minWidth: 'auto', fontWeight: 800, textShadow: '0 0 6px rgba(255, 255, 255, 0.4)' }}>
                    {activeTower.blockCount}
                  </div>
                </div>

                {/* Perfect */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <div className="tron-hud-label">PERFECT</div>
                  <div className="tron-hud-value" style={{ fontSize: '18px', height: '24px', minWidth: 'auto', color: '#7bff4b', fontWeight: 800, textShadow: '0 0 10px rgba(123, 255, 75, 0.5)' }}>
                    {activeTower.perfectStreak ?? 0}
                  </div>
                </div>
              </div>
            )}
          </TronHud>

          {/* {activeTower && (
            <div className=" pointer-events-none" >
              <div className="tron-game-hud" style={{ width: 'unset', minWidth: 'unset', padding: '10px 20px', gap: '24px', overflowX: 'auto' }}>
                <div className="tron-hud-scan" />
              
              </div>
            </div>
          )} */}
        </div>

        {/* Bottom Controls Container */}
        <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', bottom: 0, display: 'flex', alignItems: 'center', paddingBottom: '8px', pointerEvents: 'auto', flexDirection: 'column', gap: '16px' }}>

          {bottomControls ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
              {bottomControls}
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center' }}>
              {/* Left Color (Blue) */}
              {onPlayerColorChange && COLOR_OPTIONS[0] && (
                <button
                  key={COLOR_OPTIONS[0].id}
                  type="button"
                  className={`tron-color-pill ${playerColorChoice === COLOR_OPTIONS[0].id ? 'selected' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onPlayerColorChange(COLOR_OPTIONS[0]!.id);
                  }}
                  aria-pressed={playerColorChoice === COLOR_OPTIONS[0]!.id}
                  aria-label={COLOR_OPTIONS[0]!.label}
                  style={{
                    '--tron-pill-color': COLOR_OPTIONS[0]!.accentHex,
                    '--tron-pill-color-secondary': COLOR_OPTIONS[0]!.accentSecondaryHex,
                  } as React.CSSProperties}
                >
                  <span className="tron-color-pill-glow" aria-hidden="true" />
                  <span className="tron-color-pill-fill" aria-hidden="true" />
                </button>
              )}

              {/* Center Column: Enter Button */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', margin: '0 24px' }}>
                {/* Mode Selector - Regen Toggle */}
                {onGameModeChange && leaderboardType !== 'challenge' && (
                  <div className="tron-mode-selector" style={{ zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const newMode = gameMode === 'regenerate' ? 'rotating_block' : 'regenerate';
                        onGameModeChange(newMode);
                      }}
                      style={{
                        background: 'rgba(0, 10, 20, 0.6)',
                        border: '1px solid rgba(0, 242, 254, 0.3)',
                        padding: '8px 12px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        cursor: 'pointer',
                        borderRadius: '4px',
                        transition: 'all 0.2s ease',
                        pointerEvents: 'auto',
                        backdropFilter: 'blur(4px)'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = 'rgba(0, 242, 254, 0.8)';
                        e.currentTarget.style.background = 'rgba(0, 20, 40, 0.8)';
                        e.currentTarget.style.boxShadow = '0 0 15px rgba(0, 242, 254, 0.15)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = 'rgba(0, 242, 254, 0.3)';
                        e.currentTarget.style.background = 'rgba(0, 10, 20, 0.6)';
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                    >
                      <div style={{
                        width: '14px',
                        height: '14px',
                        border: '1px solid #00f2fe',
                        background: gameMode === 'regenerate' ? '#00f2fe' : 'transparent',
                        boxShadow: gameMode === 'regenerate' ? '0 0 10px rgba(0, 242, 254, 0.5)' : 'none',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'all 0.2s ease'
                      }}>
                        {gameMode === 'regenerate' && (
                          <div style={{ width: '100%', height: '100%', background: '#00f2fe', opacity: 0.8 }} />
                        )}
                      </div>
                      <span style={{
                        color: '#00f2fe',
                        fontFamily: '"Orbitron", monospace',
                        fontSize: '11px',
                        letterSpacing: '1px',
                        fontWeight: 600,
                        textShadow: '0 0 4px rgba(0, 242, 254, 0.4)'
                      }}>
                        REGEN MODE
                      </span>
                    </button>
                  </div>
                )}

                {/* Enter Grid / Battle Button */}
                {(onExpand || onBattle) && (
                  <button
                    type="button"
                    onClick={leaderboardType === 'challenge' && onBattle ? () => {
                      if ((challengeTicketCount ?? 0) <= 0) {
                        return;
                      }
                      onBattle();
                    } : onExpand}
                    disabled={leaderboardType === 'challenge' && (challengeTicketCount ?? 0) <= 0}
                    style={{ background: 'transparent', border: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', opacity: leaderboardType === 'challenge' && (challengeTicketCount ?? 0) <= 0 ? 0.5 : 1 }}
                  >
                    <div className="tron-start-button" style={{ padding: '16px', transition: 'transform 0.3s' }}>
                      <div className="tron-start-button-scan" />
                      <div className="tron-start-button-content" style={{ gap: '12px' }}>
                        <div className="tron-start-button-text" style={{ fontSize: '14px', whiteSpace: 'nowrap' }}>
                          {leaderboardType === 'challenge' && (challengeTicketCount ?? 0) <= 0
                            ? 'NO CREDITS'
                            : (battleLabel || (leaderboardType === 'challenge' ? 'BATTLE' : 'ENTER GRID'))}
                        </div>
                      </div>
                      <div className="tron-start-button-glow" />
                    </div>
                    <div style={{ marginTop: '12px' }}>
                      <span className="tron-hud-label" style={{ fontSize: '9px', opacity: 0.8, letterSpacing: '0.2em' }}>
                        {leaderboardType === 'challenge' ? (battleLabel === 'START MATCH' ? 'CONFIRM TARGET' : 'FIND OPPONENT') : 'TAP TO INITIALIZE'}
                      </span>
                    </div>
                  </button>
                )}
              </div>

              {/* Right Color (Orange) */}
              {onPlayerColorChange && COLOR_OPTIONS[1] && (
                <button
                  key={COLOR_OPTIONS[1].id}
                  type="button"
                  className={`tron-color-pill ${playerColorChoice === COLOR_OPTIONS[1].id ? 'selected' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onPlayerColorChange(COLOR_OPTIONS[1]!.id);
                  }}
                  aria-pressed={playerColorChoice === COLOR_OPTIONS[1]!.id}
                  aria-label={COLOR_OPTIONS[1]!.label}
                  style={{
                    '--tron-pill-color': COLOR_OPTIONS[1]!.accentHex,
                    '--tron-pill-color-secondary': COLOR_OPTIONS[1]!.accentSecondaryHex,
                  } as React.CSSProperties}
                >
                  <span className="tron-color-pill-glow" aria-hidden="true" />
                  <span className="tron-color-pill-fill" aria-hidden="true" />
                </button>
              )}
            </div>
          )}

          {/* Leaderboard Toggle - Always visible if handler provided */}
          {onLeaderboardTypeChange && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', pointerEvents: 'auto' }}>
              <div style={{ display: 'flex', gap: '8px' }}>
                {/* <button
                  onClick={(e) => { e.stopPropagation(); onLeaderboardTypeChange('all-time'); }}
                  style={{
                    fontSize: '8px',
                    background: leaderboardType === 'all-time' ? activeTheme?.accentHex : 'rgba(0, 0, 0, 0.6)',
                    color: leaderboardType === 'all-time' ? '#000' : activeTheme?.accentHex,
                    border: `1px solid ${activeTheme?.accentHex}`,
                    boxShadow: leaderboardType === 'all-time' ? `0 0 10px ${activeTheme?.accentHex}` : 'none',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 'bold',
                    transition: 'all 0.2s ease',
                    textShadow: leaderboardType === 'all-time' ? 'none' : `0 0 5px ${activeTheme?.accentHex}`,
                    borderRadius: '4px',
                    letterSpacing: '0.2em'
                  }}
                >
                  ALL-TIME
                </button> */}
                <button
                  onClick={(e) => { e.stopPropagation(); onLeaderboardTypeChange('daily'); }}
                  style={{
                    fontSize: '8px',
                    background: leaderboardType === 'daily' ? activeTheme?.accentHex : 'rgba(0, 0, 0, 0.6)',
                    color: leaderboardType === 'daily' ? '#000' : activeTheme?.accentHex,
                    border: `1px solid ${activeTheme?.accentHex}`,
                    boxShadow: leaderboardType === 'daily' ? `0 0 10px ${activeTheme?.accentHex}` : 'none',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 'bold',
                    transition: 'all 0.2s ease',
                    textShadow: leaderboardType === 'daily' ? 'none' : `0 0 5px ${activeTheme?.accentHex}`,
                    borderRadius: '4px',
                    letterSpacing: '0.2em'
                  }}
                >
                  CYCLE
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onLeaderboardTypeChange('challenge'); }}
                  style={{
                    fontSize: '8px',
                    background: leaderboardType === 'challenge' ? activeTheme?.accentHex : 'rgba(0, 0, 0, 0.6)',
                    color: leaderboardType === 'challenge' ? '#000' : activeTheme?.accentHex,
                    border: `1px solid ${activeTheme?.accentHex}`,
                    boxShadow: leaderboardType === 'challenge' ? `0 0 10px ${activeTheme?.accentHex}` : 'none',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 'bold',
                    transition: 'all 0.2s ease',
                    textShadow: leaderboardType === 'challenge' ? 'none' : `0 0 5px ${activeTheme?.accentHex}`,
                    borderRadius: '4px',
                    letterSpacing: '0.2em'
                  }}
                >
                  CHALLENGE
                </button>
              </div>

              {/* Scrubber Container - Fixed Height to prevent layout shift */}
              <div style={{ height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
                {leaderboardType === 'daily' && currentCycleId && onCycleChange ? (
                  <CycleScrubber
                    currentCycleId={currentCycleId}
                    onCycleChange={onCycleChange}
                    activeTheme={activeTheme!}
                  />
                ) : null}
              </div>
            </div>
          )}
        </div>

        {/* Fullscreen Button - Bottom Left */}
        {onRequestFullscreen && webViewMode === 'inline' && (
          <div style={{ position: 'absolute', bottom: '16px', left: '16px', pointerEvents: 'auto', zIndex: 50 }}>
            <button
              onClick={handleFullscreen}
              className="tron-reset-btn"
              aria-label="Fullscreen"
              title="Fullscreen"
              style={{
                '--tron-player-accent': activeTheme?.accentHex || '#00f2fe',
                '--tron-player-accent-rgb': hexToRgb(activeTheme?.accentHex || '#00f2fe'),
              } as React.CSSProperties}
            >
              <div className="tron-reset-scan"></div>
              <div className="tron-reset-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
                </svg>
              </div>
              <div className="tron-reset-label">EXPAND</div>
              <div className="tron-reset-glow"></div>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
