import React from 'react';
import { TournamentStatusResponse, FindMatchResponse } from '../../../shared/types/api';
import { TronHud } from './TronHud';

interface TournamentOverlayProps {
  status: TournamentStatusResponse | null;
  loading: boolean;
  error: string | null;
  isFindingMatch: boolean;
  currentMatch: FindMatchResponse | null;
  onFindMatch: () => void;
  onStartMatch: () => void;
  onClose: () => void;
}

export const TournamentOverlay: React.FC<TournamentOverlayProps> = ({
  status,
  loading,
  error,
  isFindingMatch,
  currentMatch,
  onFindMatch,
  onStartMatch,
  onClose,
}) => {
  const seasonLabel = React.useMemo(() => {
    const endsAt = status?.seasonEndsAt;
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
  }, [status?.seasonEndsAt]);

  // If we are loading or have no status yet, we might want to just return null or a spinner
  if ((!status && !loading) && !error) return null;

  return (
    <div style={{
      position: 'absolute',
      // Position centrally near the top, allowing the grid to be seen behind/around
      top: '100px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 50,
      pointerEvents: 'none', // Allow clicks behind the HUD wrapper
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      filter: 'drop-shadow(0 0 20px rgba(0,0,0,0.6))'
    }}>
      <TronHud
        className="tournament-hud"
        style={{
          pointerEvents: 'auto',
          minWidth: '340px',
          padding: '20px',
          backgroundColor: 'rgba(5, 10, 20, 0.95)',
          border: '1px solid rgba(0, 242, 254, 0.6)',
          gap: '16px'
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          width: '100%',
          borderBottom: '1px solid rgba(0, 242, 254, 0.3)',
          paddingBottom: '12px'
        }}>
          <span className="tron-hud-label" style={{ fontSize: '12px', letterSpacing: '3px', color: '#00f2fe' }}>TOURNAMENT LINK</span>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#00f2fe',
              fontSize: '18px',
              cursor: 'pointer',
              padding: '0 4px',
              lineHeight: 1,
              opacity: 0.8
            }}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {status && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            gap: '16px',
            width: '100%',
            marginBottom: '4px'
          }}>
            <div className="tron-hud-section">
              <div className="tron-hud-label">RANK</div>
              <div className="tron-hud-value" style={{ color: '#ffe8d2', fontSize: '18px' }}>#{status.rank}</div>
            </div>
            <div className="tron-hud-section">
              <div className="tron-hud-label">ELO</div>
              <div className="tron-hud-value" style={{ color: '#00f2fe', fontSize: '18px' }}>{status.elo}</div>
            </div>
            <div className="tron-hud-section">
              <div className="tron-hud-label">TICKETS</div>
              <div className="tron-hud-value" style={{ color: status.tickets > 0 ? '#7bff4b' : '#ff4b4b', fontSize: '18px' }}>
                {status.tickets}
              </div>
            </div>
          </div>
        )}

        {error && (
          <div style={{ color: '#ff4b4b', fontSize: '11px', textAlign: 'center', background: 'rgba(255,0,0,0.1)', padding: '6px', borderRadius: '4px', width: '100%' }}>
            {error}
          </div>
        )}

        {/* Action Area */}
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {!currentMatch ? (
            isFindingMatch ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', padding: '10px' }}>
                <div className="tron-loading-spinner" style={{
                  width: '24px',
                  height: '24px',
                  border: '2px solid rgba(0,242,254,0.3)',
                  borderTopColor: '#00f2fe',
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite'
                }} />
                <span style={{ color: '#00f2fe', fontSize: '12px', letterSpacing: '1px', animation: 'pulse 1.5s infinite' }}>SEARCHING FOR OPPONENT...</span>
              </div>
            ) : (
              <button
                className="tron-reset-btn"
                onClick={stockTickets => onFindMatch()}
                disabled={!status || status.tickets <= 0}
                style={{ width: '100%', height: '48px', marginTop: '8px' }}
              >
                <div className="tron-reset-scan" />
                <span className="tron-reset-label" style={{ fontSize: '14px' }}>
                  {status && status.tickets > 0 ? 'FIND MATCH' : 'NO TICKETS'}
                </span>
                <div className="tron-reset-glow" />
              </button>
            )
          ) : (
            <div style={{ width: '100%', animation: 'fadeIn 0.3s ease' }}>
              <div style={{
                background: 'rgba(0,0,0,0.3)',
                padding: '16px',
                borderRadius: '6px',
                marginBottom: '16px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                border: '1px solid rgba(255, 75, 75, 0.3)'
              }}>
                <div className="tron-hud-label" style={{ color: '#94a3b8', marginBottom: '8px' }}>OPPONENT FOUND</div>
                <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#ff4b4b', textShadow: '0 0 10px rgba(255, 75, 75, 0.4)' }}>
                  {currentMatch.opponent.username}
                </div>
                <div style={{ fontSize: '14px', color: '#94a3b8', marginTop: '4px' }}>{currentMatch.opponent.elo} ELO</div>
              </div>

              <button
                className="tron-reset-btn"
                onClick={onStartMatch}
                style={{
                  width: '100%',
                  height: '48px',
                  '--tron-player-accent': '#ff4b4b',
                  '--tron-player-accent-rgb': '255, 75, 75'
                } as any}
              >
                <div className="tron-reset-scan" />
                <span className="tron-reset-label" style={{ fontSize: '14px' }}>START BATTLE</span>
                <div className="tron-reset-glow" />
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        {seasonLabel && (
          <div style={{
            fontSize: '9px',
            color: '#64748b',
            letterSpacing: '1px',
            textTransform: 'uppercase',
            textAlign: 'center',
            marginTop: 'auto'
          }}>
            {seasonLabel}
          </div>
        )}
      </TronHud>

      <style>{`
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  );
};
