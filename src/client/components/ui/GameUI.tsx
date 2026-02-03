import React, { useEffect, useState } from 'react';
import { GameStateHook } from '../../hooks/useGameState';
import { GameMode } from '../../../shared/simulation';
import { MusicManager, AudioPlayer } from '../audio/AudioPlayer';
import { TronModalLogo } from './TronModalLogo';
import {
  PLAYER_COLOR_THEMES,
  PlayerColorChoice,
  PlayerColorTheme,
} from '../../constants/playerColors';
import { ReplayData } from '../../../shared/types/api';

interface GameUIProps {
  gameState: GameStateHook;
  onShowTowerReview?: () => void;
  isTowerReviewLoading?: boolean;
  towerReviewError?: string | null;
  playerColorChoice?: PlayerColorChoice | null;
  playerColorTheme?: PlayerColorTheme | null;
  onPlayerColorChange?: (choice: PlayerColorChoice) => void;
  // REPLAY MODE DISABLED FOR THIS RELEASE
  // replayDataToWatch?: ReplayData | null;
  hideHud?: boolean;
  battleInfo?: {
    opponentName: string;
    opponentScore: number;
  } | null;
}

const hsl = (h: number, s: number, l: number, a: number = 1) =>
  `hsla(${h}, ${s}%, ${l}%, ${a})`;

// Flip to true for verbose render/debug logging when diagnosing UI issues.
const DEBUG_RENDER_LOGS = false;
const DEV_TOOLS_ENABLED =
  typeof import.meta !== 'undefined' && Boolean((import.meta as any).env?.DEV);

const COLOR_OPTIONS = Object.values(PLAYER_COLOR_THEMES);

// Rebuilt (clean) GameUI with unified banner lane for perfect & miss feedback.
export const GameUI: React.FC<GameUIProps> = ({
  gameState,
  onShowTowerReview,
  isTowerReviewLoading = false,
  towerReviewError,
  playerColorChoice,
  playerColorTheme,
  onPlayerColorChange,
  // REPLAY MODE DISABLED FOR THIS RELEASE
  // replayDataToWatch,
  hideHud = false,
  battleInfo = null,
}) => {
  // console.log('[GameUI] Rendered with battleInfo:', battleInfo);
  const { gameState: state, isPlaying, startGame, resetGame, gameMode } = gameState;

  // Mode selection state - initialize with current gameMode
  const [selectedMode, setSelectedMode] = useState<GameMode>(gameMode || 'rotating_block');

  // Sync selectedMode if gameMode changes externally
  useEffect(() => {
    if (gameMode) {
      setSelectedMode(gameMode);
    }
  }, [gameMode]);

  // Runtime tuning toggle
  const [showTuning, setShowTuning] = useState(false);

  // Audio state management
  const [audioEnabled, setAudioEnabled] = useState(() => {
    const saved = localStorage.getItem('tron-audio-enabled');
    return saved !== null ? JSON.parse(saved) : true;
  });

  // Start screen exit animation state
  const [isExiting, setIsExiting] = useState(false);

  // Save audio preference and update MusicManager volume
  useEffect(() => {
    localStorage.setItem('tron-audio-enabled', JSON.stringify(audioEnabled));
    // Set volume to 0 when disabled, restore to default when enabled
    MusicManager.setVolume(audioEnabled ? 0.6 : 0);
    AudioPlayer.setEnabled(audioEnabled);

    // Store global audio state for AudioPlayer to check
    (window as any).tronAudioEnabled = audioEnabled;
  }, [audioEnabled]);

  // Initialize audio state on mount
  useEffect(() => {
    MusicManager.setVolume(audioEnabled ? 0.6 : 0);
    AudioPlayer.setEnabled(audioEnabled);
    (window as any).tronAudioEnabled = audioEnabled;
  }, []);

  // Banner state - small integrated feedback near blocks
  type Banner = { id: number; created: number; tier: number; streak: number; life: number; placement?: { x: number; y: number; width: number } };
  const [perfectBanners, setPerfectBanners] = useState<Banner[]>([]);
  const [missBanners, setMissBanners] = useState<Banner[]>([]);
  const lastPerfectTierRef = React.useRef(-1);
  const lastMissTierRef = React.useRef(-1);
  const missCountRef = React.useRef(0);

  // Listen for perfect streak progression
  useEffect(() => {
    const onPerfect = (e: any) => {
      const { tier = 0, streak = 0, placement } = e.detail || {};
      if (tier !== lastPerfectTierRef.current || streak === 1) {
        const baseLife = 800;
        const tierLifeBonus = [0, 100, 180, 260, 380, 550][tier] || 0;
        setPerfectBanners((arr) => [
          ...arr,
          { id: Date.now() + Math.random(), created: Date.now(), tier, streak, life: baseLife + tierLifeBonus, placement },
        ]);
        lastPerfectTierRef.current = tier;
      }
    };
    window.addEventListener('perfect-streak-advance', onPerfect as any);
    return () => window.removeEventListener('perfect-streak-advance', onPerfect as any);
  }, []);

  // Listen for miss streak progression - only show every 3rd miss to avoid spam
  useEffect(() => {
    const onMiss = (e: any) => {
      const { tier = 0, streak = 0 } = e.detail || {};
      missCountRef.current++;
      // Only show every 3rd miss or when tier advances
      if (tier !== lastMissTierRef.current || missCountRef.current % 3 === 0) {
        const baseLife = 700;
        const tierLifeBonus = [0, 50, 80, 110, 140, 170, 200, 250][tier] || 0;
        setMissBanners((arr) => [
          ...arr,
          { id: Date.now() + Math.random(), created: Date.now(), tier, streak, life: baseLife + tierLifeBonus },
        ]);
        lastMissTierRef.current = tier;
      }
    };
    window.addEventListener('imperfect-streak-advance', onMiss as any);
    return () => window.removeEventListener('imperfect-streak-advance', onMiss as any);
  }, []);

  // Lifetimes cleanup
  useEffect(() => {
    if (!perfectBanners.length) return; // only run if we have active banners
    const id = setInterval(() => {
      const now = Date.now();
      setPerfectBanners((arr) => arr.filter((b) => now - b.created < b.life));
    }, 120);
    return () => clearInterval(id);
  }, [perfectBanners.length]);

  useEffect(() => {
    if (!missBanners.length) return;
    const id = setInterval(() => {
      const now = Date.now();
      setMissBanners((arr) => arr.filter((b) => now - b.created < b.life));
    }, 140);
    return () => clearInterval(id);
  }, [missBanners.length]);

  // Keyboard toggle for tuning (press D)
  useEffect(() => {
    if (!DEV_TOOLS_ENABLED) {
      return;
    }
    const handler = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'd') setShowTuning((v) => !v);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Derived tuning handles
  const slideSpeed = (gameState as any).slideSpeed as number | undefined;
  const setSlideSpeed = (gameState as any).setSlideSpeed as ((s: number) => void) | undefined;
  const slideBounds = (gameState as any).slideBounds as number | undefined;
  const setSlideBounds = (gameState as any).setSlideBounds as ((b: number) => void) | undefined;
  const fallSpeedMult = (gameState as any).fallSpeedMult as number | undefined;
  const setFallSpeedMult = (gameState as any).setFallSpeedMult as ((m: number) => void) | undefined;

  // Grid tuning controls
  const gridSize = (gameState as any).gridSize as number | undefined;
  const setGridSize = (gameState as any).setGridSize as ((s: number) => void) | undefined;
  const gridOffsetX = (gameState as any).gridOffsetX as number | undefined;
  const setGridOffsetX = (gameState as any).setGridOffsetX as ((x: number) => void) | undefined;
  const gridOffsetZ = (gameState as any).gridOffsetZ as number | undefined;
  const setGridOffsetZ = (gameState as any).setGridOffsetZ as ((z: number) => void) | undefined;
  const gridLineWidth = (gameState as any).gridLineWidth as number | undefined;
  const setGridLineWidth = (gameState as any).setGridLineWidth as ((w: number) => void) | undefined;
  const gridDensity = (gameState as any).gridDensity as number | undefined;
  const setGridDensity = (gameState as any).setGridDensity as ((d: number) => void) | undefined;

  // Refined tier progression
  const perfectTierLabels = ['Perfect', 'Excellent', 'Superb', 'Flawless', 'Masterful', 'Legendary'];
  const missTierLabels = ['Oops', 'Careful', 'Focus', 'Unstable', 'Critical'];

  // Reddit-themed accent color (kept for potential future use)
  // const redditOrange = '#ff4500';

  // Dynamic colors based on current tower block count (matches block colors)
  const getCurrentHue = () => {
    if (!state || state.blocks.length === 0) return 0;
    // Use same formula as blocks for perfect synchronization
    return (state.blocks.length * 8) % 360;
  };

  const perfectColors = Array.from({ length: 6 }, (_, i) => {
    const baseHue = getCurrentHue();
    // Slight hue shift for progression, brighter for higher tiers
    return {
      h: (baseHue + i * 5) % 360,
      s: 52 + i * 2,
      l: 62 + i * 2
    };
  });

  const missColors = Array.from({ length: 5 }, (_, i) => {
    const baseHue = getCurrentHue();
    // Use complementary color for misses (opposite on wheel)
    const complementaryHue = (baseHue + 180) % 360;
    return {
      h: (complementaryHue + i * 8) % 360,
      s: 58 - i * 2,
      l: 58 - i * 3
    };
  });

  // Enhanced start screen with logo
  // Handle start button click with exit animation
  const handleStartGame = () => {
    setIsExiting(true);
    // Wait for exit animation to complete before starting game
    setTimeout(() => {
      // REPLAY MODE DISABLED FOR THIS RELEASE
      // if (replayDataToWatch) {
      //   startGame(replayDataToWatch.gameMode as any, undefined, replayDataToWatch);
      // } else {
      // Use the gameMode from the hook, which is updated by the selector
      startGame(gameMode);
      // }
      setIsExiting(false);
    }, 600); // Match animation duration
  };

  const handlePlayNewGame = () => {
    setIsExiting(true);
    setTimeout(() => {
      startGame('rotating_block');
      setIsExiting(false);
    }, 600);
  };

  const handleResetAndRestart = React.useCallback(() => {
    const mode = gameMode ?? 'rotating_block';
    resetGame();
    startGame(mode);
  }, [gameMode, resetGame, startGame]);

  if (!isPlaying && !state?.isGameOver) {
    return (
      <div className={`tron-start-screen ${isExiting ? 'exiting' : ''}`}>
        {/* Backdrop with grid */}
        <div className="tron-start-backdrop" />

        {/* Main content container */}
        <div className="tron-start-container">
          {/* Logo section */}
          <div className="tron-start-logo-section">
            <div className="tron-start-logo-wrapper">
              <div className="tron-modal-logo">
                <TronModalLogo />
              </div>
              <div className="tron-start-logo-glow" />
            </div>
          </div>

          {/* Tagline */}
          <div className="tron-start-tagline">
            <div className="tron-start-tagline-text">STACK WITH PRECISION</div>
            <div className="tron-start-tagline-scan" />
          </div>

          {/* Back to Blocks button */}
          <button
            onClick={() => {
              if (isTowerReviewLoading) return;
              if (onShowTowerReview) {
                onShowTowerReview();
              } else {
                window.location.reload();
              }
            }}
            className="tron-back-button"
            type="button"
            disabled={isTowerReviewLoading}
            aria-busy={isTowerReviewLoading}
            style={isTowerReviewLoading ? { opacity: 0.6, cursor: 'not-allowed' } : undefined}
          >
            <div className="tron-back-button-content">
              <div className="tron-back-button-icon">←</div>
              <div className="tron-back-button-text">
                {isTowerReviewLoading ? 'LOADING GRID...' : 'SEE THE GRID'}
              </div>
            </div>
          </button>

          {towerReviewError && (
            <div
              className="mt-3 text-xs text-red-400 tracking-[0.3em] uppercase"
              role="alert"
            >
              {towerReviewError}
            </div>
          )}

          {/* Mode Selector - Regen Toggle */}
          {/* REPLAY MODE DISABLED - Always show mode selector */}
          {!hideHud && (
            <div className="tron-mode-selector" style={{ marginBottom: '20px', marginTop: '10px', zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <button
                onClick={() => {
                  const newMode = gameMode === 'regenerate' ? 'rotating_block' : 'regenerate';
                  setSelectedMode(newMode);
                  if (gameState.setGameMode) {
                    gameState.setGameMode(newMode);
                  }
                }}
                style={{
                  background: 'rgba(0, 10, 20, 0.6)',
                  border: '1px solid rgba(0, 242, 254, 0.3)',
                  padding: '8px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  cursor: 'pointer',
                  borderRadius: '4px',
                  transition: 'all 0.2s ease',
                  pointerEvents: 'auto',
                  backdropFilter: 'blur(4px)'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(0, 242, 254, 0.8)';
                  e.currentTarget.style.background = 'rgba(0, 20, 40, 0.8)';
                  e.currentTarget.style.boxShadow = '0 0 15px rgba(0, 242, 254, 0.15)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(0, 242, 254, 0.3)';
                  e.currentTarget.style.background = 'rgba(0, 10, 20, 0.6)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              >
                <div style={{
                  width: '14px',
                  height: '14px',
                  border: '1px solid #00f2fe',
                  background: gameMode === 'regenerate' ? '#00f2fe' : 'transparent',
                  boxShadow: gameMode === 'regenerate' ? '0 0 10px rgba(0, 242, 254, 0.5)' : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.2s ease'
                }}>
                  {gameMode === 'regenerate' && (
                    <div style={{ width: '100%', height: '100%', background: '#00f2fe', opacity: 0.8 }} />
                  )}
                </div>
                <span style={{
                  color: '#00f2fe',
                  fontFamily: '"Orbitron", monospace',
                  fontSize: '12px',
                  letterSpacing: '1px',
                  fontWeight: 600,
                  textShadow: '0 0 4px rgba(0, 242, 254, 0.4)'
                }}>
                  REGEN MODE
                </span>
              </button>
            </div>
          )}

          {/* Start button */}
          <button
            onClick={handleStartGame}
            className="tron-start-button"
            type="button"
            disabled={isExiting}
          >
            <div className="tron-start-button-scan" />
            <div className="tron-start-button-content">
              <div className="tron-start-button-icon">▶</div>
              <div className="tron-start-button-text">
                START
              </div>
            </div>
          </button>

          {/* REPLAY MODE DISABLED FOR THIS RELEASE */}
          {/* {replayDataToWatch && (
            <button
              onClick={handlePlayNewGame}
              className="tron-start-button"
              type="button"
              disabled={isExiting}
              style={{ marginTop: '1rem', transform: 'scale(0.9)' }}
            >
              <div className="tron-start-button-scan" />
              <div className="tron-start-button-content">
                <div className="tron-start-button-icon">🎮</div>
                <div className="tron-start-button-text">PLAY NOW</div>
              </div>
            </button>
          )} */}

          {/* Controls hint */}
          <div className="tron-start-hint">
            TAP TO DROP
          </div>
          {/* Color switcher */}
          <div className="tron-color-switch" role="group" aria-label="Choose your tower color">
            <div className="tron-color-pill-row">
              {COLOR_OPTIONS.map((option) => {
                const isSelected = playerColorChoice === option.id;
                const pillStyle = {
                  '--tron-pill-color': option.accentHex,
                  '--tron-pill-color-secondary': option.accentSecondaryHex,
                } as React.CSSProperties & Record<'--tron-pill-color' | '--tron-pill-color-secondary', string>;
                return (
                  <button
                    key={option.id}
                    type="button"
                    className={`tron-color-pill ${isSelected ? 'selected' : ''}`}
                    onClick={() => onPlayerColorChange?.(option.id)}
                    aria-pressed={isSelected}
                    aria-label={option.label}
                    style={pillStyle}
                  >
                    <span className="tron-color-pill-glow" aria-hidden="true" />
                    <span className="tron-color-pill-fill" aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          </div>
          {/* Corner decorations */}
          <div className="tron-start-corner tron-corner-tl" />
          <div className="tron-start-corner tron-corner-tr" />
          <div className="tron-start-corner tron-corner-bl" />
          <div className="tron-start-corner tron-corner-br" />
        </div>
      </div>
    );
  }

  return (
    <div className="fixed top-0 left-0 w-full h-full pointer-events-none select-none font-sans"
      style={{ top: 0 }}>


      {/* Perfect placement feedback - subtle and integrated */}
      {perfectBanners.map((b, idx) => {
        const age = Date.now() - b.created;
        const life = b.life;
        const t = age / life;
        const opacity = t < 0.65 ? 1 : Math.max(0, 1 - (t - 0.65) / 0.35);
        const tierIndex = Math.min(b.tier, perfectColors.length - 1);
        const color = perfectColors[tierIndex] ?? { h: 185, s: 70, l: 55 };
        const label = perfectTierLabels[tierIndex] || 'Perfect';

        // Subtle float up animation
        const yOffset = -12 - (t * 35);
        const scale = 1 - (t * 0.15); // Slight scale down as it fades

        return (
          <div
            key={b.id}
            className="font-medium tracking-wide"
            style={{
              position: 'absolute',
              bottom: '42%',
              left: '50%',
              transform: `translate(-50%, ${yOffset}px) scale(${scale})`,
              fontSize: '15px',
              color: hsl(color.h, color.s, color.l + 8, opacity),
              //textShadow: `0 1px 2px ${hsl(color.h, color.s, color.l - 30, 0.5)}, 0 0 12px ${hsl(color.h, color.s + 10, color.l, 0.4)}`,
              opacity,
              pointerEvents: 'none',
              fontWeight: 500,
              letterSpacing: '0.02em',
              zIndex: 15 + idx,
            }}
          >
            {label}{b.streak > 1 ? ` ×${b.streak}` : ''}
          </div>
        );
      })}

      {/* Miss feedback - warm, less frequent */}
      {missBanners.map((b, idx) => {
        const age = Date.now() - b.created;
        const life = b.life;
        const t = age / life;
        const opacity = t < 0.6 ? 1 : Math.max(0, 1 - (t - 0.6) / 0.4);
        const tierIndex = Math.min(b.tier, missColors.length - 1);
        const color = missColors[tierIndex] ?? { h: 35, s: 70, l: 58 };
        const label = missTierLabels[tierIndex] || 'Oops';

        const yOffset = -10 - (t * 28);
        const scale = 1 - (t * 0.18);

        return (
          <div
            key={b.id}
            className="font-normal tracking-wide"
            style={{
              position: 'absolute',
              bottom: '40%',
              left: '50%',
              transform: `translate(-50%, ${yOffset}px) scale(${scale})`,
              fontSize: '14px',
              color: hsl(color.h, color.s, color.l + 5, opacity),
              //textShadow: `0 1px 2px ${hsl(color.h, color.s, color.l - 25, 0.4)}, 0 0 8px ${hsl(color.h, color.s, color.l, 0.3)}`,
              opacity,
              pointerEvents: 'none',
              fontWeight: 400,
              letterSpacing: '0.01em',
              zIndex: 10 + idx,
            }}
          >
            {label}
          </div>
        );
      })}

      {/* Enhanced Game HUD */}
      {!hideHud && (
        <>
          {/* {console.log('[GameUI] Rendering GameHUD with battleInfo:', battleInfo)} */}
          <GameHUD
            score={state?.score ?? 0}
            blocks={state?.blocks?.length ?? 0}
            combo={state?.combo ?? 0}
            isGameOver={state?.isGameOver ?? false}
            isReplay={gameState.isReplay}
            battleInfo={battleInfo}
          />
        </>
      )}

      {/* Audio Toggle Button */}
      <AudioToggleButton
        enabled={audioEnabled}
        onToggle={() => setAudioEnabled(!audioEnabled)}
      />

      {/* Tuning overlay */}
      {DEV_TOOLS_ENABLED && showTuning ? (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 pointer-events-auto bg-black/30 px-3 py-2 rounded-md backdrop-blur-sm space-y-2 max-w-xs">
          {typeof slideSpeed !== 'undefined' && setSlideSpeed && (
            <div className="text-white text-xs font-mono">
              <label className="block">Slide Speed: {Math.round(slideSpeed)}</label>
              <input type="range" min={100} max={3000} value={slideSpeed} onChange={(e) => setSlideSpeed(Number(e.target.value))} />
            </div>
          )}
          {typeof slideBounds !== 'undefined' && setSlideBounds && (
            <div className="text-white text-xs font-mono">
              <label className="block">Slide Bounds: {Math.round((slideBounds ?? 0) / 1000)}u</label>
              <input type="range" min={1000} max={8000} value={slideBounds} onChange={(e) => setSlideBounds(Number(e.target.value))} />
            </div>
          )}
          {typeof fallSpeedMult !== 'undefined' && setFallSpeedMult && (
            <div className="text-white text-xs font-mono">
              <label className="block">Fall Speed: {Number(fallSpeedMult).toFixed(2)}x</label>
              <input type="range" min={0.2} max={5} step={0.1} value={fallSpeedMult} onChange={(e) => setFallSpeedMult(Number(e.target.value))} />
            </div>
          )}

          {/* Grid Controls */}
          {typeof gridSize !== 'undefined' && setGridSize && (
            <div className="text-white text-xs font-mono">
              <label className="block">Grid Size: {Number(gridSize).toFixed(1)}u</label>
              <input type="range" min={1} max={20} step={0.1} value={gridSize} onChange={(e) => setGridSize(Number(e.target.value))} />
            </div>
          )}
          {typeof gridOffsetX !== 'undefined' && setGridOffsetX && (
            <div className="text-white text-xs font-mono">
              <label className="block">Grid Offset X: {Number(gridOffsetX).toFixed(1)}u</label>
              <input type="range" min={-10} max={10} step={0.1} value={gridOffsetX} onChange={(e) => setGridOffsetX(Number(e.target.value))} />
            </div>
          )}
          {typeof gridOffsetZ !== 'undefined' && setGridOffsetZ && (
            <div className="text-white text-xs font-mono">
              <label className="block">Grid Offset Z: {Number(gridOffsetZ).toFixed(1)}u</label>
              <input type="range" min={-10} max={10} step={0.1} value={gridOffsetZ} onChange={(e) => setGridOffsetZ(Number(e.target.value))} />
            </div>
          )}
          {typeof gridLineWidth !== 'undefined' && setGridLineWidth && (
            <div className="text-white text-xs font-mono">
              <label className="block">Grid Line Width: {Number(gridLineWidth).toFixed(1)}px</label>
              <input type="range" min={0.5} max={10} step={0.1} value={gridLineWidth} onChange={(e) => setGridLineWidth(Number(e.target.value))} />
            </div>
          )}
          {typeof gridDensity !== 'undefined' && setGridDensity && (
            <div className="text-white text-xs font-mono">
              <label className="block">Grid Density: {Number(gridDensity).toFixed(2)}x</label>
              <input
                type="range"
                min={1}
                max={2}
                step={0.01}
                value={gridDensity}
                onChange={(e) => setGridDensity(Number(e.target.value))}
              />
            </div>
          )}
          {typeof (gameState as any).slideAccel !== 'undefined' && (gameState as any).setSlideAccel && (
            <div className="text-white text-xs font-mono">
              <label className="block">Slide Accel: {(gameState as any).slideAccel}</label>
              <input
                type="range"
                min={0}
                max={200}
                step={1}
                value={(gameState as any).slideAccel}
                onChange={(e) => (gameState as any).setSlideAccel?.(Number(e.target.value))}
              />
            </div>
          )}
          {typeof (gameState as any).instantPlaceMain !== 'undefined' && (gameState as any).setInstantPlaceMain && (
            <div className="text-white text-xs font-mono">
              <label className="inline-flex items-center">
                <input
                  type="checkbox"
                  className="mr-2"
                  checked={(gameState as any).instantPlaceMain}
                  onChange={(e) => (gameState as any).setInstantPlaceMain?.(e.target.checked)}
                />
                Instant place main block
              </label>
            </div>
          )}
        </div>
      ) : null}

      {/* Reset */}
      {!state?.isGameOver && (
        <div className=""
          style={{
            bottom: '16px',
            left: '16px',
            position: 'absolute',
            pointerEvents: 'auto',
          }}
        >
          <button
            onClick={handleResetAndRestart}
            className="tron-reset-btn"
            aria-label="Reset game"
            title="Reset Tower"
          >
            <div className="tron-reset-scan"></div>
            <div className="tron-reset-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
              </svg>
            </div>
            <div className="tron-reset-label">RESET</div>
            <div className="tron-reset-glow"></div>
          </button>
        </div>
      )}
      {/* Persistent Score Display - Post Game */}
      {state?.isGameOver && (
        <div className="absolute top-6 left-6 pointer-events-auto">
          <div className="tron-score-hud">
            <div className="tron-score-header">
              <div className="tron-score-scan"></div>
              <span className="tron-score-label">YOUR SCORE</span>
            </div>
            <div className="tron-score-display">
              {(state.score || 0).toLocaleString()}
            </div>
            <div className="tron-score-footer">
              <div className="tron-score-pulse"></div>
            </div>
          </div>
        </div>
      )}

      {/* Play Again Button - Post Game */}
      {state?.isGameOver && (
        <div className="absolute top-6 right-6 pointer-events-auto">
          <button
            onClick={() => startGame(gameMode || 'rotating_block')}
            className="tron-play-again-btn"
          >
            <div className="tron-btn-scan"></div>
            <span className="tron-btn-text">PLAY AGAIN</span>
            <div className="tron-btn-glow"></div>
          </button>
        </div>
      )}

      {/* Minimal endgame stats (integrated) */}
      {/* EndStatsOverlay removed: in-world radial stats now handle endgame summary */}
    </div>
  );
};

// Enhanced Game HUD with Tron styling
const GameHUD: React.FC<{
  score: number;
  blocks: number;
  combo: number;
  isGameOver: boolean;
  isReplay?: boolean;
  battleInfo?: {
    opponentName: string;
    opponentScore: number;
  } | null;
}> = ({ score, blocks, combo, isGameOver, isReplay, battleInfo }) => {
  // console.log('[GameHUD] Rendered with battleInfo:', battleInfo);
  const [lastScore, setLastScore] = useState(score);
  const [deltas, setDeltas] = useState<Array<{ id: number; v: number; t: number }>>([]);
  const [pulse, setPulse] = useState(0);

  // On score change produce delta popup and pulse animation
  useEffect(() => {
    const diff = score - lastScore;
    if (diff !== 0) {
      setLastScore(score);
      setDeltas((arr) => [...arr, { id: Date.now() + Math.random(), v: diff, t: Date.now() }]);
      setPulse((p) => p + 1);
    }
  }, [score, lastScore]);

  // Cull old deltas
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      setDeltas((arr) => arr.filter((d) => now - d.t < 1100));
    }, 160);
    return () => clearInterval(id);
  }, []);

  // Height factor for multiplier display
  const heightFactor = Math.min(1.9, 1 + 0.07 * combo);
  const progress = Math.min(1, heightFactor / 1.9);
  const comboColor = { h: 185 + (progress * 85), s: 70, l: 55 };

  return (
    <div className="tron-hud-container" style={{ position: 'absolute', top: '24px', left: '50%', transform: 'translateX(-50%)', pointerEvents: 'none', userSelect: 'none' }}>
      {/* Replay Indicator */}
      {isReplay && (
        <div style={{ position: 'absolute', top: '-32px', left: '50%', transform: 'translateX(-50%)', color: '#ef4444', fontWeight: 'bold', letterSpacing: '0.1em', whiteSpace: 'nowrap', textShadow: '0 0 10px rgba(255, 0, 0, 0.5)' }}>
          ● REPLAY MODE
        </div>
      )}

      {/* Main HUD Container - Fixed width to prevent layout shifts */}
      {battleInfo ? (
        /* Battle Mode HUD */
        <div className="tron-game-hud" style={{ minWidth: '400px' }}>
          <div className="tron-hud-scan"></div>



          {/* Current Score */}
          <div className="tron-hud-section" style={{ flex: 1 }}>
            <div className="tron-hud-label" style={{ color: score >= battleInfo.opponentScore ? '#44ff88' : '#00f2fe' }}>YOUR SCORE</div>
            <div
              className="tron-hud-value tron-score-value"
              style={{
                animation: pulse > 0 ? 'scorePulse 350ms cubic-bezier(0.34, 1.56, 0.64, 1)' : undefined,
                color: score >= battleInfo.opponentScore ? '#66ffaa' : '#00f2fe',
                textShadow: score >= battleInfo.opponentScore ? '0 0 10px rgba(102, 255, 170, 0.5)' : '0 0 10px rgba(0, 242, 254, 0.5)',
              }}
            >
              {score.toLocaleString()}
            </div>
            {/* <div style={{ fontSize: '0.65rem', opacity: 0.7, marginTop: '2px' }}>
              {score >= battleInfo.opponentScore ? '✓ WINNING' : `${(battleInfo.opponentScore - score).toLocaleString()} behind`}
            </div> */}
          </div>
          {/* Opponent Score to Beat */}
          <div className="tron-hud-section" style={{ flex: 1 }}>
            <div className="tron-hud-label" style={{ color: '#ff4444' }}>TARGET</div>
            <div className="tron-hud-value" style={{ color: '#ff6666', fontSize: '1.3rem' }}>
              {battleInfo.opponentScore.toLocaleString()}
            </div>
            {/* <div style={{ fontSize: '0.65rem', opacity: 0.7, marginTop: '2px' }}>{battleInfo.opponentName}</div> */}
          </div>
          {/* Blocks */}
          <div className="tron-hud-section" style={{ flex: 0.7 }}>
            <div className="tron-hud-label">BLOCKS</div>
            <div className="tron-hud-value" style={{ fontSize: '1.2rem' }}>{blocks}</div>
          </div>

          <div className="tron-hud-pulse"></div>
        </div>
      ) : (
        /* Normal Mode HUD */
        <div className="tron-game-hud">
          <div className="tron-hud-scan"></div>

          {/* Score Section */}
          <div className="tron-hud-section tron-score-section">
            <div className="tron-hud-label">SCORE</div>
            <div
              className="tron-hud-value tron-score-value"
              style={{
                animation: pulse > 0 ? 'scorePulse 350ms cubic-bezier(0.34, 1.56, 0.64, 1)' : undefined,
              }}
            >
              {score.toLocaleString()}
            </div>
          </div>

          {/* Blocks Section */}
          <div className="tron-hud-section tron-blocks-section">
            <div className="tron-hud-label">BLOCKS</div>
            <div className="tron-hud-value">{blocks}</div>
          </div>

          {/* Multiplier Section - Always present to prevent layout shifts */}
          <div className={`tron-hud-section tron-multiplier-section ${combo > 0 && !isGameOver ? 'active' : 'inactive'}`}>
            <div className="tron-hud-label">MULTIPLIER</div>
            <div
              className="tron-hud-value tron-multiplier-value"
              style={{
                color: combo > 0 ? hsl(comboColor.h, comboColor.s, comboColor.l + 15) : 'rgba(255, 255, 255, 0.3)',
                textShadow: combo > 0 ? `0 0 8px ${hsl(comboColor.h, comboColor.s, comboColor.l, 0.6)}` : 'none',
              }}
            >
              ×{combo > 0 ? heightFactor.toFixed(2) : '1.00'}
            </div>
            <div className="tron-combo-streak">
              {combo > 0 ? `${combo} perfect` : 'no streak'}
            </div>
          </div>

          <div className="tron-hud-pulse"></div>
        </div>
      )}

      {/* Score deltas */}
      <div className="relative" style={{ minHeight: 0 }}>
        {deltas.map((d) => {
          const age = Date.now() - d.t;
          const t = age / 1100;
          const y = -6 - t * 42;
          const op = t < 0.65 ? 1 : Math.max(0, 1 - (t - 0.65) / 0.35);
          const deltaColor = d.v > 0
            ? { h: 150, s: 65, l: 58 }  // Success green
            : { h: 5, s: 70, l: 60 };   // Error red

          return (
            <div
              key={d.id}
              className="absolute font-semibold"
              style={{
                transform: `translateY(${y}px)`,
                fontSize: '17px',
                left: '15%',
                color: hsl(deltaColor.h, deltaColor.s, deltaColor.l, op),
                fontWeight: 600,
                opacity: op,
                fontFamily: 'Orbitron, system-ui, -apple-system, sans-serif',
                fontFeatureSettings: '"tnum"',
                textShadow: `0 0 8px ${hsl(deltaColor.h, deltaColor.s, deltaColor.l, 0.4)}`,
              }}
            >
              {d.v > 0 ? `+${d.v}` : `${d.v}`}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// Audio Toggle Button with Tron styling
const AudioToggleButton: React.FC<{ enabled: boolean; onToggle: () => void }> = ({ enabled, onToggle }) => {
  const handleToggle = () => {
    // Play a subtle click sound if audio is currently enabled
    if (enabled) {
      AudioPlayer.playChime(0.08, 900);
    }
    onToggle();
  };

  return (
    <div style={{ position: 'absolute', bottom: '24px', left: '24px', pointerEvents: 'auto' }}>
      <button
        onClick={handleToggle}
        className="tron-audio-toggle"
        aria-label={enabled ? 'Disable audio' : 'Enable audio'}
        title={enabled ? 'Audio: ON' : 'Audio: OFF'}
      >
        <div className="tron-audio-scan"></div>
        <div className="tron-audio-icon">
          {enabled ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
            </svg>
          )}
        </div>
        <div className="tron-audio-status">
          {enabled ? 'ON' : 'OFF'}
        </div>
        <div className="tron-audio-glow"></div>
      </button>
    </div>
  );
};


