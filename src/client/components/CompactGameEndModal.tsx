import React, { useState, useEffect, useMemo } from 'react';
import { GameState } from '../../shared/simulation';
import type { ShareSessionRequest, ReplayData } from '../../shared/types/api';
import { PlayerColorTheme } from '../constants/playerColors';
import { GameBalanceBar } from './GameBalanceBar';
import { TowerCountDisplay } from './TowerCountDisplay';
import { TronHud } from './TronHud';
import './gameEndModal.css';

export type ShareSessionPayload = ShareSessionRequest;

interface PlayerData {
  rank?: number;
  username: string;
  score: number;
  blocks: number;
  perfectBlocks: number;
}

interface CameraControlConfig {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}

export interface CompactGameEndModalProps {
  isVisible: boolean;
  gameState: GameState | null;
  playerTower?: any;
  gameEndData?: {
    rank?: number;
    totalPlayers: number;
    madeTheGrid: boolean;
    scoreToGrid?: number;
    improvement?: {
      lastScore?: number;
      lastBlocks?: number;
      lastPerfectStreak?: number;
    };
    personalBest?: boolean;
    bestScore?: number;
    previousBestScore?: number;
    bestSessionId?: string;
    bestPerfectStreak?: number;
    previousBestPerfectStreak?: number;
    personalBestPerfectStreak?: boolean;
  } | null;
  onPlayAgain: () => void;
  onShare: (sessionData: ShareSessionPayload) => void | Promise<void>;
  onMinimize?: () => void;
  onViewTower?: () => void;
  onWatchReplay?: () => void;
  isSharing?: boolean;
  hasSharedSuccessfully?: boolean;
  cameraControl?: CameraControlConfig;
  playerColorTheme?: PlayerColorTheme | null;
  replayData?: ReplayData | null;
  selectedTower?: { tower: any; rank?: number } | null;
  leaderboardType?: 'all-time' | 'daily';
  onLeaderboardTypeChange?: (type: 'all-time' | 'daily') => void;
}

export const CompactGameEndModal: React.FC<CompactGameEndModalProps> = ({
  isVisible,
  gameState,
  playerTower,
  gameEndData,
  onPlayAgain,
  onShare,
  onMinimize,
  onViewTower,
  onWatchReplay,
  isSharing = false,
  hasSharedSuccessfully = false,
  cameraControl,
  playerColorTheme,
  replayData,
  selectedTower,
  leaderboardType = 'daily',
  onLeaderboardTypeChange,
}) => {
  const [playerData, setPlayerData] = useState<PlayerData>({
    username: 'PLAYER',
    score: 0,
    blocks: 0,
    perfectBlocks: 0,
  });


  useEffect(() => {
    if (isVisible) {
      if (selectedTower) {
        setPlayerData({
          username: selectedTower.tower.username || 'PLAYER',
          score: selectedTower.tower.score,
          blocks: selectedTower.tower.blockCount,
          perfectBlocks: selectedTower.tower.perfectStreak ?? 0,
          rank: selectedTower.rank !== undefined ? selectedTower.rank + 1 : undefined,
        });
      } else if (playerTower) {
        setPlayerData({
          username: playerTower.username || 'PLAYER',
          score: playerTower.score,
          blocks: playerTower.blockCount,
          perfectBlocks: playerTower.perfectStreak ?? 0,
          rank: playerTower.rank !== undefined ? playerTower.rank + 1 : undefined,
        });
      } else if (gameState) {
        const username = 'PLAYER';
        let rank: number | undefined = undefined;
        if (gameEndData?.rank !== undefined) {
          rank = gameEndData.rank;
        }
        const perfectBlocks = typeof gameState.perfectBlockCount === 'number' ? gameState.perfectBlockCount : 0;

        setPlayerData({
          username,
          score: gameState.score,
          blocks: gameState.blocks.length,
          perfectBlocks,
          ...(rank !== undefined && { rank }),
        });
      }
    }
  }, [gameState, playerTower, gameEndData, isVisible, selectedTower]);

  if (!isVisible) return null;

  const getResultText = () => {
    if (!gameEndData) return 'GAME OVER';
    if (gameEndData.madeTheGrid) {
      return `GRID SECURED #${gameEndData.rank}`;
    }
    if (gameEndData.personalBest) {
      return 'NEW PERSONAL BEST';
    }
    return 'GAME OVER';
  };

  const getSubText = () => {
    if (!gameEndData) return 'Thanks for playing!';
    if (gameEndData.madeTheGrid) {
      return `You ranked #${gameEndData.rank} out of ${gameEndData.totalPlayers}`;
    }
    if (gameEndData.scoreToGrid && gameEndData.scoreToGrid > 0) {
      return `${gameEndData.scoreToGrid.toLocaleString()} pts to reach the grid`;
    }
    return `Best: ${gameEndData.bestScore?.toLocaleString() ?? 0}`;
  };

  const handleShareClick = () => {
    if (gameState) {
      onShare({
        score: gameState.score,
        blocks: gameState.blocks.length,
        perfectStreak: gameState.perfectBlockCount || 0,
        rank: gameEndData?.rank,
        totalPlayers: gameEndData?.totalPlayers,
        madeTheGrid: gameEndData?.madeTheGrid,
        sessionId: gameEndData?.bestSessionId,
      });
    }
  };

  const formatScore = (score: number) => {
    return new Intl.NumberFormat('en-US', {
      notation: 'compact',
      compactDisplay: 'short'
    }).format(score);
  };

  // Inline Styles
  const styles = {
    overlay: {
      position: 'fixed' as const,
      inset: 0,
      zIndex: 50,
      pointerEvents: 'none' as const,
      display: 'flex',
      flexDirection: 'column' as const,
      justifyContent: 'space-between',
      padding: '8px',
    },
    topContainer: {
      pointerEvents: 'auto' as const,
      alignSelf: 'center',
      display: 'flex',
      flexDirection: 'column' as const,
      alignItems: 'center',
      width: '100%',
      maxWidth: '500px',
    },
    statsRow: {
      display: 'flex',
      gap: '16px',
      justifyContent: 'space-between',
      alignItems: 'center',
      width: '100%',
    },
    statGroup: {
      display: 'flex',
      flexDirection: 'column' as const,
      gap: '4px',
      alignItems: 'center',
      flex: 1,
    },
    statLabel: {
      color: '#67e8f9',
      fontSize: '10px',
      fontWeight: 600,
      letterSpacing: '0.1em',
      textTransform: 'uppercase' as const,
      opacity: 0.9,
      fontFamily: 'Orbitron, monospace',
    },
    statValue: {
      fontSize: '20px',
      fontWeight: 800,
      color: '#fff',
      textShadow: '0 0 8px rgba(255, 255, 255, 0.5)',
      fontFamily: 'Orbitron, monospace',
      lineHeight: 1,
    },
    statValuePerfect: {
      fontSize: '20px',
      fontWeight: 800,
      color: '#7bff4b',
      textShadow: '0 0 10px rgba(123, 255, 75, 0.6)',
      fontFamily: 'Orbitron, monospace',
      lineHeight: 1,
    },
    playerName: {
      color: '#22d3ee',
      fontSize: '12px',
      fontWeight: 700,
      letterSpacing: '0.05em',
      textTransform: 'uppercase' as const,
      fontFamily: 'Orbitron, monospace',
      marginBottom: '2px',
    },
    playerRank: {
      color: '#ffb067', // Orange/Gold
      fontSize: '16px',
      fontWeight: 800,
      textShadow: '0 0 8px rgba(255, 176, 103, 0.4)',
      fontFamily: 'Orbitron, monospace',
    },
    bottomContainer: {
      pointerEvents: 'auto' as const,
      alignSelf: 'center',
      display: 'flex',
      flexDirection: 'column' as const,
      alignItems: 'center',
      gap: '12px',
      width: '100%',
      maxWidth: '500px',
    },
    buttonPrimary: {
      width: '100%',
      backgroundColor: 'rgba(6, 182, 212, 0.15)',
      color: '#00ffff',
      padding: '12px 8px',
      borderRadius: '6px',
      fontSize: '11px',
      fontWeight: 600,
      border: '1px solid rgba(148, 163, 184, 0.4)',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '8px',
      textTransform: 'uppercase' as const,
      fontFamily: 'Orbitron, monospace',
      whiteSpace: 'nowrap' as const,
      backdropFilter: 'blur(4px)',
      transition: 'all 0.2s ease',
    },
    secondaryActions: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr 1fr',
      gap: '12px',
      width: '100%',
    },
    buttonSecondary: {
      backgroundColor: 'rgba(15, 23, 42, 0.7)',
      color: '#cffafe',
      padding: '12px 8px',
      borderRadius: '6px',
      fontSize: '11px',
      fontWeight: 600,
      border: '1px solid rgba(148, 163, 184, 0.4)',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '8px',
      textTransform: 'uppercase' as const,
      fontFamily: 'Orbitron, monospace',
      whiteSpace: 'nowrap' as const,
      backdropFilter: 'blur(4px)',
      transition: 'all 0.2s ease',
    },
    buttonShare: {
      backgroundColor: 'rgba(15, 23, 42, 0.7)',
      color: '#22d3ee',
      padding: '12px 8px',
      borderRadius: '6px',
      fontSize: '11px',
      fontWeight: 600,
      border: '1px solid rgba(34, 211, 238, 0.4)',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '8px',
      textTransform: 'uppercase' as const,
      fontFamily: 'Orbitron, monospace',
      whiteSpace: 'nowrap' as const,
      backdropFilter: 'blur(4px)',
      transition: 'all 0.2s ease',
    }
  };

  return (
    <div style={styles.overlay}>
      {/* TOP SECTION: HUD Stats */}
      <div style={styles.topContainer}>
        <TronHud style={{ width: '100%' }}>
          <div style={{ display: 'flex', gap: '24px', width: '100%', justifyContent: 'center', alignItems: 'center' }}>
            <GameBalanceBar />

            {/* Leaderboard Toggle */}
            {onLeaderboardTypeChange && (
              <div style={{ display: 'flex', gap: '4px', background: 'rgba(0,0,0,0.3)', padding: '4px', borderRadius: '8px', border: '1px solid rgba(0,255,255,0.2)' }}>
                <button
                  onClick={() => onLeaderboardTypeChange('daily')}
                  style={{
                    background: leaderboardType === 'daily' ? 'rgba(0,255,255,0.2)' : 'transparent',
                    color: leaderboardType === 'daily' ? '#00ffff' : '#64748b',
                    border: 'none',
                    padding: '4px 8px',
                    borderRadius: '4px',
                    fontSize: '10px',
                    fontFamily: 'Orbitron, monospace',
                    cursor: 'pointer',
                    fontWeight: 600
                  }}
                >
                  DAILY
                </button>
                <button
                  onClick={() => onLeaderboardTypeChange('all-time')}
                  style={{
                    background: leaderboardType === 'all-time' ? 'rgba(0,255,255,0.2)' : 'transparent',
                    color: leaderboardType === 'all-time' ? '#00ffff' : '#64748b',
                    border: 'none',
                    padding: '4px 8px',
                    borderRadius: '4px',
                    fontSize: '10px',
                    fontFamily: 'Orbitron, monospace',
                    cursor: 'pointer',
                    fontWeight: 600
                  }}
                >
                  ALL TIME
                </button>
              </div>
            )}

            <TowerCountDisplay />
          </div>

          {selectedTower && (
            <div style={{ ...styles.statsRow, marginTop: '12px', paddingTop: '12px', borderTop: '1px solid rgba(0, 255, 255, 0.1)' }}>
              {/* Identity - Custom layout for first column */}
              <div style={styles.statGroup}>
                <div style={styles.playerName}>
                  {playerData.username.length > 8 ? `${playerData.username.substring(0, 8)}...` : playerData.username}
                </div>
                <div style={styles.playerRank}>
                  {playerData.rank !== undefined ? `#${playerData.rank}` : '-'}
                </div>
              </div>

              {/* Score */}
              <div style={styles.statGroup}>
                <div style={styles.statLabel}>SCORE</div>
                <div style={styles.statValue}>
                  {formatScore(playerData.score)}
                </div>
              </div>

              {/* Blocks */}
              <div style={styles.statGroup}>
                <div style={styles.statLabel}>HEIGHT</div>
                <div style={styles.statValue}>
                  {playerData.blocks}
                </div>
              </div>

              {/* Perfect */}
              <div style={styles.statGroup}>
                <div style={styles.statLabel}>PERFECT</div>
                <div style={styles.statValuePerfect}>
                  {playerData.perfectBlocks}
                </div>
              </div>
            </div>
          )}
        </TronHud>
      </div>

      {/* BOTTOM SECTION: Controls */}
      <div style={styles.bottomContainer}>
        {/* Primary Action */}


        {/* Secondary Actions */}
        <div style={styles.secondaryActions}>
          <button
            onClick={onPlayAgain}
            style={styles.buttonPrimary}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(6, 182, 212, 0.25)';
              e.currentTarget.style.boxShadow = '0 0 30px rgba(0, 255, 255, 0.25)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(6, 182, 212, 0.15)';
              e.currentTarget.style.boxShadow = '0 0 25px rgba(0, 255, 255, 0.1)';
            }}
          >
            <span style={{ fontSize: '18px' }}>↺</span> TRY AGAIN
          </button>
          <button
            onClick={onViewTower}
            style={styles.buttonSecondary}
            onMouseEnter={(e) => e.currentTarget.style.borderColor = '#00ffff'}
            onMouseLeave={(e) => e.currentTarget.style.borderColor = 'rgba(148, 163, 184, 0.4)'}
          >
            ▣ VIEW TOWER
          </button>

          {/* <button
            onClick={onWatchReplay}
            disabled={!replayData}
            style={{
              ...styles.buttonSecondary,
              opacity: !replayData ? 0.5 : 1,
              cursor: !replayData ? 'not-allowed' : 'pointer'
            }}
            onMouseEnter={(e) => replayData && (e.currentTarget.style.borderColor = '#00ffff')}
            onMouseLeave={(e) => replayData && (e.currentTarget.style.borderColor = 'rgba(148, 163, 184, 0.4)')}
          >
            📼 REPLAY
          </button> */}

          <button
            onClick={handleShareClick}
            disabled={isSharing || hasSharedSuccessfully}
            style={styles.buttonShare}
            onMouseEnter={(e) => !isSharing && !hasSharedSuccessfully && (e.currentTarget.style.borderColor = '#00ffff')}
            onMouseLeave={(e) => !isSharing && !hasSharedSuccessfully && (e.currentTarget.style.borderColor = 'rgba(34, 211, 238, 0.4)')}
          >
            {hasSharedSuccessfully ? '✓ SHARED' : isSharing ? 'SHARING...' : '↗ SHARE'}
          </button>
        </div>
      </div>
    </div>
  );
};
