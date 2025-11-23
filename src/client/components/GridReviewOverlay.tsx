import React from 'react';
import { Canvas } from '@react-three/fiber';
import { TowerMapEntry } from '../../shared/types/api';
import {
  TowerPlacementSystem,
  DEFAULT_TOWER_GRID_OFFSET,
  DEFAULT_TOWER_GRID_SIZE,
} from '../../shared/types/towerPlacement';
import { GPUInstancedTowerSystem } from './GPUInstancedTowerSystem';
import { TowerCameraController } from './TowerCameraController';
import { TronBackground } from './TronBackground';
import { EffectsRenderer } from './EffectsRenderer';
import { useTowerColorStats } from '../hooks/useTowerColorStats';
import { mixGridTintHex } from '../utils/gridColors';

interface GridReviewOverlayProps {
  selectedTower?: TowerMapEntry | null;
  onTowerClick?: (tower: TowerMapEntry, position: [number, number, number], rank?: number) => void;
  onClose: () => void;
  preAssignedTowers?: TowerMapEntry[] | null;
  placementSystem: TowerPlacementSystem;
  isLoading?: boolean;
  error?: string | null;
  onRequestReload?: () => void | Promise<void>;
  onClearAssignments?: () => void;
  playerTower?: TowerMapEntry | null;
}

const stubGameState = { isGameOver: true } as const;

export const GridReviewOverlay: React.FC<GridReviewOverlayProps> = ({
  selectedTower,
  onTowerClick,
  onClose,
  preAssignedTowers,
  placementSystem,
  isLoading = false,
  error = null,
  onRequestReload,
  onClearAssignments,
  playerTower = null,
}) => {
  const [towersData, setTowersData] = React.useState<TowerMapEntry[]>([]);
  const towerStats = useTowerColorStats();
  const bluePercentage = towerStats?.colorTotals.blue.percentage ?? null;
  const gridTintHex = React.useMemo(() => mixGridTintHex(bluePercentage), [bluePercentage]);
  const gridConfig = React.useMemo(() => placementSystem?.getConfiguration?.(), [placementSystem]);
  const reviewGridSize = gridConfig?.gridSize ?? DEFAULT_TOWER_GRID_SIZE;
  const reviewGridOffsetX = gridConfig?.gridOffsetX ?? DEFAULT_TOWER_GRID_OFFSET;
  const reviewGridOffsetZ = gridConfig?.gridOffsetZ ?? DEFAULT_TOWER_GRID_OFFSET;

  React.useEffect(() => {
    const filtered: TowerMapEntry[] = [];
    if (playerTower && typeof playerTower.worldX === 'number' && typeof playerTower.worldZ === 'number') {
      filtered.push(playerTower);
    }

    if (preAssignedTowers && preAssignedTowers.length) {
      preAssignedTowers.forEach((tower) => {
        if (typeof tower.worldX === 'number' && typeof tower.worldZ === 'number') {
          if (tower.sessionId === playerTower?.sessionId) {
            return;
          }
          filtered.push(tower);
        }
      });
    }

    setTowersData(filtered);
  }, [preAssignedTowers, playerTower]);

  const handleTowersLoaded = React.useCallback((towers: TowerMapEntry[]) => {
    setTowersData(
      towers.filter((tower) => typeof tower.worldX === 'number' && typeof tower.worldZ === 'number')
    );
  }, []);

  const towersForCamera = React.useMemo(() => towersData, [towersData]);

  const handleTowerFocus = React.useCallback(
    (tower: TowerMapEntry, position: [number, number, number], rank?: number) => {
      if (onTowerClick) {
        onTowerClick(tower, position, rank);
      }
    },
    [onTowerClick]
  );

  const handleRefresh = React.useCallback(() => {
    if (isLoading) return;
    onClearAssignments?.();
    onRequestReload?.();
  }, [isLoading, onClearAssignments, onRequestReload]);

  return (
    <div className="tron-grid-review-overlay">
      <div className="tron-grid-review-bg" />

      <div className="tron-grid-review-back">
        <button
          type="button"
          className="tron-audio-toggle tron-grid-review-back-btn"
          onClick={onClose}
          aria-label="Return to start"
        >
          <div className="tron-audio-scan" />
          <div className="tron-audio-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M20 11H7.83l5.58-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
            </svg>
          </div>
          <div className="tron-audio-status">Back</div>
          <div className="tron-audio-glow" />
        </button>
      </div>

      <div className="tron-grid-review-canvas">
        <Canvas
          dpr={[0.6, 1.1]}
          shadows={false}
          gl={{ antialias: false, alpha: false, powerPreference: 'high-performance' }}
          frameloop="always"
        >
          <color attach="background" args={["#000814"]} />

          <TronBackground
            gameState={stubGameState}
            gridSize={reviewGridSize}
            gridOffsetX={reviewGridOffsetX}
            gridOffsetZ={reviewGridOffsetZ}
            gridLineWidth={3}
            gridColorHex={gridTintHex}
          />
          <EffectsRenderer />

          <GPUInstancedTowerSystem
            isGameOver={true}
            playerTower={playerTower}
            preAssignedTowers={preAssignedTowers}
            selectedTower={selectedTower || null}
            onTowerClick={handleTowerFocus}
            onTowersLoaded={handleTowersLoaded}
          />

          <TowerCameraController
            selectedTower={selectedTower || null}
            isGameOver={true}
            getTowersData={() => towersForCamera}
          />
        </Canvas>

        {isLoading && (
          <div className="tron-grid-review-loading">
            <div className="tron-grid-review-loading-text">Preparing grid</div>
          </div>
        )}

        {!isLoading && error && (
          <div className="tron-grid-review-error">
            <div className="tron-grid-review-error-card">
              <div className="tron-grid-review-error-title">Failed to load towers</div>
              <div className="tron-grid-review-error-copy">{error}</div>
              <button
                type="button"
                onClick={handleRefresh}
                className="tron-grid-review-btn tron-grid-review-btn--alert"
              >
                Retry
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default GridReviewOverlay;
