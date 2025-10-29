import React from 'react';
import { Canvas } from '@react-three/fiber';
import { TowerMapEntry } from '../../shared/types/api';
import { TowerPlacementSystem } from '../../shared/types/towerPlacement';
import { UnifiedTowerSystem } from './UnifiedTowerSystem';
import { TowerCameraController } from './TowerCameraController';
import { TronBackground } from './TronBackground';
import { EffectsRenderer } from './EffectsRenderer';

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
}) => {
  const [towersData, setTowersData] = React.useState<TowerMapEntry[]>([]);

  React.useEffect(() => {
    if (preAssignedTowers && preAssignedTowers.length) {
      setTowersData(
        preAssignedTowers.filter((tower) =>
          typeof tower.worldX === 'number' && typeof tower.worldZ === 'number'
        )
      );
    } else {
      setTowersData([]);
    }
  }, [preAssignedTowers]);

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
          <hemisphereLight color={0x001122} groundColor={0x000408} intensity={0.35} />
          <directionalLight
            position={[6, 24, 12]}
            intensity={0.9}
            color={0x44aaff}
            shadow-mapSize-width={1024}
            shadow-mapSize-height={1024}
          />
          <ambientLight intensity={0.28} color={0x113355} />

          <TronBackground
            gameState={stubGameState}
            gridSize={8}
            gridOffsetX={-4}
            gridOffsetZ={-4}
            gridLineWidth={3}
          />
          <EffectsRenderer />

          <UnifiedTowerSystem
            isGameOver={true}
            placementSystem={placementSystem}
            preAssignedTowers={preAssignedTowers}
            selectedTower={selectedTower || null}
            onTowerClick={handleTowerFocus}
            onTowersLoaded={(towers) => setTowersData(towers)}
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
