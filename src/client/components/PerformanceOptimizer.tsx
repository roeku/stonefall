import React, { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { PerformanceConfig } from './PerformanceConfig';

interface PerformanceOptimizerProps {
    targetFPS?: number;
    onPerformanceChange?: (fps: number, isLowPerformance: boolean) => void;
}

export const PerformanceOptimizer: React.FC<PerformanceOptimizerProps> = ({
    targetFPS = 60,
    onPerformanceChange
}) => {
    const frameCountRef = useRef(0);
    const lastTimeRef = useRef(performance.now());
    const fpsRef = useRef(60);
    const lowPerformanceRef = useRef(false);
    const performanceConfig = PerformanceConfig.getInstance();

    // Debug: Log when component mounts
    useEffect(() => {
        console.log('🔧 PerformanceOptimizer mounted');
        return () => console.log('🔧 PerformanceOptimizer unmounted');
    }, []);

    useFrame(() => {
        frameCountRef.current++;

        // Calculate FPS every 60 frames to get more frequent updates (every 1 second at 60fps)
        if (frameCountRef.current % 60 === 0) {
            const now = performance.now();
            const elapsed = now - lastTimeRef.current;
            const fps = Math.round((60 * 1000) / elapsed);

            fpsRef.current = fps;
            const isLowPerformance = fps < targetFPS * 0.8; // 80% of target FPS

            // Log FPS only when performance changes significantly
            if (Math.abs(fps - fpsRef.current) > 5 || isLowPerformance !== lowPerformanceRef.current) {
                console.log(`📊 FPS: ${fps}, Low Performance: ${isLowPerformance}`);
            }

            if (isLowPerformance !== lowPerformanceRef.current) {
                lowPerformanceRef.current = isLowPerformance;
                onPerformanceChange?.(fps, isLowPerformance);

                // Auto-adjust quality settings using the performance config
                performanceConfig.autoAdjustForPerformance(fps);
            }

            lastTimeRef.current = now;
        }
    });

    return null; // This component doesn't render anything
};

// Performance monitoring utilities
export class PerformanceMonitor {
    private static instance: PerformanceMonitor;
    private frameCount = 0;
    private lastTime = performance.now();
    private fps = 60;
    private memoryUsage = 0;

    static getInstance(): PerformanceMonitor {
        if (!PerformanceMonitor.instance) {
            PerformanceMonitor.instance = new PerformanceMonitor();
        }
        return PerformanceMonitor.instance;
    }

    updateFrame() {
        this.frameCount++;

        if (this.frameCount % 60 === 0) {
            const now = performance.now();
            const elapsed = now - this.lastTime;
            this.fps = Math.round((60 * 1000) / elapsed);
            this.lastTime = now;

            // Update memory usage if available
            if ('memory' in performance) {
                this.memoryUsage = (performance as any).memory.usedJSHeapSize / 1024 / 1024;
            }

            // Debug logging
            console.log(`📊 PerformanceMonitor - FPS: ${this.fps}, Memory: ${this.memoryUsage.toFixed(1)}MB`);
        }
    }

    getFPS(): number {
        return this.fps;
    }

    getMemoryUsage(): number {
        return this.memoryUsage;
    }

    isLowPerformance(targetFPS = 60): boolean {
        return this.fps < targetFPS * 0.8;
    }

    // Cleanup unused objects and force garbage collection
    cleanup() {
        // Clear any global debug events that might be accumulating
        try {
            const g = globalThis as any;
            if (g.__DEBUG_EVENTS && g.__DEBUG_EVENTS.length > 50) {
                g.__DEBUG_EVENTS = g.__DEBUG_EVENTS.slice(-50);
            }
        } catch (e) {
            // ignore
        }

        // Force garbage collection if available
        if ('gc' in window) {
            (window as any).gc();
        }
    }
}

// Hook for using performance monitoring
export const usePerformanceMonitor = () => {
    const monitor = PerformanceMonitor.getInstance();

    useEffect(() => {
        const interval = setInterval(() => {
            monitor.cleanup();
        }, 10000); // Cleanup every 10 seconds

        return () => clearInterval(interval);
    }, [monitor]);

    return {
        fps: monitor.getFPS(),
        memoryUsage: monitor.getMemoryUsage(),
        isLowPerformance: monitor.isLowPerformance(),
        cleanup: () => monitor.cleanup()
    };
};
