import React from 'react';
import type { ShareSessionRequest } from '../../shared/types/api';
import { TowerMapEntry } from '../../shared/types/tower';

interface GameEndControlsProps {
  onPlayAgain: () => void;
  playAgainLabel?: string;
  onShare: () => void;
  onViewTower: () => void;
  isSharing?: boolean;
  isSavingSession?: boolean;
  hasSharedSuccessfully?: boolean;
  // Challenge mode props
  selectedTowerForBattle?: TowerMapEntry | null;
  onBattle?: () => void;
  isFindingMatch?: boolean;
  isViewingOpponent?: boolean;
  challengeTicketCount?: number | null;
}

export const GameEndControls: React.FC<GameEndControlsProps> = ({
  onPlayAgain,
  playAgainLabel = "TRY AGAIN",
  onShare,
  onViewTower,
  isSharing,
  isSavingSession,
  hasSharedSuccessfully,
  selectedTowerForBattle,
  onBattle,
  isFindingMatch,
  isViewingOpponent,
  challengeTicketCount,
}) => {
  // In challenge mode when viewing opponent towers, show "SELECT TOWER" + "BATTLE"
  const showTowerSelection = isViewingOpponent;
  const battleDisabled = !selectedTowerForBattle;
  const noTickets = challengeTicketCount !== null && challengeTicketCount !== undefined && challengeTicketCount <= 0;

  return (
    <div style={{ display: 'flex', gap: '16px', alignItems: 'center', pointerEvents: 'auto', justifyContent: 'center' }}>
      {/* Main Action Button - varies by mode */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (noTickets && !showTowerSelection) {
            return;
          }
          showTowerSelection ? onBattle?.() : onPlayAgain();
        }}
        disabled={showTowerSelection ? battleDisabled : noTickets}
        className="tron-button"
        style={{
          background: showTowerSelection
            ? (battleDisabled ? 'rgba(255, 75, 75, 0.1)' : 'rgba(123, 255, 75, 0.1)')
            : 'rgba(0, 255, 255, 0.1)',
          border: showTowerSelection
            ? `1px solid ${battleDisabled ? '#ff4b4b' : '#7bff4b'}`
            : '1px solid #00ffff',
          borderRadius: '4px',
          color: showTowerSelection
            ? (battleDisabled ? '#ff4b4b' : '#7bff4b')
            : '#00ffff',
          padding: '8px',
          fontFamily: 'var(--font-mono)',
          fontSize: '8px',
          fontWeight: 'bold',
          letterSpacing: '0.1em',
          cursor: showTowerSelection ? (battleDisabled ? 'not-allowed' : 'pointer') : 'pointer',
          textTransform: 'uppercase',
          boxShadow: showTowerSelection
            ? (battleDisabled ? '0 0 15px rgba(255, 75, 75, 0.2)' : '0 0 15px rgba(123, 255, 75, 0.2)')
            : '0 0 15px rgba(0, 255, 255, 0.2)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          transition: 'all 0.2s ease',
          minWidth: '140px',
          justifyContent: 'center',
          backdropFilter: 'blur(4px)',
          opacity: isFindingMatch ? 0.7 : 1,
        }}
        onMouseEnter={(e) => {
          if (battleDisabled || isFindingMatch) return;
          const newBg = showTowerSelection
            ? 'rgba(123, 255, 75, 0.2)'
            : 'rgba(0, 255, 255, 0.2)';
          const newGlow = showTowerSelection
            ? '0 0 25px rgba(123, 255, 75, 0.4)'
            : '0 0 25px rgba(0, 255, 255, 0.4)';
          e.currentTarget.style.background = newBg;
          e.currentTarget.style.boxShadow = newGlow;
        }}
        onMouseLeave={(e) => {
          if (battleDisabled || isFindingMatch) return;
          const newBg = showTowerSelection
            ? 'rgba(123, 255, 75, 0.1)'
            : 'rgba(0, 255, 255, 0.1)';
          const newGlow = showTowerSelection
            ? '0 0 15px rgba(123, 255, 75, 0.2)'
            : '0 0 15px rgba(0, 255, 255, 0.2)';
          e.currentTarget.style.background = newBg;
          e.currentTarget.style.boxShadow = newGlow;
        }}
      >
        <span>
          {isFindingMatch ? '◆' : (showTowerSelection ? (battleDisabled ? '!' : '⚔') : '⚡')}
        </span>
        {isFindingMatch
          ? 'SEARCHING...'
          : (showTowerSelection
            ? (battleDisabled ? 'SELECT A TOWER' : 'BATTLE')
            : (noTickets ? 'NO CREDITS' : playAgainLabel))}
      </button>

      {/* Share Button */}
      <button
        onClick={(e) => { e.stopPropagation(); onShare(); }}
        disabled={isSharing || hasSharedSuccessfully || isSavingSession}
        className="tron-button"
        style={{
          background: hasSharedSuccessfully ? 'rgba(123, 255, 75, 0.1)' : 'rgba(34, 211, 238, 0.1)',
          border: `1px solid ${hasSharedSuccessfully ? '#7bff4b' : '#22d3ee'}`,
          borderRadius: '4px',
          color: hasSharedSuccessfully ? '#7bff4b' : '#22d3ee',
          padding: '8px',
          fontFamily: 'var(--font-mono)',
          fontSize: '8px',
          fontWeight: 'bold',
          letterSpacing: '0.1em',
          cursor: isSharing || hasSharedSuccessfully || isSavingSession ? 'default' : 'pointer',
          textTransform: 'uppercase',
          boxShadow: hasSharedSuccessfully ? '0 0 15px rgba(123, 255, 75, 0.2)' : '0 0 15px rgba(34, 211, 238, 0.2)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          transition: 'all 0.2s ease',
          opacity: isSharing || isSavingSession ? 0.7 : 1,
          minWidth: '140px',
          justifyContent: 'center',
          backdropFilter: 'blur(4px)'
        }}
        onMouseEnter={(e) => {
          if (isSharing || hasSharedSuccessfully || isSavingSession) return;
          e.currentTarget.style.background = 'rgba(34, 211, 238, 0.2)';
          e.currentTarget.style.boxShadow = '0 0 25px rgba(34, 211, 238, 0.4)';
        }}
        onMouseLeave={(e) => {
          if (isSharing || hasSharedSuccessfully || isSavingSession) return;
          e.currentTarget.style.background = 'rgba(34, 211, 238, 0.1)';
          e.currentTarget.style.boxShadow = '0 0 15px rgba(34, 211, 238, 0.2)';
        }}
      >
        <span>{hasSharedSuccessfully ? '✓' : '↗'}</span>
        {hasSharedSuccessfully ? 'SHARED' : (isSharing ? 'SHARING...' : (isSavingSession ? 'SAVING...' : 'SHARE'))}
      </button>
    </div>
  );
};
