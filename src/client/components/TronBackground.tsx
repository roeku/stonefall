import React, { useRef } from 'react';
import { Grid } from '@react-three/drei';
import { DEFAULT_TOWER_GRID_OFFSET, DEFAULT_TOWER_GRID_SIZE } from '../../shared/types/towerPlacement';

interface TronBackgroundProps {
  gameState?: any;
  gridSize?: number;
  gridOffsetX?: number;
  gridOffsetZ?: number;
  gridLineWidth?: number;
  gridColorHex?: string | undefined;
}

type RGBColor = { r: number; g: number; b: number };

const DEFAULT_GRID_COLOR: RGBColor = { r: 255, g: 69, b: 0 }; // Original orangered tint

const expandShorthandHex = (hex: string): string => {
  if (hex.length !== 3) return hex;
  return hex.split('').map(char => char + char).join('');
};

const hexToRgb = (hexInput?: string): RGBColor => {
  if (!hexInput) return DEFAULT_GRID_COLOR;
  const sanitized = hexInput.replace('#', '').trim();
  const expanded = expandShorthandHex(sanitized);
  if (expanded.length !== 6) {
    return DEFAULT_GRID_COLOR;
  }
  const r = parseInt(expanded.slice(0, 2), 16);
  const g = parseInt(expanded.slice(2, 4), 16);
  const b = parseInt(expanded.slice(4, 6), 16);
  if ([r, g, b].some(value => Number.isNaN(value))) {
    return DEFAULT_GRID_COLOR;
  }
  return { r, g, b };
};

export const TronBackground: React.FC<TronBackgroundProps> = ({
  gameState,
  gridSize = DEFAULT_TOWER_GRID_SIZE,
  gridOffsetX = DEFAULT_TOWER_GRID_OFFSET,
  gridOffsetZ = DEFAULT_TOWER_GRID_OFFSET,
  gridLineWidth = 3.0,
  gridColorHex,
}) => {
  const gridRef = useRef<any>(null);

  const gridColor = hexToRgb(gridColorHex);

  // Performance optimization: reduce grid complexity during gameplay
  const isGameOver = gameState?.isGameOver;
  const performanceMode = !isGameOver; // Use performance mode during gameplay

  return (
    <>
      {/* Subtle Grid - much less bright, appears gradually */}
      <Grid
        ref={gridRef}
        position={[gridOffsetX, -0.5, gridOffsetZ]}
        // Smaller grid during gameplay for performance
        args={performanceMode ? [5, 5] : [10, 10]}
        // Cell configuration - much dimmer colors
        cellSize={gridSize}
        cellThickness={performanceMode ? 0.5 : Math.max(0.5, gridLineWidth * 0.3)}
        cellColor={`#${gridColor.r.toString(16).padStart(2, '0')}${gridColor.g.toString(16).padStart(2, '0')}${gridColor.b.toString(16).padStart(2, '0')}`} // Tint based on grid balance
        // Section configuration - simplified during gameplay
        sectionSize={performanceMode ? gridSize * 10 : gridSize * 5}
        sectionThickness={performanceMode ? 1.0 : Math.max(1.0, gridLineWidth * 0.5)}
        sectionColor={`#${gridColor.r.toString(16).padStart(2, '0')}${gridColor.g.toString(16).padStart(2, '0')}${gridColor.b.toString(16).padStart(2, '0')}`} // Slightly brighter tint
        // Reduced fade distance during gameplay
        fadeDistance={performanceMode ? 50 : 1000}
        fadeStrength={1}
        // Disable infinite grid during gameplay
        followCamera={false}
        infiniteGrid={!performanceMode}
        // Simple depth buffer settings - revert to working state
        material-depthWrite={false}
        material-depthTest={true}
        material-transparent={true}
        material-opacity={.8}
        renderOrder={-100}
      />
    </>
  );
};
