import React, { useEffect, useState } from 'react';
import { GameStateHook } from '../hooks/useGameState';
import { MusicManager } from './AudioPlayer';

interface GameUIProps { gameState: GameStateHook; }

// Dynamic color system - progresses through color wheel
const COLORS = {
  // UI elements use subtle neutral tones
  text: 'rgba(255, 255, 255, 0.95)',
  textMuted: 'rgba(255, 255, 255, 0.6)',
};

const hsl = (h: number, s: number, l: number, a: number = 1) =>
  `hsla(${h}, ${s}%, ${l}%, ${a})`;

// Rebuilt (clean) GameUI with unified banner lane for perfect & miss feedback.
export const GameUI: React.FC<GameUIProps> = ({ gameState }) => {
  const { gameState: state, isPlaying, startGame, resetGame } = gameState;

  console.log('🎮 GameUI: Component rendered', { isPlaying, hasState: !!state });

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

    // Store global audio state for AudioPlayer to check
    (window as any).tronAudioEnabled = audioEnabled;
  }, [audioEnabled]);

  // Initialize audio state on mount
  useEffect(() => {
    MusicManager.setVolume(audioEnabled ? 0.6 : 0);
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
  console.log('🎮 GameUI: State check:', { isPlaying, gameState: !!state, isGameOver: state?.isGameOver });

  // Handle start button click with exit animation
  const handleStartGame = () => {
    setIsExiting(true);
    // Wait for exit animation to complete before starting game
    setTimeout(() => {
      startGame('rotating_block');
      setIsExiting(false);
    }, 600); // Match animation duration
  };

  if (!isPlaying && !state?.isGameOver) {
    console.log('🎮 GameUI: Showing start screen');
    return (
      <div className={`tron-start-screen ${isExiting ? 'exiting' : ''}`}>
        {/* Backdrop with grid */}
        <div className="tron-start-backdrop" />

        {/* Main content container */}
        <div className="tron-start-container">
          {/* Logo section */}
          <div className="tron-start-logo-section">
            <div className="tron-start-logo-wrapper">
              <TronStartLogo />
              <div className="tron-start-logo-glow" />
            </div>
          </div>

          {/* Tagline */}
          <div className="tron-start-tagline">
            <div className="tron-start-tagline-text">STACK WITH PRECISION</div>
            <div className="tron-start-tagline-scan" />
          </div>

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
              <div className="tron-start-button-text">START</div>
            </div>
          </button>

          {/* Controls hint */}
          <div className="tron-start-hint">
            TAP TO DROP
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
      <GameHUD
        score={state?.score ?? 0}
        blocks={state?.blocks?.length ?? 0}
        combo={state?.combo ?? 0}
        isGameOver={state?.isGameOver ?? false}
      />

      {/* Audio Toggle Button */}
      <AudioToggleButton
        enabled={audioEnabled}
        onToggle={() => setAudioEnabled(!audioEnabled)}
      />

      {/* Tuning overlay */}
      {showTuning ? (
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
            position: 'absolute'
          }}
        >
          <button
            onClick={resetGame}
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
            onClick={() => startGame('rotating_block')}
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
}> = ({ score, blocks, combo, isGameOver }) => {
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
    <div className="absolute top-6 left-1/2 -translate-x-1/2 pointer-events-none select-none tron-hud-container">
      {/* Main HUD Container - Fixed width to prevent layout shifts */}
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
    if (enabled && (window as any).tronAudioEnabled !== false) {
      try {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(800, ctx.currentTime);
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.1);
      } catch (e) {
        // Ignore audio errors
      }
    }
    onToggle();
  };

  return (
    <div className="absolute bottom-6 left-6 pointer-events-auto">
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


// Start screen logo component
const TronStartLogo: React.FC = () => (
  <div className="tron-start-logo">
    <svg
      viewBox="0 0 1173.74 245.29"
      xmlns="http://www.w3.org/2000/svg"
      className="tron-start-logo-svg"
    >
      <path
        fill="currentColor"
        d="M1166.82,210.17c-.35-.31-.71-.6-1.08-.88-.39-.29-.79-.57-1.2-.82-.4-.27-.82-.52-1.25-.75-.22-.43-.47-.84-.75-1.25-.24-.4-.52-.8-.8-1.18-.29-.39-.6-.76-.92-1.12-.62-.72-1.29-1.38-2-2-.62-.72-1.29-1.38-2-2-3.51-3.04-8.08-4.88-13.08-4.88h-71.76l.18-2,2.98-33.33c.47-5.32-1.15-10.51-4.58-14.61-.7-.84-1.46-1.62-2.28-2.32-.35-.31-.71-.6-1.09-.88-.38-.29-.76-.56-1.16-.81-.41-.27-.83-.52-1.26-.74-.23-.43-.48-.85-.74-1.26-.26-.4-.54-.8-.84-1.19-.2-.27-.41-.54-.63-.8-.09-.11-.18-.22-.28-.32-.62-.72-1.29-1.39-2-2-.62-.72-1.29-1.39-2-2-3.14-2.73-7.05-4.4-11.28-4.77-5.31-.48-10.5,1.14-14.6,4.57-4.11,3.43-6.63,8.24-7.1,13.57l-4.67,52.2-.03.36c-.66-.48-1.35-.9-2.06-1.28-2.82-1.53-6.04-2.39-9.46-2.39h-71.77l.18-2,2.98-33.33c.48-5.32-1.15-10.51-4.58-14.61-.7-.84-1.46-1.62-2.28-2.32-.35-.31-.71-.6-1.09-.88-.38-.29-.76-.56-1.16-.81-.41-.27-.82-.51-1.25-.74-.23-.43-.48-.85-.75-1.26-.26-.41-.54-.8-.84-1.19-.2-.27-.41-.54-.63-.8-.09-.11-.18-.22-.28-.32-.62-.72-1.29-1.39-2-2-.16-.19-.33-.38-.51-.56l6.59-.04c5.34-.03,10.35-2.14,14.1-5.94,3.76-3.8,5.81-8.84,5.78-14.18-.04-5.36-2.16-10.39-5.99-14.15-.29-.29-.59-.56-.9-.82-.35-.32-.72-.62-1.1-.9-.39-.3-.78-.57-1.19-.83-.41-.27-.82-.51-1.25-.74-.23-.43-.48-.85-.75-1.26-.25-.4-.52-.79-.81-1.17-.28-.38-.59-.75-.9-1.11-.35-.41-.72-.79-1.1-1.17-.3-.29-.61-.58-.92-.85-.34-.4-.7-.78-1.08-1.15-.3-.29-.61-.58-.92-.85-2.87-2.5-6.34-4.09-10.04-4.65.31-.43.59-.87.86-1.33,1.76-2.97,2.77-6.45,2.77-10.15,0-6.01-2.67-11.41-6.88-15.07-.36-.33-.73-.63-1.12-.92s-.78-.57-1.19-.82c-.41-.27-.82-.52-1.25-.75-.23-.43-.48-.85-.75-1.25-.25-.41-.53-.8-.81-1.18-.28-.37-.57-.73-.88-1.08-.26-.3-.53-.6-.81-.88l27.13.09c10.99,0,19.96-8.94,20-19.93.02-5.34-2.04-10.37-5.81-14.16-.35-.35-.71-.69-1.08-1-.36-.32-.72-.62-1.1-.9-.39-.3-.78-.57-1.19-.83-.4-.27-.82-.52-1.25-.75-.23-.43-.48-.84-.75-1.25-.25-.4-.52-.79-.81-1.17-.28-.38-.58-.74-.9-1.1-.29-.34-.6-.68-.92-1-.35-.35-.71-.69-1.08-1-.29-.34-.6-.68-.92-1-.35-.35-.71-.69-1.08-1-3.61-3.16-8.19-4.89-13.04-4.91l-129.7-.46c-6.87,0-13,3.48-16.6,8.86-.04.05-.07.1-.11.15-.26-.34-.53-.68-.81-1-.35-.4-.71-.78-1.08-1.15-.3-.29-.6-.57-.92-.85-.62-.71-1.29-1.38-2-2-3.04-2.64-6.91-4.38-11.22-4.78-5.32-.49-10.51,1.12-14.63,4.53-4.11,3.42-6.65,8.24-7.14,13.56l-5.38,58.8-1.99-2.19-52.71-58.2c-.52-.58-1.08-1.12-1.66-1.62-.25-.23-.51-.44-.77-.65-.2-.15-.4-.31-.6-.45-.17-.13-.34-.25-.51-.36l-1.49-1.64-1.4-1.55-1.23-1.35-.34-.38c-.52-.58-1.08-1.12-1.66-1.62l-.34-.38c-.52-.58-1.08-1.12-1.66-1.62C672.19,1.79,667.5,0,662.64,0h-19.6c-4.38,0-8.7,1.47-12.17,4.13l-6.94,5.32c-1.3,1-2.46,2.14-3.46,3.4-.03.04-.06.07-.08.11-.04.03-.06.06-.08.1-.09.11-.18.22-.25.33-.15-.09-.31-.18-.46-.26-.23-.43-.48-.84-.74-1.25-.18-.28-.36-.55-.55-.82-.08-.12-.17-.23-.26-.35-.29-.39-.59-.77-.91-1.13,0-.01-.02-.01-.02-.01-.15-.19-.32-.38-.49-.56-.47-.5-.97-.98-1.49-1.43,0-.01-.02-.01-.02-.01-.15-.19-.32-.38-.49-.56-.47-.5-.97-.98-1.49-1.43,0-.01-.02-.01-.02-.01-3.61-3.13-8.28-4.88-13.08-4.88h-101.48c-5.18,0-10.1,1.97-13.84,5.55l-5.68,5.45h-.02s-.26.26-.26.26l-.05.05s-.04-.08-.08-.12c-.25-.41-.52-.81-.81-1.19-.26-.34-.52-.67-.8-.99-.03-.04-.06-.07-.1-.11-.62-.71-1.29-1.38-2-2-.62-.71-1.29-1.38-2-2-3.51-3.06-8.09-4.9-13.1-4.9h-134.39c-4.76,0-9.14,1.67-12.59,4.47-.11-.1-.21-.19-.32-.28-.62-.54-1.27-1.04-1.95-1.49C307.39,1.26,303.56,0,299.44,0h-104.39c-5.14,0-10.02,1.95-13.76,5.49l-21.16,20.06c-3.97,3.76-6.24,9.05-6.24,14.52v21.99c0,5,1.85,9.59,4.9,13.1.62.71,1.29,1.38,2,2,.35.31.72.61,1.1.9.39.28.78.56,1.19.81.41.27.82.52,1.25.75.43.24.88.46,1.33.67.21.45.43.9.67,1.33.23.43.48.84.75,1.25.25.41.53.8.81,1.19.08.1.16.2.24.3.21.27.43.54.66.8.37.43.76.84,1.17,1.23-9.28,1.72-16.34,9.88-16.34,19.66,0,5.01,1.84,9.59,4.91,13.1.61.71,1.28,1.38,2,2,.35.32.72.61,1.1.9.38.28.77.55,1.17.8.4.28.82.52,1.25.75.43.25.88.47,1.34.67.2.46.42.9.66,1.33.23.43.48.85.75,1.25.26.41.54.81.83,1.2.28.38.58.75.9,1.1,3.66,4.22,9.07,6.9,15.09,6.9h101.7c5.48,0,10.78-2.28,14.54-6.26l24.18-25.6c3.56-3.77,5.5-8.7,5.46-13.89l-.15-18.4c-.05-5.96-2.74-11.32-6.94-14.95-.35-.31-.7-.59-1.07-.87-.38-.29-.78-.56-1.18-.81-.41-.28-.83-.53-1.26-.76-.44-.24-.88-.47-1.34-.67-.19-.45-.42-.9-.66-1.33-.23-.42-.47-.84-.74-1.24-.26-.41-.53-.81-.82-1.19-.2-.27-.41-.53-.63-.79.02,0,.04,0,.07-.02,2.69-.74,5.15-2.03,7.26-3.75,3.55,3.22,8.25,5.17,13.39,5.17h31.32l-5.3,53.42c-.57,5.69,1.33,11.08,4.82,15.09.61.71,1.28,1.38,2,2,.61.71,1.28,1.38,2,2,.35.31.71.6,1.08.87h.01c.39.31.79.59,1.2.85.4.26.82.51,1.24.73.23.43.48.86.76,1.27.24.39.51.78.8,1.16h0c.28.38.58.75.89,1.1,3.23,3.73,7.85,6.29,13.15,6.81.66.06,1.31.1,1.96.1,10.32,0,18.87-7.75,19.89-18.03l6.69-67.37h35.23l-3.13,54.25c-.29,5.18,1.47,10.32,4.85,14.24.19.22.38.43.58.64.45.48.93.93,1.42,1.36.19.22.38.43.58.64.45.48.93.93,1.42,1.36.37.32.75.62,1.14.91.38.29.77.56,1.17.81.41.27.83.52,1.26.74.22.43.47.85.74,1.26.26.41.53.81.83,1.19.27.38.56.74.86,1.09.19.22.38.43.58.64,3.76,3.98,9.06,6.27,14.54,6.27h99.63c4.94,0,9.68-1.82,13.35-5.12l18.57-16.65.68-.61c.82,2,1.97,3.84,3.37,5.46.62.72,1.28,1.39,2,2,.62.72,1.28,1.39,2,2,.36.33.74.63,1.13.92.38.29.76.56,1.16.8.41.28.83.53,1.27.77.23.42.47.83.73,1.23.26.41.54.81.84,1.2.27.37.56.72.86,1.07,3.37,3.9,8.23,6.51,13.76,6.88.46.03.91.05,1.37.05.67,0,1.34-.03,1.99-.1-2.21,2.91-3.65,6.47-4.01,10.39l-6.01,67.12c-.51,5.62,1.38,10.92,4.82,14.88.62.72,1.28,1.38,2,2,.62.72,1.28,1.38,2,2,.36.32.73.62,1.12.9.38.3.77.57,1.18.82.4.27.81.52,1.24.74.23.43.48.85.76,1.26.25.41.52.8.82,1.18.28.38.57.75.88,1.1,3.28,3.78,7.96,6.34,13.31,6.82.59.06,1.2.08,1.8.08,10.42,0,18.98-7.83,19.91-18.21l1.51-16.84h53.35c8.08,0,15.04-4.83,18.21-11.72v-.03c1.15-2.51,1.79-5.31,1.79-8.25,0-1.92-.27-3.73-.79-5.49v-.04c-.68-2.39-1.81-4.6-3.27-6.53h5.89l-2.58,35.67c-.39,5.49,1.48,10.63,4.82,14.5l.02.02s.03.03.04.04c.61.72,1.28,1.39,2,2,.61.72,1.28,1.39,2,2,.35.32.72.61,1.09.89.38.29.77.56,1.18.82.4.27.82.51,1.25.74.23.43.48.85.75,1.26.25.4.53.8.82,1.18.28.38.58.75.91,1.11,3.33,3.85,8.14,6.43,13.61,6.83.49.04.98.05,1.47.05,10.43,0,19.19-8.15,19.94-18.55l1.09-15.01h43.85l-.15,2.3c-.33,5.29,1.4,10.38,4.86,14.37h.01s.06.08.09.12c.6.68,1.24,1.31,1.91,1.89.03.04.06.07.09.11.6.68,1.24,1.31,1.91,1.89.36.32.72.61,1.1.89.38.29.77.56,1.17.82.41.26.82.51,1.25.74.24.43.49.85.75,1.26.26.4.54.8.83,1.18.28.38.58.75.9,1.11.03.04.06.07.09.11,3.53,4,8.41,6.4,13.77,6.73,7.22.45,13.79-3.02,17.65-8.56.01-.01.02-.02.03-.04.06-.08.12-.17.18-.26.19.3.4.6.62.88.29.39.59.77.92,1.14.1.13.22.25.33.38,3.78,4.13,9.16,6.5,14.75,6.5h104.53c6,0,11.4-2.66,15.06-6.87.1.12.21.25.32.37,3.78,4.13,9.16,6.5,14.76,6.5h104.52c11.03,0,20-8.97,20-20,0-6.03-2.68-11.45-6.92-15.12Z"
      />
      <path
        fill="currentColor"
        d="M565.33,96.1l2.23-2,17.21-15.44,1.99-1.79,1.69-26.17,1.58-24.5h-90.46l-10.56,10.11-10.15,9.73-.15,2.57-2.75,47.99h88.81l.56-.5ZM576.62,72.98l-14.63,13.12h-60.22l.11-2,1.18-20.44,13.53-12.96h61.47l-1.44,22.28Z"
      />
      <polygon
        fill="currentColor"
        points="864.94 163.18 856.19 153.68 800.47 153.68 791.44 161.84 787.54 165.37 785.46 167.24 785.35 168.7 785.09 172.23 785.99 172.23 864.37 172.23 864.94 163.18"
      />
      <path
        fill="currentColor"
        d="M0,77.39v-27.24l138.47,99.89s50.76,41.87,124.67,41.87h342.4v6.17c-201.12,1.14-348.33,1.1-361.73,0-8.64-.71-16.96-2.04-16.96-2.04s-9.3-1.48-18.48-3.76c-28.88-7.17-52.2-19.09-69.38-30.01C92.66,133.96,46.33,105.67,0,77.39Z"
      />
      <path
        fill="currentColor"
        d="M245.43,212.49c20.92,1.01,165.19,1.01,360.11-.1v-6.17h-342.4l-20.13-.24c-14.46-.18-28.85-2.03-42.98-5.51-19.73-4.87-44.72-13.78-58.6-20.91l-85.43-43.7v26.7l109.54,38.84s26.76,10.13,76.19,11.09c1.24.02,2.47-.06,3.71,0Z"
      />
      <path
        fill="currentColor"
        d="M241.72,226.66c1.24.02,2.47-.02,3.71,0,21.74.43,165.19,1.01,360.11-.1v-6.17h-342.4l-20.13-.24h-29.4c-5.22,0-10.44-.35-15.62-1.07-6.58-.91-15.56-2.27-20.7-3.55l-64.74-16.26v27.36l129.17.03Z"
      />
    </svg>
    <div className="tron-start-logo-glow" />
  </div>
);
