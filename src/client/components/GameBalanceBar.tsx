import React, { useMemo } from 'react';
import { useTowerColorStats } from '../hooks/useTowerColorStats';

const clampPercentage = (value: number): number => Math.min(100, Math.max(0, value));

interface GameBalanceBarProps {
  type?: 'all-time' | 'daily';
}

export const GameBalanceBar: React.FC<GameBalanceBarProps> = ({ type = 'all-time' }) => {
  const towerStats = useTowerColorStats(undefined, type);

  const orangePercentage = towerStats?.colorTotals.orange.percentage ?? null;
  const bluePercentage = towerStats?.colorTotals.blue.percentage ?? null;
  const hasBalanceData = orangePercentage !== null && bluePercentage !== null;

  const gridBalanceDivider = useMemo(() => {
    if (!hasBalanceData || bluePercentage === null) {
      return 50;
    }
    return clampPercentage(bluePercentage);
  }, [bluePercentage, hasBalanceData]);

  const gridBalanceLeftStyle = useMemo<React.CSSProperties>(() => {
    const width = hasBalanceData ? `${gridBalanceDivider}%` : '50%';
    return {
      width,
      background: 'linear-gradient(90deg, #67e8f9 0%, #18a7ff 100%)',
      boxShadow: '0 0 14px rgba(24, 167, 255, 0.45)',
    };
  }, [gridBalanceDivider, hasBalanceData]);

  const gridBalanceRightStyle = useMemo<React.CSSProperties>(() => {
    const width = hasBalanceData ? `${100 - gridBalanceDivider}%` : '50%';
    return {
      width,
      background: 'linear-gradient(90deg, #ffb067 0%, #ff5c1a 100%)',
      boxShadow: '0 0 14px rgba(255, 110, 50, 0.45)',
    };
  }, [gridBalanceDivider, hasBalanceData]);

  return (
    <div className="tron-hud-section">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '9px',
            fontWeight: 600,
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            gap: '12px'
          }}
        >
          <span style={{ color: '#8ce8ff', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '9px', letterSpacing: '0.08em', color: '#e6fbff' }}>
              {hasBalanceData && bluePercentage !== null ? `${Math.round(bluePercentage)}%` : '--'}
            </span>
            <span>Users</span>
          </span>
          <span style={{ color: '#ffc598', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '9px', letterSpacing: '0.08em', color: '#ffe8d2' }}>
              {hasBalanceData && orangePercentage !== null ? `${Math.round(orangePercentage)}%` : '--'}
            </span>
            <span>Programs</span>
          </span>
        </div>
        <div
          style={{
            position: 'relative',
            height: '14px',
            width: '100%',
            borderRadius: '999px',
            background: '#020c16',
            border: '1px solid rgba(99, 233, 255, 0.35)',
            boxShadow: 'inset 0 0 12px rgba(0,0,0,0.75), 0 0 14px rgba(0, 255, 255, 0.08)',
            overflow: 'hidden',
          }}
        >
          <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
            <div style={{ ...gridBalanceLeftStyle, height: '100%' }} />
            <div style={{ ...gridBalanceRightStyle, height: '100%' }} />
          </div>
          <div
            className="tron-hud-scan"
            style={{
              position: 'absolute',
              inset: 0,
              opacity: 0.35,
              mixBlendMode: 'screen',
            }}
          />
          <div
            style={{
              position: 'absolute',
              top: '1px',
              bottom: '1px',
              left: `calc(${gridBalanceDivider}% - 3px)`,
              width: '6px',
              borderRadius: '3px',
              background:
                'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.95) 50%, rgba(255,255,255,0) 100%)',
              boxShadow: '0 0 10px rgba(255,255,255,0.6)',
            }}
          />
        </div>
      </div>
    </div>
  );
};
