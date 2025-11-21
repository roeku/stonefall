import React, { useRef, useState, useEffect } from 'react';

interface DebugTimingOverlayProps {
    position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
    gameState?: {
        tick?: number;
        blocks?: readonly any[];
        activeBlockIndex?: number;
    } | null;
    // Pass timing data from useGameState
    timingData?: {
        deltaTime: number;
        rawDeltaTime: number;
        avgFrameTime: number;
        variance: number;
        tickAccumulator: number;
        ticksThisFrame: number;
        lastInitTime: number;
    } | undefined;
}

/**
 * Debug overlay specifically for timing issues
 * Shows actual frame times, smoothing, tick processing
 */
export const DebugTimingOverlay: React.FC<DebugTimingOverlayProps> = ({
    position = 'bottom-left',
    gameState,
    timingData
}) => {
    const [stats, setStats] = useState({
        fps: 0,
        rawMs: 0,
        smoothedMs: 0,
        variance: 0,
        tickAccumulator: 0,
        ticksProcessed: 0,
        currentTick: 0,
        blockCount: 0,
        activeBlockPos: 0,
        initAge: 0,
    });

    // Track FPS history to detect rapid switching (30-60fps)
    const fpsHistoryRef = useRef<number[]>([]);

    const frameCount = useRef(0);
    const lastTime = useRef(performance.now());
    const animationFrameId = useRef<number | undefined>(undefined);

    useEffect(() => {
        const updateStats = () => {
            frameCount.current++;
            const now = performance.now();

            // Update every 10 frames (~0.16 seconds at 60fps)
            if (frameCount.current % 10 === 0) {
                const delta = now - lastTime.current;
                const fps = Math.round((10 * 1000) / delta);

                // Track FPS history (last 5 readings)
                if (isFinite(fps)) {
                    fpsHistoryRef.current.push(fps);
                    if (fpsHistoryRef.current.length > 5) {
                        fpsHistoryRef.current.shift();
                    }
                }

                const activeBlock = gameState?.blocks?.[gameState?.activeBlockIndex || 0];

                setStats({
                    fps: isFinite(fps) ? fps : 0,
                    rawMs: timingData?.rawDeltaTime ? Math.round(timingData.rawDeltaTime * 10) / 10 : 0,
                    smoothedMs: timingData?.deltaTime ? Math.round(timingData.deltaTime * 10) / 10 : 0,
                    variance: timingData?.variance ? Math.round(timingData.variance * 10) / 10 : 0,
                    tickAccumulator: timingData?.tickAccumulator ? Math.round(timingData.tickAccumulator * 10) / 10 : 0,
                    ticksProcessed: timingData?.ticksThisFrame || 0,
                    currentTick: gameState?.tick || 0,
                    blockCount: gameState?.blocks?.length || 0,
                    activeBlockPos: activeBlock?.gridPosition || 0,
                    initAge: timingData?.lastInitTime ? Math.round((now - timingData.lastInitTime) / 1000) : 0,
                });

                lastTime.current = now;
            }

            animationFrameId.current = requestAnimationFrame(updateStats);
        };

        animationFrameId.current = requestAnimationFrame(updateStats);

        return () => {
            if (animationFrameId.current) {
                cancelAnimationFrame(animationFrameId.current);
            }
        };
    }, [gameState, timingData]);

    const getPositionStyle = (): React.CSSProperties => {
        const base: React.CSSProperties = {
            position: 'fixed',
            zIndex: 10001, // Above performance overlay
            pointerEvents: 'none',
            userSelect: 'none',
        };

        switch (position) {
            case 'top-left':
                return { ...base, top: '10px', left: '10px' };
            case 'top-right':
                return { ...base, top: '10px', right: '10px' };
            case 'bottom-left':
                return { ...base, bottom: '10px', left: '10px' };
            case 'bottom-right':
                return { ...base, bottom: '10px', right: '10px' };
            default:
                return { ...base, bottom: '10px', left: '10px' };
        }
    };

    const getFPSColor = () => {
        // Check if FPS is rapidly switching (Android issue)
        if (fpsHistoryRef.current.length >= 3) {
            const minFPS = Math.min(...fpsHistoryRef.current);
            const maxFPS = Math.max(...fpsHistoryRef.current);
            const fpsRange = maxFPS - minFPS;

            // If FPS varies by >20 (e.g., 30-60), show as PURPLE warning
            if (fpsRange > 20) return '#ff00ff';
        }

        if (stats.fps >= 55) return '#00ff00';
        if (stats.fps >= 45) return '#ffff00';
        return '#ff0000';
    };

    const getVarianceColor = () => {
        if (stats.variance < 5) return '#00ff00';
        if (stats.variance < 10) return '#ffff00';
        return '#ff0000';
    };

    const getSmoothingColor = () => {
        const diff = Math.abs(stats.rawMs - stats.smoothedMs);
        if (diff < 2) return '#888888'; // Not much smoothing needed
        if (diff < 5) return '#ffff00'; // Moderate smoothing
        return '#ff00ff'; // Heavy smoothing active
    };

    // Detect rapid FPS switching
    const hasRapidFPSSwitching = () => {
        if (fpsHistoryRef.current.length >= 3) {
            const minFPS = Math.min(...fpsHistoryRef.current);
            const maxFPS = Math.max(...fpsHistoryRef.current);
            return (maxFPS - minFPS) > 20;
        }
        return false;
    };

    return (
        <div style={{
            ...getPositionStyle(),
            fontFamily: 'monospace',
            fontSize: '11px',
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            color: '#ffffff',
            padding: '8px 10px',
            borderRadius: '4px',
            minWidth: '180px',
            border: '1px solid rgba(255, 255, 255, 0.2)',
        }}>
            {/* FPS Switching Warning Banner */}
            {hasRapidFPSSwitching() && (
                <div style={{
                    fontSize: '9px',
                    color: '#ff00ff',
                    backgroundColor: 'rgba(255, 0, 255, 0.15)',
                    padding: '4px 6px',
                    marginBottom: '6px',
                    borderRadius: '3px',
                    border: '1px solid rgba(255, 0, 255, 0.4)',
                    fontWeight: 'bold',
                    textAlign: 'center',
                }}>
                    ⚠️ FPS SWITCHING
                </div>
            )}

            <div style={{
                fontSize: '10px',
                color: '#888',
                marginBottom: '6px',
                borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
                paddingBottom: '4px',
            }}>
                🔍 TIMING DEBUG
            </div>

            {/* Frame Rate */}
            <div style={{ marginBottom: '2px' }}>
                <span style={{ color: '#888' }}>FPS:</span>{' '}
                <span style={{ color: getFPSColor(), fontWeight: 'bold' }}>
                    {stats.fps}
                </span>
            </div>

            {/* Frame Times */}
            <div style={{ marginBottom: '2px' }}>
                <span style={{ color: '#888' }}>Raw ms:</span>{' '}
                <span style={{ color: '#fff' }}>{stats.rawMs}</span>
            </div>
            <div style={{ marginBottom: '2px' }}>
                <span style={{ color: '#888' }}>Smooth ms:</span>{' '}
                <span style={{ color: getSmoothingColor() }}>{stats.smoothedMs}</span>
            </div>
            <div style={{ marginBottom: '6px' }}>
                <span style={{ color: '#888' }}>Jitter:</span>{' '}
                <span style={{ color: getVarianceColor() }}>{stats.variance}ms</span>
            </div>

            {/* Tick Processing */}
            <div style={{
                borderTop: '1px solid rgba(255, 255, 255, 0.1)',
                paddingTop: '4px',
                marginBottom: '2px',
            }}>
                <span style={{ color: '#888' }}>Accum:</span>{' '}
                <span style={{ color: stats.tickAccumulator > 33 ? '#ff0000' : '#fff' }}>
                    {stats.tickAccumulator}ms
                </span>
            </div>
            <div style={{ marginBottom: '2px' }}>
                <span style={{ color: '#888' }}>Ticks/frame:</span>{' '}
                <span style={{ color: stats.ticksProcessed > 2 ? '#ff0000' : '#fff' }}>
                    {stats.ticksProcessed}
                </span>
            </div>
            <div style={{ marginBottom: '6px' }}>
                <span style={{ color: '#888' }}>Current tick:</span>{' '}
                <span style={{ color: '#fff' }}>{stats.currentTick}</span>
            </div>

            {/* Game State */}
            <div style={{
                borderTop: '1px solid rgba(255, 255, 255, 0.1)',
                paddingTop: '4px',
                marginBottom: '2px',
            }}>
                <span style={{ color: '#888' }}>Blocks:</span>{' '}
                <span style={{ color: '#fff' }}>{stats.blockCount}</span>
            </div>
            <div style={{ marginBottom: '2px' }}>
                <span style={{ color: '#888' }}>Active pos:</span>{' '}
                <span style={{ color: '#00ffff', fontWeight: 'bold' }}>
                    {stats.activeBlockPos}
                </span>
            </div>
            <div style={{ marginBottom: '0' }}>
                <span style={{ color: '#888' }}>Init age:</span>{' '}
                <span style={{
                    color: stats.initAge < 2 ? '#ff00ff' : '#888',
                    fontWeight: stats.initAge < 2 ? 'bold' : 'normal',
                }}>
                    {stats.initAge}s
                </span>
            </div>
        </div>
    );
};
