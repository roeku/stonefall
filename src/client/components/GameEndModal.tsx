import React, { useState, useEffect, useCallback, useRef } from 'react';
import { GameState } from '../../shared/simulation';
import './gameEndModal.css';

// Simple focus trap hook
const useFocusTrap = (isActive: boolean) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isActive) return;

    const container = containerRef.current;
    if (!container) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Tab') {
        const focusableElements = container.querySelectorAll(
          'button:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        const firstElement = focusableElements[0] as HTMLElement;
        const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

        if (event.shiftKey) {
          if (document.activeElement === firstElement) {
            event.preventDefault();
            lastElement?.focus();
          }
        } else {
          if (document.activeElement === lastElement) {
            event.preventDefault();
            firstElement?.focus();
          }
        }
      }
    };

    container.addEventListener('keydown', handleKeyDown);
    return () => container.removeEventListener('keydown', handleKeyDown);
  }, [isActive]);

  return containerRef;
};

// Player data interface
interface PlayerData {
  rank?: number;
  username: string;
  score: number;
  blocks: number;
  perfectStreak: number;
}

// Component props interface
export interface GameEndModalProps {
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
  } | null;
  onPlayAgain: () => void;
  onShare: (sessionData: any) => void;
  onMinimize?: () => void;
  onViewTower?: () => void; // New callback to focus on player's tower
}

// Simple minimized indicator
const MinimizedIndicator: React.FC<{
  onClick: () => void;
  playerRank?: number | undefined;
  madeTheGrid?: boolean;
}> = ({ onClick, playerRank, madeTheGrid }) => (
  <div
    className={`tron-minimized-indicator ${!madeTheGrid ? 'tron-minimized-not-grid' : ''}`}
    onClick={onClick}
    role="button"
    tabIndex={0}
    aria-label="Reopen game results"
    onKeyDown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClick();
      }
    }}
  >
    {playerRank ? `#${playerRank}` : '🎮'}
  </div>
);

// Main GameEndModal component
export const GameEndModal: React.FC<GameEndModalProps> = ({
  isVisible,
  gameState,
  playerTower,
  gameEndData,
  onPlayAgain,
  onShare,
  onMinimize,
  onViewTower,
}) => {
  const [isMinimized, setIsMinimized] = useState(false);
  const [playerData, setPlayerData] = useState<PlayerData>({
    username: 'PLAYER',
    score: 0,
    blocks: 0,
    perfectStreak: 0,
  });

  const modalContainerRef = useFocusTrap(isVisible && !isMinimized);

  // Load player data when modal becomes visible
  useEffect(() => {
    if (gameState && isVisible) {
      const username = playerTower?.username || 'PLAYER';
      // Prioritize gameEndData.rank, fall back to playerTower.rank if available
      let rank: number | undefined = undefined;
      if (gameEndData?.rank !== undefined) {
        rank = gameEndData.rank;
      } else if (playerTower?.rank !== undefined) {
        rank = playerTower.rank + 1;
      }

      setPlayerData({
        username,
        score: gameState.score,
        blocks: gameState.blocks.length,
        perfectStreak: gameState.combo,
        ...(rank !== undefined && { rank }),
      });
    }
  }, [gameState, playerTower, gameEndData, isVisible]);

  // Generate dynamic congratulations message
  const getCongratsMessage = (): { title: string; message: string; icon: string } => {
    if (!gameEndData) {
      return {
        title: 'Game Over!',
        message: 'Thanks for playing! Your tower has been saved.',
        icon: '■',
      };
    }

    const { madeTheGrid, rank, totalPlayers, scoreToGrid, improvement } = gameEndData;

    if (madeTheGrid && rank) {
      // Player made it to the grid!
      if (rank <= 3) {
        return {
          title: '🏆 LEGENDARY! 🏆',
          message: `You're in the TOP ${rank}! You've proven yourself a master builder!`,
          icon: '👑',
        };
      } else if (rank <= 10) {
        return {
          title: 'OUTSTANDING!',
          message: `You made it to the TOP 10 at rank #${rank}! Your tower stands tall on the grid!`,
          icon: '⭐',
        };
      } else {
        return {
          title: 'Congrats!',
          message: `You made it onto the grid at rank #${rank} out of ${totalPlayers}!`,
          icon: '🎯',
        };
      }
    } else {
      // Player didn't make the grid
      const improvements: string[] = [];

      if (improvement?.lastScore !== undefined && gameState) {
        const scoreDiff = gameState.score - improvement.lastScore;
        if (scoreDiff > 0) {
          improvements.push(`+${scoreDiff.toLocaleString()} points`);
        }
      }

      if (improvement?.lastBlocks !== undefined && gameState) {
        const blockDiff = gameState.blocks.length - improvement.lastBlocks;
        if (blockDiff > 0) {
          improvements.push(`+${blockDiff} blocks`);
        }
      }

      if (improvement?.lastPerfectStreak !== undefined && gameState) {
        const streakDiff = gameState.combo - improvement.lastPerfectStreak;
        if (streakDiff > 0) {
          improvements.push(`+${streakDiff} perfect streak`);
        }
      }

      let message = '';
      if (rank) {
        message = `You're rank #${rank} out of ${totalPlayers}. `;
      }

      if (scoreToGrid !== undefined && scoreToGrid > 0) {
        message += `You need ${scoreToGrid.toLocaleString()} more points to reach the grid!`;
      } else {
        message += 'Keep building to reach the grid!';
      }

      if (improvements.length > 0) {
        message += ` You improved: ${improvements.join(', ')}!`;
      }

      return {
        title: 'Keep Building!',
        message,
        icon: '🏗️',
      };
    }
  };

  const congratsData = getCongratsMessage();

  // Handle close/minimize
  const handleClose = useCallback(() => {
    if (onMinimize) {
      setIsMinimized(true);
      onMinimize();
    }
  }, [onMinimize]);

  // Handle reopen from minimized
  const handleReopen = useCallback(() => {
    setIsMinimized(false);
  }, []);

  // Handle keyboard events
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isVisible || isMinimized) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        handleClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isVisible, isMinimized, handleClose]);

  // Handle action button clicks
  const handlePlayAgain = useCallback(() => {
    onPlayAgain();
    setIsMinimized(false);
  }, [onPlayAgain]);

  const handleShare = useCallback(() => {
    const sessionData = {
      score: playerData.score,
      blocks: playerData.blocks,
      perfectStreak: playerData.perfectStreak,
      rank: playerData.rank,
    };
    onShare(sessionData);
  }, [onShare, playerData]);

  const handleViewTower = useCallback(() => {
    if (onViewTower) {
      // Minimize modal and trigger tower view
      setIsMinimized(true);
      onViewTower();
    }
  }, [onViewTower]);

  // Don't render if not visible
  if (!isVisible) {
    return null;
  }

  // Render minimized indicator
  if (isMinimized) {
    return (
      <MinimizedIndicator
        onClick={handleReopen}
        playerRank={playerData.rank}
        {...(gameEndData?.madeTheGrid !== undefined && { madeTheGrid: gameEndData.madeTheGrid })}
      />
    );
  }

  // Main modal render
  return (
    <>
      {/* Backdrop */}
      <div
        className="tron-modal-backdrop"
        onClick={handleClose}
        role="presentation"
        aria-hidden="true"
      />

      {/* Modal Container */}
      <div
        className="tron-modal-container"
        ref={modalContainerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        {/* Close Button */}
        <button
          className="tron-modal-close"
          onClick={handleClose}
          aria-label="Close modal"
          type="button"
        >
          ×
        </button>

        {/* Modal Content */}
        <div className="tron-modal-content">
          <h1 id="modal-title" className="sr-only">Game Results</h1>

          {/* Header Section - Logo + Player Info */}
          <div className="tron-modal-header">
            {/* Logo */}
            <div className="tron-modal-logo">
              <TronModalLogo />
            </div>

            {/* Player Info */}
            <div className="tron-player-section">
              <div className={`tron-rank-badge ${gameEndData && !gameEndData.madeTheGrid ? 'tron-rank-not-grid' : ''}`}>
                {playerData.rank ? `#${playerData.rank}` : '?'}
              </div>
              <div className="tron-username">
                {playerData.username.toUpperCase()}
              </div>
            </div>
          </div>

          {/* Statistics */}
          <div className="tron-stats-section">
            <div className="tron-stat-item">
              <div className="tron-stat-label">Score</div>
              <div className="tron-stat-value">{playerData.score.toLocaleString()}</div>
            </div>
            <div className="tron-stat-item">
              <div className="tron-stat-label">Blocks</div>
              <div className="tron-stat-value">{playerData.blocks}</div>
            </div>
            <div className="tron-stat-item">
              <div className="tron-stat-label">Perfect</div>
              <div className="tron-stat-value">{playerData.perfectStreak}</div>
            </div>
          </div>

          {/* Congratulations */}
          <div className="tron-congrats-section">
            <div className="tron-block-icon">{congratsData.icon}</div>
            <div className="tron-congrats-text">
              <div className="tron-congrats-title">{congratsData.title}</div>
              <div className="tron-congrats-message">
                {congratsData.message}
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="tron-actions-section">
            <button
              className={`tron-action-button tron-view-tower-btn ${!onViewTower || !playerTower ? 'tron-button-hidden' : ''}`}
              onClick={handleViewTower}
              type="button"
              title="See your tower on the grid"
              disabled={!onViewTower || !playerTower}
              aria-hidden={!onViewTower || !playerTower}
            >
              View My Tower
            </button>
            <button
              className="tron-action-button tron-try-again-btn"
              onClick={handlePlayAgain}
              type="button"
            >
              Try Again
            </button>
            <button
              className="tron-action-button tron-boast-btn"
              onClick={handleShare}
              type="button"
            >
              Boast
            </button>
          </div>
        </div>
      </div>
    </>
  );
};
// Modal logo component
const TronModalLogo: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 1210.4 346"
    className="tron-modal-logo-svg"
  >
    <defs>
      <style>{`
        .st0 { fill: #ff5700; }
        .st1 { fill: #fff; }
        .st2 { fill: none; stroke: #000; stroke-miterlimit: 10; stroke-width: 6px; }
      `}</style>
    </defs>
    <path className="st0" d="M1197.4,264.3c-.3-.3-.7-.6-1.1-.9-.4-.3-.8-.6-1.2-.8-.4-.3-.8-.5-1.2-.8-.2-.4-.5-.8-.8-1.2-.2-.4-.5-.8-.8-1.2-.3-.4-.6-.8-.9-1.1-.6-.7-1.3-1.4-2-2-.6-.7-1.3-1.4-2-2-3.5-3-8.1-4.9-13.1-4.9h-71.8l.2-2,3-33.3c.5-5.3-1.2-10.5-4.6-14.6-.7-.8-1.5-1.6-2.3-2.3-.3-.3-.7-.6-1.1-.9-.4-.3-.8-.6-1.2-.8-.4-.3-.8-.5-1.3-.7-.2-.4-.5-.8-.7-1.3-.3-.4-.5-.8-.8-1.2-.2-.3-.4-.5-.6-.8,0-.1-.2-.2-.3-.3-.6-.7-1.3-1.4-2-2-.6-.7-1.3-1.4-2-2-3.1-2.7-7-4.4-11.3-4.8-5.3-.5-10.5,1.1-14.6,4.6-4.1,3.4-6.6,8.2-7.1,13.6l-4.7,52.2v.4c-.7-.5-1.4-.9-2.1-1.3-2.8-1.5-6-2.4-9.5-2.4h-71.8l.2-2,3-33.3c.5-5.3-1.1-10.5-4.6-14.6-.7-.8-1.5-1.6-2.3-2.3-.3-.3-.7-.6-1.1-.9-.4-.3-.8-.6-1.2-.8-.4-.3-.8-.5-1.2-.7-.2-.4-.5-.8-.8-1.3-.3-.4-.5-.8-.8-1.2-.2-.3-.4-.5-.6-.8,0-.1-.2-.2-.3-.3-.6-.7-1.3-1.4-2-2-.2-.2-.3-.4-.5-.6h6.6c5.3,0,10.3-2.2,14.1-6,3.8-3.8,5.8-8.8,5.8-14.2,0-5.4-2.2-10.4-6-14.1-.3-.3-.6-.6-.9-.8-.3-.3-.7-.6-1.1-.9-.4-.3-.8-.6-1.2-.8-.4-.3-.8-.5-1.2-.7-.2-.4-.5-.8-.8-1.3-.2-.4-.5-.8-.8-1.2-.3-.4-.6-.8-.9-1.1-.3-.4-.7-.8-1.1-1.2-.3-.3-.6-.6-.9-.9-.3-.4-.7-.8-1.1-1.1-.3-.3-.6-.6-.9-.9-2.9-2.5-6.3-4.1-10-4.6.3-.4.6-.9.9-1.3,1.8-3,2.8-6.4,2.8-10.1,0-6-2.7-11.4-6.9-15.1-.4-.3-.7-.6-1.1-.9s-.8-.6-1.2-.8c-.4-.3-.8-.5-1.2-.8-.2-.4-.5-.8-.8-1.2-.2-.4-.5-.8-.8-1.2-.3-.4-.6-.7-.9-1.1-.3-.3-.5-.6-.8-.9h27.1c11,0,20-8.9,20-19.8,0-5.3-2-10.4-5.8-14.2-.4-.4-.7-.7-1.1-1-.4-.3-.7-.6-1.1-.9-.4-.3-.8-.6-1.2-.8-.4-.3-.8-.5-1.2-.8-.2-.4-.5-.8-.8-1.2-.2-.4-.5-.8-.8-1.2-.3-.4-.6-.7-.9-1.1-.3-.3-.6-.7-.9-1-.4-.4-.7-.7-1.1-1-.3-.3-.6-.7-.9-1-.4-.4-.7-.7-1.1-1-3.6-3.2-8.2-4.9-13-4.9l-129.7-.5c-6.9,0-13,3.5-16.6,8.9,0,0,0,0-.1.1-.3-.3-.5-.7-.8-1-.3-.4-.7-.8-1.1-1.1-.3-.3-.6-.6-.9-.9-.6-.7-1.3-1.4-2-2-3-2.6-6.9-4.4-11.2-4.8-5.3-.5-10.5,1.1-14.6,4.5-4.1,3.4-6.7,8.2-7.1,13.6l-5.4,58.8-2-2.2-52.7-58.2c-.5-.6-1.1-1.1-1.7-1.6-.2-.2-.5-.4-.8-.7-.2-.1-.4-.3-.6-.4-.2-.1-.3-.2-.5-.4l-1.5-1.6-1.4-1.6-1.2-1.3-.3-.4c-.5-.6-1.1-1.1-1.7-1.6l-.3-.4c-.5-.6-1.1-1.1-1.7-1.6-3.6-3.2-8.3-5-13.2-5h-19.6c-4.4,0-8.7,1.5-12.2,4.1l-6.9,5.3c-1.3,1-2.5,2.1-3.5,3.4,0,0,0,0,0,.1,0,0,0,0,0,0,0,.1-.2.2-.2.3-.2,0-.3-.2-.5-.3-.2-.4-.5-.8-.7-1.2-.2-.3-.4-.6-.5-.8,0-.1-.2-.2-.3-.3-.3-.4-.6-.8-.9-1.1,0,0,0,0,0,0-.2-.2-.3-.4-.5-.6-.5-.5-1-1-1.5-1.4,0,0,0,0,0,0-.2-.2-.3-.4-.5-.6-.5-.5-1-1-1.5-1.4,0,0,0,0,0,0-3.6-3.1-8.3-4.9-13.1-4.9h-101.5c-5.2,0-10.1,2-13.8,5.6l-5.7,5.4h0s-.3.3-.3.3h0s0,0,0,0c-.2-.4-.5-.8-.8-1.2-.3-.3-.5-.7-.8-1,0,0,0,0-.1-.1-.6-.7-1.3-1.4-2-2-.6-.7-1.3-1.4-2-2-3.5-3.1-8.1-4.9-13.1-4.9h-134.4c-4.8,0-9.1,1.7-12.6,4.5-.1-.1-.2-.2-.3-.3-.6-.5-1.3-1-2-1.5-3.2-2.1-7-3.4-11.1-3.4h-104.4c-5.1,0-10,2-13.8,5.5l-21.2,20.1c-4,3.8-6.2,9.1-6.2,14.5v22c0,5,1.8,9.6,4.9,13.1.6.7,1.3,1.4,2,2,.4.3.7.6,1.1.9.4.3.8.6,1.2.8.4.3.8.5,1.2.8.4.2.9.5,1.3.7.2.5.4.9.7,1.3.2.4.5.8.8,1.2.2.4.5.8.8,1.2,0,.1.2.2.2.3.2.3.4.5.7.8.4.4.8.8,1.2,1.2-9.3,1.7-16.3,9.9-16.3,19.7s1.8,9.6,4.9,13.1c.6.7,1.3,1.4,2,2,.4.3.7.6,1.1.9.4.3.8.6,1.2.8.4.3.8.5,1.2.8.4.2.9.5,1.3.7.2.5.4.9.7,1.3.2.4.5.9.8,1.2.3.4.5.8.8,1.2.3.4.6.8.9,1.1,3.7,4.2,9.1,6.9,15.1,6.9h101.7c5.5,0,10.8-2.3,14.5-6.3l24.2-25.6c3.6-3.8,5.5-8.7,5.5-13.9l-.2-18.4c0-6-2.7-11.3-6.9-14.9-.3-.3-.7-.6-1.1-.9-.4-.3-.8-.6-1.2-.8-.4-.3-.8-.5-1.3-.8-.4-.2-.9-.5-1.3-.7-.2-.4-.4-.9-.7-1.3-.2-.4-.5-.8-.7-1.2-.3-.4-.5-.8-.8-1.2-.2-.3-.4-.5-.6-.8,0,0,0,0,0,0,2.7-.7,5.2-2,7.3-3.8,3.5,3.2,8.2,5.2,13.4,5.2h31.3l-5.3,53.4c-.6,5.7,1.3,11.1,4.8,15.1.6.7,1.3,1.4,2,2,.6.7,1.3,1.4,2,2,.3.3.7.6,1.1.9h0c.4.3.8.6,1.2.9.4.3.8.5,1.2.7.2.4.5.9.8,1.3.2.4.5.8.8,1.2h0c.3.4.6.8.9,1.1,3.2,3.7,7.8,6.3,13.2,6.8.7,0,1.3,0,2,0,10.3,0,18.9-7.8,19.9-18l6.7-67.4h35.2l-3.1,54.2c-.3,5.2,1.5,10.3,4.9,14.2.2.2.4.4.6.6.5.5.9.9,1.4,1.4.2.2.4.4.6.6.5.5.9.9,1.4,1.4.4.3.8.6,1.1.9.4.3.8.6,1.2.8.4.3.8.5,1.3.7.2.4.5.9.7,1.3.3.4.5.8.8,1.2.3.4.6.7.9,1.1.2.2.4.4.6.6,3.8,4,9.1,6.3,14.5,6.3h99.6c4.9,0,9.7-1.8,13.3-5.1l18.6-16.7.7-.6c.8,2,2,3.8,3.4,5.5.6.7,1.3,1.4,2,2,.6.7,1.3,1.4,2,2,.4.3.7.6,1.1.9.4.3.8.6,1.2.8.4.3.8.5,1.3.8.2.4.5.8.7,1.2.3.4.5.8.8,1.2.3.4.6.7.9,1.1,3.4,3.9,8.2,6.5,13.8,6.9.5,0,.9,0,1.4,0,.7,0,1.3,0,2,0-2.2,2.9-3.6,6.5-4,10.4l-6,67.1c-.5,5.6,1.4,10.9,4.8,14.9.6.7,1.3,1.4,2,2,.6.7,1.3,1.4,2,2,.4.3.7.6,1.1.9.4.3.8.6,1.2.8.4.3.8.5,1.2.7.2.4.5.8.8,1.3.2.4.5.8.8,1.2.3.4.6.8.9,1.1,3.3,3.8,8,6.3,13.3,6.8.6,0,1.2,0,1.8,0,10.4,0,19-7.8,19.9-18.2l1.5-16.8h53.4c8.1,0,15-4.8,18.2-11.7h0c1.1-2.5,1.8-5.3,1.8-8.3s-.3-3.7-.8-5.5h0c-.7-2.4-1.8-4.6-3.3-6.6h5.9l-2.6,35.7c-.4,5.5,1.5,10.6,4.8,14.5h0s0,0,0,0c.6.7,1.3,1.4,2,2,.6.7,1.3,1.4,2,2,.4.3.7.6,1.1.9.4.3.8.6,1.2.8.4.3.8.5,1.2.7.2.4.5.9.8,1.3.2.4.5.8.8,1.2.3.4.6.8.9,1.1,3.3,3.9,8.1,6.4,13.6,6.8.5,0,1,0,1.5,0,10.4,0,19.2-8.1,19.9-18.6l1.1-15h43.8l-.2,2.3c-.3,5.3,1.4,10.4,4.9,14.4h0s0,0,0,.1c.6.7,1.2,1.3,1.9,1.9,0,0,0,0,0,.1.6.7,1.2,1.3,1.9,1.9.4.3.7.6,1.1.9.4.3.8.6,1.2.8.4.3.8.5,1.2.7.2.4.5.9.8,1.3.3.4.5.8.8,1.2.3.4.6.8.9,1.1,0,0,0,0,0,.1,3.5,4,8.4,6.4,13.8,6.7,7.2.4,13.8-3,17.6-8.6,0,0,0,0,0,0,0,0,.1-.2.2-.3.2.3.4.6.6.9.3.4.6.8.9,1.1.1.1.2.2.3.4,3.8,4.1,9.2,6.5,14.8,6.5h104.5c6,0,11.4-2.7,15.1-6.9,0,.1.2.2.3.4,3.8,4.1,9.2,6.5,14.8,6.5h104.5c11,0,20-9,20-20s-2.7-11.5-6.9-15.1ZM910.5,192.7l-1.3-1.4h0s-.5-.6-.5-.6c-.5-.5-1-1-1.5-1.4h0s-.4-.4-.4-.4h15.9c0,0,3.6-.1,3.6-.1-3,3.2-4.8,7.3-5.2,11.8l-.2,2.8-2-2.2h0s-2.2-2.4-2.2-2.4c-.5-.5-1-1-1.5-1.4h0c-.2-.2-.5-.4-.7-.6-.2-.1-.3-.3-.5-.4-.2-.1-.3-.2-.5-.4l-1.5-1.6-1.5-1.6ZM811,192.7h0c0,0-.2.2-.2.2-.1-.2-.3-.4-.4-.6-.3-.4-.6-.8-.9-1.1-.2-.2-.3-.4-.5-.5-.5-.5-1-1-1.5-1.5-.4-.5-.9-1-1.3-1.4,3.5-1.9,6.5-4.9,8.4-8.7,0,0,0,0,0-.1,0,0,0-.1,0-.2,0,0,0-.2.1-.3.2.1.4.2.6.3.2.4.5.8.8,1.3.2.4.5.8.8,1.2.3.4.6.8.9,1.1,0,0,.1.2.2.2,0,0,.1.2.2.2.7.7,1.3,1.4,2.1,2-1.3.7-2.5,1.6-3.6,2.6l-5.8,5.2ZM688.5,180.3c1.5-2.6,2.5-5.6,2.7-8.8l4.3-64.8v-.2s60.5,66.7,60.5,66.7l.3.4c.5.6,1.1,1.1,1.7,1.6l.3.4c.5.6,1.1,1.1,1.7,1.6.2.2.5.4.8.7.2.2.4.3.6.4.2.1.3.2.5.4l1.4,1.6h0c0,0,1.4,1.6,1.4,1.6l.4.4h-76c-.7,0-1.4,0-2.1.1.5-.7,1-1.4,1.4-2.1Z" />
    <path className="st2" d="M851.1,115.4" />
    <path className="st2" d="M726.7,232.5" />
    <path className="st2" d="M944.4,234" />
    <path className="st2" d="M850,234" />
    <path className="st0" d="M30.6,131.5v-27.2l138.5,99.9s50.8,41.9,124.7,41.9h342.4v6.2c-201.1,1.1-348.3,1.1-361.7,0-8.6-.7-17-2-17-2s-9.3-1.5-18.5-3.8c-28.9-7.2-52.2-19.1-69.4-30-46.3-28.3-92.7-56.6-139-84.9Z" />
    <path className="st0" d="M276,266.6c20.9,1,165.2,1,360.1,0v-6.2h-342.4l-20.1-.2c-14.5-.2-28.9-2-43-5.5-19.7-4.9-44.7-13.8-58.6-20.9l-85.4-43.7v26.7l109.5,38.8s26.8,10.1,76.2,11.1c1.2,0,2.5,0,3.7,0Z" />
    <path className="st0" d="M272.3,280.8c1.2,0,2.5,0,3.7,0,21.7.4,165.2,1,360.1,0v-6.2h-342.4l-20.1-.2h-29.4c-5.2,0-10.4-.4-15.6-1.1-6.6-.9-15.6-2.3-20.7-3.6l-64.7-16.3v27.4h129.2Z" />
    <path className="st1" d="M195.9,162.2c-.7-1.1-1.1-2.3-1.1-3.7,0-.1,0-.2,0-.3,0-4.1,3.4-7.5,7.5-7.5h98.5l.5-.5,1.9-2,1.9-2,1.9-2,13.8-14.6v-7.9h-118.1c-4.1,0-7.5-3.4-7.5-7.5v-22c0-2.1.8-4,2.3-5.4l21.2-20.1c1.4-1.3,3.2-2.1,5.2-2.1h104.4c2.8,0,5.2,1.5,6.5,3.8.7,1.1,1,2.4,1,3.7s-.4,2.9-1.2,4.1c-1.3,2.1-3.6,3.4-6.3,3.4h-101.4l-16.6,15.8v11.3h118c4.1,0,7.5,3.3,7.5,7.4l.2,18.4c0,1.9-.7,3.8-2,5.2l-24.2,25.6c-1.4,1.5-3.4,2.3-5.5,2.3h-101.7c-2.7,0-5-1.4-6.3-3.5Z" />
    <path className="st1" d="M402.8,160.5c-.3-.9-.4-2-.3-3.1l5.2-52.6,2.4-24.5h-56.1s0,0-.1,0c-.8,0-1.5-.1-2.2-.4-.8-.2-1.5-.6-2.2-1.1-.7-.5-1.3-1.2-1.8-1.9,0,0-.1-.2-.2-.3h0c-.6-1-1-2.2-1-3.4h0s0,0,0,0c0-.1,0-.2,0-.3,0-1.5.4-2.9,1.2-4.1.3-.5.7-.9,1.1-1.4.2-.2.5-.5.8-.7h0s0,0,0,0c.1-.1.3-.2.5-.3,0,0,0,0,0,0,0,0,0,0,.1,0,1.1-.6,2.3-.9,3.6-.9h134.4c4.1,0,7.5,3.3,7.5,7.5s-.2,1.9-.5,2.7c-.8,2.1-2.5,3.7-4.5,4.4-.8.3-1.6.4-2.4.4h-63.2l-7.8,78.6c-.4,3.9-3.6,6.8-7.5,6.8s-.5,0-.8,0c-3.1-.3-5.5-2.4-6.4-5.2Z" />
    <polygon className="st1" points="592.6 140.2 532.3 140.2 532.5 138.2 533.6 117.8 547.2 104.8 608.6 104.8 607.2 127.1 592.6 140.2" />
    <path className="st1" d="M634.1,67.7c-1.4-1.5-3.4-2.4-5.5-2.4h-101.5c-1.9,0-3.8.7-5.2,2.1l-5.6,5.4-.4.4-.8.7-1.1,1.1-1.6,1.6-2.4,2.3-4.5,4.3-7.6,7.2-1,1c-.8.8-1.5,1.8-1.9,2.9-.2.7-.4,1.4-.4,2.1v.3s0,.5,0,.5v1.7c0,0-.2,2-.2,2v2c-.1,0-.2,2-.2,2l-3,53c0,.5,0,1.1,0,1.6.2,1.5.9,2.9,2,4,1.4,1.5,3.4,2.4,5.5,2.4h99.6c1.8,0,3.6-.7,5-1.9l26.4-23.7c1.5-1.3,2.3-3.1,2.5-5.1l4-61.7c.1-2.1-.6-4.1-2-5.6ZM619,104.8l-1.7,26.2-2,1.8-17.2,15.4-2.2,2-.6.5h-88.8l2.8-48v-2.6c.1,0,10.3-9.7,10.3-9.7l10.6-10.1h90.5l-1.6,24.5Z" />
    <polygon className="st1" points="608.6 104.8 607.2 127.1 592.6 140.2 532.3 140.2 532.5 138.2 533.6 117.8 547.2 104.8 608.6 104.8" />
    <polygon className="st1" points="608.6 104.8 607.2 127.1 592.6 140.2 532.3 140.2 532.5 138.2 533.6 117.8 547.2 104.8 608.6 104.8" />
    <path className="st1" d="M651.9,159.7v-.4s0,0,0,0c-.1-.6-.1-1.1,0-1.7l.2-3.3,5.1-76.5v-.9c0-.4.1-.7.2-1.1,0-.4.2-.9.4-1.3.5-1.2,1.3-2.2,2.3-3l6.9-5.3c1.3-1,2.9-1.6,4.6-1.6h19.6c2.1,0,4.1.9,5.6,2.5l75.7,83.6h7.2l2-4.3.5-5,6.3-68.9v-1.1c.5-4,3.9-7,7.8-6.8.1,0,.3,0,.4,0,1.2.1,2.4.5,3.3,1.1,2.3,1.5,3.7,4.1,3.5,7l-7,76.3c0,.8-.3,1.7-.7,2.4l-4.5,9.8c-1.2,2.7-3.9,4.4-6.8,4.4h-15.4c-2.1,0-4.1-.9-5.6-2.5l-75.7-83.6h-13.7l-2.2,1.7-5.2,77.4c-.3,4-3.6,7-7.5,7s-.3,0-.5,0c-3.4-.2-6.2-2.8-6.8-6Z" />
    <path className="st1" d="M838.3,65.5l121.9.4c4.1,0,7.5,3.4,7.5,7.5,0,4.1-3.4,7.5-7.5,7.5h0l-122.9-.4-3.2,27.3h92.7c4.1,0,7.5,3.4,7.5,7.5s-3.4,7.5-7.5,7.5h-94.4l-3.1,27,120.8-.7c4.1,0,7.5,3.3,7.5,7.5,0,4.1-3.3,7.5-7.5,7.5l-129.2.8h0c-.1,0-.2,0-.4,0-.8,0-1.6-.2-2.4-.5-.8-.3-1.5-.8-2.2-1.4-.2-.2-.4-.4-.6-.6-.5-.6-.9-1.2-1.2-1.9h0c0-.2-.2-.4-.2-.6-.4-1.1-.5-2.2-.4-3.4l4.8-41.9h0s2.4-20.6,2.4-20.6v-.4s2.3-19.8,2.3-19.8h0s0-.3,0-.3l.2-1.4c0,0,0-.1,0-.2h0c0-.2,0-.4.1-.7.8-3.3,3.8-5.8,7.3-5.8h7.4s.3,0,.3,0Z" />
    <path className="st1" d="M674,269.5h0c-.3-.9-.4-1.8-.3-2.8l5.9-66h0s0-1.1,0-1.1c.4-3.9,3.6-6.8,7.5-6.8h103.1c4.1,0,7.5,3.3,7.5,7.5s0,.3,0,.4c-.2,3.6-2.9,6.4-6.3,7-.4,0-.8.1-1.2.1h-96.3l-1.5,17.1h63.4c4.1,0,7.5,3.4,7.5,7.5s-3.4,7.5-7.5,7.5h-64.8l-2.5,28.2c-.3,3.9-3.6,6.8-7.5,6.8s-.5,0-.7,0c-3.2-.3-5.7-2.5-6.5-5.3Z" />
    <path className="st1" d="M908.7,209.5l-13.2-14.3c-1.4-1.5-3.4-2.4-5.5-2.4h-61.9c-1.9,0-3.7.7-5,1.9l-5.4,4.8-.4.3-.7.6-1,.9-1.5,1.3-2.1,1.9-3.2,2.9-5.3,4.8c-1.4,1.2-2.2,2.9-2.4,4.8,0,0,0,.2,0,.3v.9c0,0,0,0,0,0l-.2,2.1-.2,2.9-.2,2.6-.2,2.4v2.1c-.1,0-.3,2-.3,2l-2.5,34.6c0,.8,0,1.5.2,2.2h0c.7,3.2,3.4,5.6,6.8,5.8.2,0,.4,0,.5,0,3.9,0,7.2-3,7.5-7l1.9-26.6h79.4l-1.5,24.5h.2l-.2,3h0c.6,3.3,3.4,5.9,6.9,6.1,4.1.2,7.7-2.9,8-7l3.3-52.8c.1-2-.6-4.1-2-5.6ZM894.9,226.4h-79.3l.3-3.5v-1.5c.1,0,2.2-1.9,2.2-1.9l3.9-3.5,9-8.2h55.7l8.8,9.5-.6,9.1Z" />
    <path className="st1" d="M932.2,274.9c-.7,0-1.4-.3-2.1-.6-.7-.3-1.4-.8-2-1.3-.2-.1-.3-.3-.5-.5-.6-.7-1.1-1.5-1.5-2.4,0-.2-.1-.4-.2-.6h0c-.3-.9-.4-1.8-.3-2.8l2.3-25.4v-.4s2.2-24.7,2.2-24.7h0s.2-2,.2-2v-.7c0,0,1.2-12.9,1.2-12.9v-1.1c.5-4,3.9-7,7.9-6.8.1,0,.3,0,.4,0,1.2.1,2.4.5,3.3,1.1h0c2.3,1.5,3.7,4.1,3.5,7l-5.3,59h96.3c4.1,0,7.5,3.4,7.5,7.5s-3.4,7.5-7.5,7.5h-104.5c-.3,0-.6,0-.9,0Z" />
    <path className="st1" d="M1066.2,200.7v-1.1c.4-4,3.9-7,7.8-6.8h0c.1,0,.2,0,.4,0,1.2.1,2.4.5,3.3,1.1,2.3,1.5,3.7,4.1,3.5,7l-5.3,59h96.3c4.2,0,7.5,3.4,7.5,7.5s-3.3,7.5-7.5,7.5h-104.5c0,0-.2,0-.3,0-.6,0-1.3-.1-1.9-.3-.7-.2-1.4-.5-2-.9-.5-.3-1-.7-1.4-1.2-.2-.2-.4-.5-.6-.8-.5-.7-.8-1.4-1-2.2h0c-.3-.9-.4-1.8-.3-2.8l.2-2,.2-1.8v-.2s0-.4,0-.4l5.5-61.6h0Z" />
  </svg>
);
