import React, { useState, useEffect, useRef } from 'react';

interface PerformanceMonitorProps {
    enabled?: boolean;
    position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
}

interface PerformanceStats {
    fps: number;
    frameTime: number;
}

/**
 * Performance monitoring overlay - DOM-based component outside Canvas
 * Shows real-time FPS and frame time metrics
 */
export const PerformanceMonitor: React.FC<PerformanceMonitorProps> = ({
    enabled = true,
    position = 'top-right'
}) => {
    const [stats, setStats] = useState<PerformanceStats>({
        fps: 0,
        frameTime: 0,
    });
    const [isVisible, setIsVisible] = useState(enabled);

    const frameCount = useRef(0);
    const lastTime = useRef(performance.now());
    const rafRef = useRef<number | undefined>(undefined);

    useEffect(() => {
        if (!isVisible) return;

        const updateStats = () => {
            frameCount.current++;
            const now = performance.now();
            const delta = now - lastTime.current;

            // Update stats every 30 frames
            if (frameCount.current % 30 === 0) {
                const fps = Math.round(1000 / (delta / 30));
                const frameTime = parseFloat((delta / 30).toFixed(2));

                setStats({
                    fps: isFinite(fps) ? fps : 0,
                    frameTime: isFinite(frameTime) ? frameTime : 0,
                });

                lastTime.current = now;
            }

            rafRef.current = requestAnimationFrame(updateStats);
        };

        rafRef.current = requestAnimationFrame(updateStats);

        return () => {
            if (rafRef.current !== undefined) {
                cancelAnimationFrame(rafRef.current);
            }
        };
    }, [isVisible]);

    // Toggle visibility with keyboard shortcut
    useEffect(() => {
        const handleKeyPress = (event: KeyboardEvent) => {
            if (event.key === 'p' && event.ctrlKey) {
                event.preventDefault();
                setIsVisible(prev => !prev);
            }
        };

        window.addEventListener('keydown', handleKeyPress);
        return () => window.removeEventListener('keydown', handleKeyPress);
    }, []);

    if (!isVisible) return null;

    const getPositionStyles = () => {
        const baseStyles = {
            position: 'fixed' as const,
            zIndex: 10000,
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            color: '#00f2fe',
            fontFamily: 'monospace',
            fontSize: '12px',
            padding: '12px 15px',
            borderRadius: '8px',
            minWidth: '220px',
            border: '1px solid rgba(0, 242, 254, 0.5)',
            boxShadow: '0 0 20px rgba(0, 242, 254, 0.3)',
        };

        switch (position) {
            case 'top-left':
                return { ...baseStyles, top: '10px', left: '10px' };
            case 'top-right':
                return { ...baseStyles, top: '10px', right: '10px' };
            case 'bottom-left':
                return { ...baseStyles, bottom: '10px', left: '10px' };
            case 'bottom-right':
                return { ...baseStyles, bottom: '10px', right: '10px' };
            default:
                return { ...baseStyles, top: '10px', right: '10px' };
        }
    };

    const getFPSColor = (fps: number) => {
        if (fps >= 55) return '#00ff00'; // Green
        if (fps >= 30) return '#ffff00'; // Yellow
        return '#ff0000'; // Red
    };

    return (
        <div style={getPositionStyles()}>
            <div style={{ marginBottom: '8px', fontWeight: 'bold', color: '#ffffff', fontSize: '13px' }}>
                ⚡ Performance
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontSize: '11px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>FPS:</span>
                    <span style={{ color: getFPSColor(stats.fps), fontWeight: 'bold' }}>
                        {stats.fps}
                    </span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Frame Time:</span>
                    <span style={{ color: stats.frameTime > 22 ? '#ff8800' : '#00ff00' }}>
                        {stats.frameTime.toFixed(1)}ms
                    </span>
                </div>
            </div>

            <div style={{
                marginTop: '8px',
                fontSize: '9px',
                color: 'rgba(255, 255, 255, 0.4)',
                borderTop: '1px solid rgba(0, 242, 254, 0.2)',
                paddingTop: '6px',
                textAlign: 'center'
            }}>
                Ctrl+P to toggle
            </div>
        </div>
    );
};
