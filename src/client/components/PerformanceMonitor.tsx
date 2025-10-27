import React, { useState, useEffect } from 'react';
import { PerformanceOptimizer } from './PerformanceOptimizer';

interface PerformanceMonitorProps {
    enabled?: boolean;
    position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
}

/**
 * Performance monitoring overlay for energy flow segments
 * Shows real-time performance metrics and optimization statistics
 */
export const PerformanceMonitor: React.FC<PerformanceMonitorProps> = ({
    enabled = false,
    position = 'top-right'
}) => {
    const [stats, setStats] = useState<any>(null);
    const [isVisible, setIsVisible] = useState(enabled);

    useEffect(() => {
        if (!enabled) return;

        const performanceOptimizer = PerformanceOptimizer.getInstance();

        const updateStats = () => {
            setStats(performanceOptimizer.getPerformanceStats());
        };

        // Update stats every second
        const interval = setInterval(updateStats, 1000);

        // Initial update
        updateStats();

        return () => clearInterval(interval);
    }, [enabled]);

    // Toggle visibility with keyboard shortcut
    useEffect(() => {
        const handleKeyPress = (event: KeyboardEvent) => {
            if (event.key === 'P' && event.ctrlKey) {
                setIsVisible(prev => !prev);
            }
        };

        window.addEventListener('keydown', handleKeyPress);
        return () => window.removeEventListener('keydown', handleKeyPress);
    }, []);

    if (!isVisible || !stats) return null;

    const getPositionStyles = () => {
        const baseStyles = {
            position: 'fixed' as const,
            zIndex: 1000,
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            color: '#00ff00',
            fontFamily: 'monospace',
            fontSize: '12px',
            padding: '10px',
            borderRadius: '4px',
            minWidth: '200px',
            border: '1px solid #333',
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
        if (fps >= 45) return '#ffff00'; // Yellow
        if (fps >= 30) return '#ff8800'; // Orange
        return '#ff0000'; // Red
    };

    const getEfficiencyColor = (efficiency: number) => {
        if (efficiency >= 0.8) return '#00ff00'; // Green
        if (efficiency >= 0.6) return '#ffff00'; // Yellow
        return '#ff8800'; // Orange
    };

    return (
        <div style={getPositionStyles()}>
            <div style={{ marginBottom: '8px', fontWeight: 'bold', color: '#ffffff' }}>
                Energy Flow Performance
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', fontSize: '11px' }}>
                <div>FPS:</div>
                <div style={{ color: getFPSColor(stats.fps) }}>
                    {stats.fps.toFixed(1)}
                </div>

                <div>Frame Time:</div>
                <div style={{ color: stats.frameTime > 22 ? '#ff8800' : '#00ff00' }}>
                    {stats.frameTime.toFixed(1)}ms
                </div>

                <div>Active Segments:</div>
                <div style={{ color: stats.activeSegments > 150 ? '#ff8800' : '#00ff00' }}>
                    {stats.activeSegments}
                </div>

                <div>Culled Segments:</div>
                <div style={{ color: '#888888' }}>
                    {stats.culledSegments}
                </div>

                <div>Pool Efficiency:</div>
                <div style={{ color: getEfficiencyColor(stats.poolEfficiency) }}>
                    {(stats.poolEfficiency * 100).toFixed(1)}%
                </div>

                <div>Pool Hits:</div>
                <div style={{ color: '#00ff00' }}>
                    {stats.geometryPoolHits}
                </div>

                <div>Pool Misses:</div>
                <div style={{ color: '#ff8800' }}>
                    {stats.geometryPoolMisses}
                </div>

                <div>Geometry Pool:</div>
                <div style={{ color: stats.memoryUsage.geometryPool > 40 ? '#ff8800' : '#00ff00' }}>
                    {stats.memoryUsage.geometryPool}/50
                </div>

                <div>Material Pool:</div>
                <div style={{ color: '#888888' }}>
                    {stats.memoryUsage.materialPool}
                </div>
            </div>

            <div style={{ marginTop: '8px', fontSize: '10px', color: '#888888' }}>
                Press Ctrl+P to toggle
            </div>
        </div>
    );
};
