import React from 'react';
import { TournamentLeaderboardResponse } from '../../../shared/types/api';

interface EloLeaderboardOverlayProps {
  isOpen: boolean;
  loading: boolean;
  error: string | null;
  data: TournamentLeaderboardResponse | null;
  onViewChange: (view: 'top' | 'around') => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
  standalone?: boolean;
}

export const EloLeaderboardOverlay: React.FC<EloLeaderboardOverlayProps> = ({
  isOpen,
  loading,
  error,
  data,
  onViewChange,
  onPreviousPage,
  onNextPage,
  standalone = false,
}) => {
  if (!isOpen) {
    return null;
  }

  const rows = data?.players ?? data?.topPlayers ?? [];

  return (
    <div
      style={{
        position: standalone ? 'relative' : 'absolute',
        inset: standalone ? undefined : 0,
        zIndex: standalone ? 1 : 120,
        background: standalone ? '#020617' : 'rgba(0, 0, 0, 0.72)',
        backdropFilter: standalone ? undefined : 'blur(4px)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
        paddingTop: standalone ? '12px' : '64px',
        paddingLeft: '10px',
        paddingRight: '10px',
        paddingBottom: '12px',
        width: '100%',
        height: '100%',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: standalone ? '680px' : '560px',
          background: 'rgba(5, 10, 20, 0.96)',
          border: '1px solid rgba(0, 242, 254, 0.5)',
          borderRadius: '14px',
          color: '#e2e8f0',
          boxShadow: '0 0 20px rgba(0, 242, 254, 0.15)',
          padding: 'clamp(10px, 2.8vw, 18px)',
          maxHeight: standalone ? '96vh' : '82vh',
          overflow: 'auto',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <div style={{ fontSize: 'clamp(14px, 3.6vw, 18px)', letterSpacing: '1.5px', color: '#00f2fe', fontWeight: 700 }}>
            LEADERBOARD
          </div>
          <div style={{ display: 'flex', gap: '8px', marginLeft: 'auto' }}>
            <button
              onClick={() => onViewChange('top')}
              style={{
                background:
                  data?.view === 'top' ? 'rgba(0, 242, 254, 0.2)' : 'rgba(0, 242, 254, 0.08)',
                border: '1px solid rgba(0, 242, 254, 0.45)',
                color: '#00f2fe',
                borderRadius: '6px',
                padding: '6px 12px',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: 600,
                minHeight: '34px',
              }}
            >
              Top 5
            </button>
            <button
              onClick={() => onViewChange('around')}
              style={{
                background:
                  data?.view === 'around' ? 'rgba(0, 242, 254, 0.2)' : 'rgba(0, 242, 254, 0.08)',
                border: '1px solid rgba(0, 242, 254, 0.45)',
                color: '#00f2fe',
                borderRadius: '6px',
                padding: '6px 12px',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: 600,
                minHeight: '34px',
              }}
            >
              Around Me
            </button>
          </div>
        </div>

        {loading && <div style={{ marginTop: '14px', fontSize: '13px', color: '#94a3b8' }}>Loading rankings...</div>}

        {!loading && error && (
          <div style={{ marginTop: '14px', fontSize: '13px', color: '#ff7b7b' }}>{error}</div>
        )}

        {!loading && !error && data && (
          <>
            {data.currentPlayer && (
              <div
                style={{
                  marginBottom: '12px',
                  marginTop: '12px',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  background: 'rgba(0, 242, 254, 0.08)',
                  border: '1px solid rgba(0, 242, 254, 0.35)',
                  fontSize: 'clamp(12px, 3.4vw, 14px)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                You: #{data.currentPlayer.rank} • {data.currentPlayer.username} • {data.currentPlayer.elo} ELO
              </div>
            )}

            <div style={{ display: 'grid', gap: '7px' }}>
              {rows.map((player) => (
                <div
                  key={player.userId}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '48px minmax(0, 1fr) auto',
                    gap: '8px',
                    alignItems: 'center',
                    background: 'rgba(15, 23, 42, 0.6)',
                    border: '1px solid rgba(148, 163, 184, 0.25)',
                    borderRadius: '8px',
                    padding: '9px 10px',
                    fontSize: 'clamp(12px, 3.5vw, 14px)',
                  }}
                >
                  <div style={{ color: '#00f2fe', fontWeight: 700, textAlign: 'left' }}>#{player.rank}</div>
                  <div style={{ color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {player.username}
                  </div>
                  <div style={{ color: '#f8fafc', fontWeight: 700, textAlign: 'right', minWidth: '48px' }}>{player.elo}</div>
                </div>
              ))}
            </div>

            {data.view === 'top' && data.totalPages > 1 && (
              <div
                style={{
                  marginTop: '12px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '12px',
                }}
              >
                <button
                  onClick={onPreviousPage}
                  disabled={data.page <= 1}
                  style={{
                    background: 'rgba(0, 242, 254, 0.08)',
                    border: '1px solid rgba(0, 242, 254, 0.45)',
                    color: data.page <= 1 ? 'rgba(0, 242, 254, 0.4)' : '#00f2fe',
                    borderRadius: '6px',
                    padding: '4px 10px',
                    cursor: data.page <= 1 ? 'default' : 'pointer',
                    fontSize: '12px',
                  }}
                >
                  Prev
                </button>

                <div style={{ fontSize: '12px', color: '#94a3b8' }}>
                  Page {data.page} / {data.totalPages}
                </div>

                <button
                  onClick={onNextPage}
                  disabled={data.page >= data.totalPages}
                  style={{
                    background: 'rgba(0, 242, 254, 0.08)',
                    border: '1px solid rgba(0, 242, 254, 0.45)',
                    color: data.page >= data.totalPages ? 'rgba(0, 242, 254, 0.4)' : '#00f2fe',
                    borderRadius: '6px',
                    padding: '4px 10px',
                    cursor: data.page >= data.totalPages ? 'default' : 'pointer',
                    fontSize: '12px',
                  }}
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
