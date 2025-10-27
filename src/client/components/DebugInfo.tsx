import React, { useState, useEffect } from 'react';
import { GameState } from '../../shared/simulation';
import { ContinuousPath } from './PathGenerator';

interface DebugInfoProps {
    gameState: GameState | null;
    paths: ContinuousPath[];
    enabled?: boolean;
}

/**
 * Debug information overlay showing current state
 */
export const DebugInfo: React.FC<DebugInfoProps> = ({
    gameState,
    paths,
    enabled = false
}) => {
    const [info, setInfo] = useState<any>(null);

    useEffect(() => {
        if (!enabled) return;

        const updateInfo = () => {
            const totalBlocks = gameState?.blocks?.length || 0;
            const pathsByType = {
                perimeter: paths.filter(p => p.pathType === 'perimeter').length,
                vertical: paths.filter(p => p.pathType === 'vertical').length,
                crossBlock: paths.filter(p => p.pathType === 'cross-block').length,
            };

            setInfo({
                totalBlocks,
                totalPaths: paths.length,
                pathsByType,
                pathDetails: paths.slice(0, 3).map(p => ({
                    type: p.pathType,
                    points: p.points.length,
                    length: p.totalLength.toFixed(2),
                    blocks: p.blockIndices.join(',')
                }))
            });
        };

        updateInfo();
        const interval = setInterval(updateInfo, 1000);
        return () => clearInterval(interval);
    }, [enabled, gameState, paths]);

    if (!enabled || !info) return null;

    return (
        <div style={{
            position: 'fixed',
            bottom: '10px',
            left: '10px',
            backgroundColor: 'rgba(0, 0, 0, 0.9)',
            color: '#ffffff',
            padding: '15px',
            borderRadius: '8px',
            fontFamily: 'monospace',
            fontSize: '11px',
            zIndex: 1002,
            minWidth: '250px',
            border: '2px solid #333'
        }}>
            <div style={{ marginBottom: '10px', fontWeight: 'bold', color: '#00ff00' }}>
                Debug Info
            </div>

            <div style={{ marginBottom: '8px' }}>
                <strong>Blocks:</strong> {info.totalBlocks}
            </div>

            <div style={{ marginBottom: '8px' }}>
                <strong>Total Paths:</strong> {info.totalPaths}
            </div>

            <div style={{ marginBottom: '8px' }}>
                <strong>Path Types:</strong>
                <div style={{ marginLeft: '10px', fontSize: '10px' }}>
                    Perimeter: {info.pathsByType.perimeter}<br />
                    Vertical: {info.pathsByType.vertical}<br />
                    Cross-block: {info.pathsByType.crossBlock}
                </div>
            </div>

            <div style={{ marginBottom: '8px' }}>
                <strong>Sample Paths:</strong>
                {info.pathDetails.map((path: any, index: number) => (
                    <div key={index} style={{ marginLeft: '10px', fontSize: '10px' }}>
                        {path.type}: {path.points}pts, len={path.length}, blocks=[{path.blocks}]
                    </div>
                ))}
            </div>

            <div style={{ fontSize: '9px', color: '#888' }}>
                Press Ctrl+D to toggle debug modes
            </div>
        </div>
    );
};
