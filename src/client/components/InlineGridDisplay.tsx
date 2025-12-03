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

interface InlineGridDisplayProps {
  preAssignedTowers?: TowerMapEntry[] | null;
  placementSystem: TowerPlacementSystem;
  playerTower?: TowerMapEntry | null;
  targetUsername?: string | null;
  onExpand: (event: React.MouseEvent) => void | Promise<void>;
}

const stubGameState = { isGameOver: true } as const;
const clampPercentage = (value: number): number => Math.min(100, Math.max(0, value));

export const InlineGridDisplay: React.FC<InlineGridDisplayProps> = ({
  preAssignedTowers,
  placementSystem,
  playerTower = null,
  targetUsername,
  onExpand,
}) => {
  const towerStats = useTowerColorStats();
  const gridConfig = React.useMemo(() => placementSystem?.getConfiguration?.(), [placementSystem]);
  const inlineGridSize = gridConfig?.gridSize ?? DEFAULT_TOWER_GRID_SIZE;
  const inlineGridOffsetX = gridConfig?.gridOffsetX ?? DEFAULT_TOWER_GRID_OFFSET;
  const inlineGridOffsetZ = gridConfig?.gridOffsetZ ?? DEFAULT_TOWER_GRID_OFFSET;

  const allTowers = React.useMemo(() => {
    const towers: TowerMapEntry[] = [];
    if (playerTower && typeof playerTower.worldX === 'number' && typeof playerTower.worldZ === 'number') {
      towers.push(playerTower);
    }
    if (preAssignedTowers) {
      preAssignedTowers.forEach(t => {
        if (t.sessionId !== playerTower?.sessionId && typeof t.worldX === 'number' && typeof t.worldZ === 'number') {
          towers.push(t);
        }
      });
    }
    return towers;
  }, [playerTower, preAssignedTowers]);

  const targetTower = React.useMemo(() => {
    if (!targetUsername) return null;
    return allTowers.find(t => t.username === targetUsername) || null;
  }, [allTowers, targetUsername]);

  const totalTowerCount = towerStats?.totalCount ?? null;
  const orangePercentage = towerStats?.colorTotals.orange.percentage ?? null;
  const bluePercentage = towerStats?.colorTotals.blue.percentage ?? null;
  const hasBalanceData = orangePercentage !== null && bluePercentage !== null;
  const gridBalanceDivider = React.useMemo(() => {
    if (!hasBalanceData || bluePercentage === null) {
      return 50;
    }
    return clampPercentage(bluePercentage);
  }, [bluePercentage, hasBalanceData]);

  const gridTintHex = React.useMemo(() => mixGridTintHex(bluePercentage), [bluePercentage]);

  const gridBalanceLeftStyle = React.useMemo<React.CSSProperties>(() => {
    const width = hasBalanceData ? `${gridBalanceDivider}%` : '50%';
    return {
      width,
      background: 'linear-gradient(90deg, #67e8f9 0%, #18a7ff 100%)',
      boxShadow: '0 0 14px rgba(24, 167, 255, 0.45)',
    };
  }, [gridBalanceDivider, hasBalanceData]);

  const gridBalanceRightStyle = React.useMemo<React.CSSProperties>(() => {
    const width = hasBalanceData ? `${100 - gridBalanceDivider}%` : '50%';
    return {
      width,
      background: 'linear-gradient(90deg, #ffb067 0%, #ff5c1a 100%)',
      boxShadow: '0 0 14px rgba(255, 110, 50, 0.45)',
    };
  }, [gridBalanceDivider, hasBalanceData]);

  return (
    <div className="w-full h-full relative cursor-pointer overflow-hidden group">
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
          preAssignedTowers={preAssignedTowers}
          selectedTower={targetTower}
          onTowerClick={() => { }}
        />

        <TowerCameraController
          selectedTower={targetTower}
          isGameOver={true}
          getTowersData={() => allTowers}
          rotationSpeedMultiplier={0.5}
        />
      </Canvas>

      {/* Tron Styled Overlay - Using shared GameUI styles */}
      <div className="top-0 w-full h-full absolute inset-0 select-none flex flex-col justify-between" style={{ top: 0 }} >
        {/* Top Gradient */}
        <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-b from-black/80 to-transparent pointer-events-none" />

        {/* Bottom Gradient */}
        <div className="absolute bottom-0 left-0 right-0 h-48 bg-gradient-to-t from-black/90 via-black/50 to-transparent" />

        {/* Top HUD */}
        <div className="absolute top-6 left-1/2 -translate-x-1/2 w-auto pointer-events-none" style={{ padding: '24px' }}>
          <div className="tron-game-hud" style={{ width: 'unset', minWidth: 'unset', padding: '10px 20px', gap: '20px' }}>
            <div className="tron-hud-scan" />

            {/* Grid Balance Section */}
            <div className="tron-hud-section">
              {/* <div className="tron-hud-label">GRID BALANCE</div> */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
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
                      {hasBalanceData && bluePercentage !== null ? `${bluePercentage}%` : '--'}
                    </span>
                    <span>Users</span>
                  </span>
                  <span style={{ color: '#ffc598', display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '9px', letterSpacing: '0.08em', color: '#ffe8d2' }}>
                      {hasBalanceData && orangePercentage !== null ? `${orangePercentage}%` : '--'}
                    </span>
                    <span>Programs</span>
                  </span>
                </div>
                <div
                  style={{
                    position: 'relative',
                    height: '14px',

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

            {/* Tower Count Section */}
            <div className="tron-hud-section" style={{ borderLeft: '1px solid rgba(0, 255, 255, 0.3)', paddingLeft: '20px' }}>
              <div className="tron-hud-label">TOWERS ONLINE</div>
              <div className="tron-hud-value" style={{ fontSize: '18px', height: '24px', minWidth: 'auto' }}>
                {typeof totalTowerCount === 'number' ? totalTowerCount.toLocaleString() : '--'}
              </div>
            </div>
          </div>
        </div>

        {/* Center CTA */}
        <button
          type="button"
          onClick={onExpand}
          className="justify-end w-full h-full absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center"
          style={{ padding: '24px', gap: '24px', background: 'transparent', border: 'none' }}
        >
          <div className="tron-start-button group-hover:scale-105 transition-transform duration-300" style={{ padding: '12px 32px' }}>
            <div className="tron-start-button-scan" />
            <div className="tron-start-button-content" style={{ gap: '12px' }}>
              <div className="tron-start-button-text" style={{ fontSize: '14px' }}>ENTER GRID</div>
              <div className="tron-start-button-icon" style={{ fontSize: '16px' }}>▶</div>
            </div>
            <div className="tron-start-button-glow" />
          </div>
          <div className="mt-3">
            <span className="tron-hud-label" style={{ fontSize: '9px', opacity: 0.8, letterSpacing: '0.2em' }}>TAP TO INITIALIZE</span>
          </div>
        </button>
      </div>
    </div>
  );
};
