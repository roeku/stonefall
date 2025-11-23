import React from 'react';
import { Canvas } from '@react-three/fiber';
import { TowerMapEntry } from '../../shared/types/api';
import { TowerPlacementSystem } from '../../shared/types/towerPlacement';
import { GPUInstancedTowerSystem } from './GPUInstancedTowerSystem';
import { TowerCameraController } from './TowerCameraController';
import { TronBackground } from './TronBackground';
import { EffectsRenderer } from './EffectsRenderer';

interface InlineGridDisplayProps {
  preAssignedTowers?: TowerMapEntry[] | null;
  placementSystem: TowerPlacementSystem;
  playerTower?: TowerMapEntry | null;
  targetUsername?: string | null;
  onExpand: (event: React.MouseEvent) => void;
}

const stubGameState = { isGameOver: true } as const;

export const InlineGridDisplay: React.FC<InlineGridDisplayProps> = ({
  preAssignedTowers,
  placementSystem: _placementSystem,
  playerTower = null,
  targetUsername,
  onExpand,
}) => {
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

  const towerCount = allTowers.length;

  return (
    <div className="w-full h-full relative cursor-pointer overflow-hidden group" onClick={onExpand}>
      <Canvas
        dpr={[0.6, 1.1]}
        shadows={false}
        camera={{ position: [30.4, 21.1, 30], fov: 25, near: 1.86, far: 3500 }}
        gl={{ antialias: false, alpha: false, powerPreference: 'high-performance' }}
        frameloop="always"
        style={{ pointerEvents: 'none' }}
      >
        <color attach="background" args={["#000814"]} />

        <TronBackground
          gameState={stubGameState}
          gridSize={8}
          gridOffsetX={-4}
          gridOffsetZ={-4}
          gridLineWidth={3}
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
      <div className="top-0 w-full h-full absolute inset-0 pointer-events-none select-none" style={{ top: 0 }}>
        {/* Top Gradient */}
        <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-b from-black/80 to-transparent" />

        {/* Bottom Gradient */}
        <div className="absolute bottom-0 left-0 right-0 h-48 bg-gradient-to-t from-black/90 via-black/50 to-transparent" />

        {/* Top HUD */}
        <div className="absolute top-6 left-1/2 -translate-x-1/2 w-auto" style={{ padding: '24px' }}>
          <div className="tron-game-hud" style={{ width: 'unset', minWidth: 'unset', padding: '10px 20px', gap: '20px' }}>
            <div className="tron-hud-scan" />

            {/* Title Section */}
            <div className="tron-hud-section">
              <div className="tron-hud-label">LIVE FEED</div>
              <div className="tron-score-value" style={{ fontSize: '18px', height: '24px', minWidth: 'auto' }}>STONEFALL</div>
            </div>

            {/* Tower Count Section */}
            <div className="tron-hud-section" style={{ borderLeft: '1px solid rgba(0, 255, 255, 0.3)', paddingLeft: '20px' }}>
              <div className="tron-hud-label">ACTIVE TOWERS</div>
              <div className="tron-hud-value" style={{ fontSize: '18px', height: '24px', minWidth: 'auto' }}>
                {towerCount > 0 ? towerCount : '--'}
              </div>
            </div>
          </div>
        </div>

        {/* Center CTA */}
        <div className="justify-end w-full h-full absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center" style={{ padding: '24px', gap: '24px' }}>
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
        </div>
      </div>
    </div>
  );
};
