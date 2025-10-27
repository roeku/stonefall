import React, { useEffect, useState } from 'react';
import { PerformanceOptimizer } from './PerformanceOptimizer';

/**
 * Simple performance test component to verify optimization is working
 */
export const PerformanceTest: React.FC = () => {
    const [stats, setStats] = useState<any>(null);
    const [testResults, setTestResults] = useState<string[]>([]);

    useEffect(() => {
        const optimizer = PerformanceOptimizer.getInstance();

        const runTest = () => {
            const currentStats = optimizer.getPerformanceStats();
            setStats(currentStats);

            const results: string[] = [];

            // Test segment limits
            if (currentStats.activeSegments > 50) {
                results.push(`❌ Too many active segments: ${currentStats.activeSegments} (target: <50)`);
            } else {
                results.push(`✅ Active segments within limit: ${currentStats.activeSegments}`);
            }

            // Test FPS
            if (currentStats.fps < 45) {
                results.push(`❌ Low FPS: ${currentStats.fps.toFixed(1)} (target: >45)`);
            } else {
                results.push(`✅ FPS acceptable: ${currentStats.fps.toFixed(1)}`);
            }

            // Test pool efficiency
            if (currentStats.poolEfficiency < 0.5 && currentStats.geometryPoolHits > 0) {
                results.push(`⚠️ Low pool efficiency: ${(currentStats.poolEfficiency * 100).toFixed(1)}%`);
            } else {
                results.push(`✅ Pool efficiency: ${(currentStats.poolEfficiency * 100).toFixed(1)}%`);
            }

            setTestResults(results);
        };

        // Run test every 2 seconds
        const interval = setInterval(runTest, 2000);
        runTest(); // Initial run

        return () => clearInterval(interval);
    }, []);

    if (!stats) return null;

    return (
        <div style={{
            position: 'fixed',
            top: '10px',
            left: '10px',
            backgroundColor: 'rgba(0, 0, 0, 0.9)',
            color: '#ffffff',
            padding: '15px',
            borderRadius: '8px',
            fontFamily: 'monospace',
            fontSize: '12px',
            zIndex: 1001,
            minWidth: '300px',
            border: '2px solid #333'
        }}>
            <div style={{ marginBottom: '10px', fontWeight: 'bold', color: '#00ff00' }}>
                Performance Test Results
            </div>

            {testResults.map((result, index) => (
                <div key={index} style={{ marginBottom: '5px' }}>
                    {result}
                </div>
            ))}

            <div style={{ marginTop: '10px', fontSize: '10px', color: '#888' }}>
                Last updated: {new Date().toLocaleTimeString()}
            </div>
        </div>
    );
};
