import React from 'react';
import './gameEndModal.css'; // Reusing the same CSS for consistency

interface TournamentResultModalProps {
  isVisible: boolean;
  result: 'win' | 'loss' | 'practice' | null;
  score: number;
  blocks: number;
  perfectStreak: number;
  maxCombo: number;
  opponentName: string;
  opponentScore: number;
  eloChange: number;
  newElo: number;
  ticketsRemaining?: number | null;
  onContinue: () => void;
  onRetry: () => void;
}

export const TournamentResultModal: React.FC<TournamentResultModalProps> = ({
  isVisible,
  result,
  score,
  // Stats unused as per request to clean clutter
  // blocks,
  // perfectStreak,
  // maxCombo,
  opponentName,
  opponentScore,
  eloChange,
  newElo,
  ticketsRemaining,
  onContinue,
  onRetry
}) => {
  if (!isVisible || !result) return null;

  const isWin = result === 'win';
  // If result is 'practice', we can treat it visually like a neutral state or a win, 
  // but let's stick to the neon theme colors.
  const themeColor = result === 'practice'
    ? { primary: '#00f2fe', secondary: '#00c2ce', bg: 'rgba(0, 242, 254, 0.1)' } // Cyan for practice
    : isWin
      ? { primary: '#00ffaa', secondary: '#00cc88', bg: 'rgba(0, 255, 170, 0.1)' } // Green for win
      : { primary: '#ff3366', secondary: '#cc2952', bg: 'rgba(255, 51, 102, 0.1)' }; // Red for loss

  const delta = score - opponentScore;
  const deltaLabel = delta === 0 ? 'SYNCED' : delta > 0 ? `+${delta.toLocaleString()}` : `${delta.toLocaleString()}`;
  const statusLabel = result === 'practice' ? 'SIM COMPLETE' : isWin ? 'VICTORY SEQUENCE' : 'DEFEAT LOGGED';
  const primaryActionLabel = result === 'practice'
    ? 'RUN ANOTHER SIM'
    : isWin
      ? 'SEEK NEW PROGRAM'
      : 'RECALIBRATE & REMATCH';

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        paddingBottom: '28px',
        zIndex: 60,
      }}
    >
      <div
        style={{
          pointerEvents: 'auto',
          display: 'grid',
          gap: '10px',
          minWidth: '320px',
          maxWidth: '560px',
          width: 'min(560px, 92vw)',
          background: 'rgba(3, 8, 18, 0.72)',
          border: `1px solid ${themeColor.primary}`,
          boxShadow: `0 0 22px ${themeColor.bg}`,
          backdropFilter: 'blur(10px)',
          borderRadius: '10px',
          padding: '14px 16px',
          fontFamily: 'var(--font-mono)',
          color: '#e2e8f0',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
          <div style={{ letterSpacing: '0.18em', fontSize: '11px', color: themeColor.primary }}>
            {statusLabel}
          </div>
          {result !== 'practice' && (
            <div style={{ fontSize: '12px', color: eloChange >= 0 ? '#00ffaa' : '#ff3366' }}>
              RATING {newElo} {eloChange >= 0 ? `(+${eloChange})` : `(${eloChange})`}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
          <div>
            <div style={{ fontSize: '10px', color: '#94a3b8', letterSpacing: '0.12em' }}>YOU</div>
            <div style={{ fontSize: '26px', fontWeight: 700, color: isWin || result === 'practice' ? '#00ffaa' : '#ffffff' }}>
              {score.toLocaleString()}
            </div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '10px', color: '#64748b', letterSpacing: '0.2em' }}>DELTA</div>
            <div style={{ fontSize: '16px', color: delta >= 0 ? '#7bff4b' : '#ff4b4b' }}>{deltaLabel}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '10px', color: '#94a3b8', letterSpacing: '0.12em' }}>
              {result === 'practice' ? 'TARGET' : opponentName}
            </div>
            <div style={{ fontSize: '26px', fontWeight: 700, color: !isWin && result !== 'practice' ? '#ff3366' : 'rgba(255,255,255,0.7)' }}>
              {opponentScore.toLocaleString()}
            </div>
          </div>
        </div>

        {typeof ticketsRemaining === 'number' && (
          <div style={{ fontSize: '11px', color: '#94a3b8' }}>
            TICKETS: <span style={{ color: ticketsRemaining > 0 ? '#7bff4b' : '#ff4b4b' }}>{ticketsRemaining}</span>
          </div>
        )}

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button
            className="tron-action-button"
            onClick={onContinue}
            style={{
              padding: '10px 14px',
              fontSize: '12px',
              borderColor: 'rgba(255,255,255,0.2)',
              color: '#cbd5f5',
              background: 'rgba(255,255,255,0.03)',
            }}
          >
            CLOSE
          </button>
          <button
            className="tron-action-button"
            onClick={onRetry}
            style={{
              padding: '10px 14px',
              fontSize: '12px',
              borderColor: themeColor.primary,
              color: themeColor.primary,
              background: `linear-gradient(90deg, ${themeColor.bg} 0%, transparent 100%)`,
            }}
          >
            ⚡ {primaryActionLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
