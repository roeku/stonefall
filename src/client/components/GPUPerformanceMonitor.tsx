/**
 * GPU Performance Monitor
 * 
 * Monitors and displays GPU instancing performance metrics.
 * Tracks draw calls, instances, and frame times.
 */

import React, { useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';

interface PerformanceMetrics {
    fps: number;
    drawCalls: number;
    triangles: number;
    instances: number;
    geometries: number;
    textures: number;
    frameTime: number;
}

interface GPUPerformanceMonitorProps {
    enabled?: boolean;
    updateInterval?: number;
}

export const GPUPerformanceMonitor: React.FC<GPUPerformanceMonitorProps> = ({
    enabled = true,
    updateInterval = 1000,
}) => {
    const { gl } = useThree();
    const [metrics, setMetrics] = useState<PerformanceMetrics>({
        fps: 0,
        drawCalls: 0,
        triangles: 0,
        instances: 0,
        geometries: 0,
        textures: 0,
        frameTime: 0,
    });

    const frameCountRef = useRef(0);
    const lastUpdateRef = useRef(performance.now());
    const frameTimesRef = useRef<number[]>([]);

    useFrame((_, delta) => {
        if (!enabled) return;

        frameCountRef.current++;
        frameTimesRef.current.push(delta * 1000); // Convert to ms

        // Keep only last 60 frames
        if (frameTimesRef.current.length > 60) {
            frameTimesRef.current.shift();
        }

        const now = performance.now();
        const elapsed = now - lastUpdateRef.current;

        if (elapsed >= updateInterval) {
            const fps = Math.round((frameCountRef.current / elapsed) * 1000);
            const avgFrameTime = frameTimesRef.current.reduce((a, b) => a + b, 0) / frameTimesRef.current.length;

            const info = gl.info;

            setMetrics({
                fps,
                drawCalls: info.render.calls,
                triangles: info.render.triangles,
                instances: info.render.calls, // Approximate
                geometries: info.memory.geometries,
                textures: info.memory.textures,
                frameTime: avgFrameTime,
            });

            frameCountRef.current = 0;
            lastUpdateRef.current = now;
        }
    });

    if (!enabled) return null;

    // Expose metrics for external use
    (window as any).__gpuMetrics = metrics;

    return null;
};

/**
 * UI component to display performance metrics
 */
interface PerformanceDisplayProps {
    metrics: PerformanceMetrics;
}

export const PerformanceMetricsDisplay: React.FC<PerformanceDisplayProps> = ({ metrics }) => {
    const getPerformanceColor = (fps: number) => {
        if (fps >= 55) return '#00ff00';
        if (fps >= 30) return '#ffff00';
        return '#ff0000';
    };

    return (
        <div
            style={{
                position: 'fixed',
                top: '10px',
                right: '10px',
                background: 'rgba(0, 0, 0, 0.8)',
                color: '#00f2fe',
                padding: '12px',
                fontFamily: 'monospace',
                fontSize: '12px',
                borderRadius: '4px',
                border: '1px solid #00f2fe',
                zIndex: 10000,
                minWidth: '220px',
            }}
        >
            <div style={{ fontWeight: 'bold', marginBottom: '8px', color: '#ffffff' }}>
                🎮 GPU Performance
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span>FPS:</span>
                <span style={{ color: getPerformanceColor(metrics.fps), fontWeight: 'bold' }}>
                    {metrics.fps}
                </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span>Frame Time:</span>
                <span>{metrics.frameTime.toFixed(2)}ms</span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span>Draw Calls:</span>
                <span style={{ fontWeight: 'bold' }}>{metrics.drawCalls}</span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span>Triangles:</span>
                <span>{metrics.triangles.toLocaleString()}</span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span>Geometries:</span>
                <span>{metrics.geometries}</span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Textures:</span>
                <span>{metrics.textures}</span>
            </div>

            <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid #00f2fe44' }}>
                <div style={{ fontSize: '10px', color: '#888888' }}>
                    ✨ GPU Instancing Enabled
                </div>
            </div>
        </div>
    );
};
