import React from 'react';
import { Canvas } from '@react-three/fiber';
import { TowerMapEntry } from '../../shared/types/api';
import { useGameData } from '../hooks/useGameData';
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

  const { getLeaderboard, getTowerMap } = useGameData();
  const [leaderboardType, setLeaderboardType] = React.useState<'all-time' | 'daily'>('all-time');
  const [leaderboardData, setLeaderboardData] = React.useState<{ highScores: any[], perfectStreaks: any[] } | null>(null);
  const [dailyTowers, setDailyTowers] = React.useState<TowerMapEntry[]>([]);

  React.useEffect(() => {
    getLeaderboard(10, leaderboardType).then(setLeaderboardData);

    if (leaderboardType === 'daily') {
      getTowerMap(100, 0, 'daily').then(data => {
        if (data?.towers) {
          setDailyTowers(data.towers);
        }
      });
    } else {
      setDailyTowers([]);
    }
  }, [leaderboardType, getLeaderboard, getTowerMap]);

  React.useEffect(() => {
    const filtered: TowerMapEntry[] = [];

    // If daily mode, ONLY show daily towers
    if (leaderboardType === 'daily') {
      if (dailyTowers.length > 0) {
        dailyTowers.forEach(tower => {
          if (typeof tower.worldX === 'number' && typeof tower.worldZ === 'number') {
            filtered.push(tower);
          }
        });
      }
    } else {
      // Default behavior (all-time / pre-assigned)
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
    }

    setTowersData(filtered);
  }, [preAssignedTowers, playerTower, dailyTowers, leaderboardType]);

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

      <div className="tron-grid-review-leaderboard" style={{ position: 'absolute', top: '80px', right: '40px', zIndex: 10 }}>
        <div className="tron-grid-review-leaderboard-header">
          <div className="tron-grid-review-leaderboard-kicker">TOP PROGRAMS</div>
          <div className="leaderboard-toggle" style={{ marginTop: '15px' }}>
            <button
              onClick={() => setLeaderboardType('all-time')}
              className={leaderboardType === 'all-time' ? 'active' : ''}
            >
              ALL TIME
            </button>
            <button
              onClick={() => setLeaderboardType('daily')}
              className={leaderboardType === 'daily' ? 'active' : ''}
            >
              CYCLE
            </button>
          </div>
        </div>
        <div className="tron-grid-review-leaderboard-list">
          {(!leaderboardData?.highScores || leaderboardData.highScores.length === 0) && (
            <div className="tron-grid-review-leaderboard-empty" style={{ padding: '20px', textAlign: 'center', color: 'rgba(0,255,255,0.5)', fontSize: '0.8rem', letterSpacing: '1px' }}>
              NO ENTRIES YET
            </div>
          )}
          {leaderboardData?.highScores.map((score, i) => (
            <div
              key={i}
              className="tron-grid-review-leaderboard-item"
              onClick={() => {
                const tower = towersData.find(t => t.sessionId === score.sessionId);
                if (tower) {
                  handleTowerFocus(tower, [tower.worldX ?? 0, 0, tower.worldZ ?? 0]);
                }
              }}
            >
              <div className="tron-grid-review-leaderboard-item-header">
                <span className="tron-grid-review-leaderboard-rank">#{i + 1}</span>
                <span className="tron-grid-review-leaderboard-name">{score.username}</span>
              </div>
              <div className="tron-grid-review-leaderboard-meta">
                {score.score.toLocaleString()} PTS
              </div>
            </div>
          ))}
        </div>
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
            preAssignedTowers={leaderboardType === 'daily' ? dailyTowers : preAssignedTowers}
            selectedTower={selectedTower || null}
            onTowerClick={handleTowerFocus}
            onTowersLoaded={handleTowersLoaded}
            leadingColor={towerStats?.leadingColor === 'blue' || towerStats?.leadingColor === 'orange' ? towerStats.leadingColor : null}
            fallbackBluePercentage={typeof towerStats?.colorTotals?.blue?.percentage === 'number' ? towerStats.colorTotals.blue.percentage : null}
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
