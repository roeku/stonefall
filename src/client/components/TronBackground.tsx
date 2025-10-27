import React, { useRef } from 'react';
import { Grid } from '@react-three/drei';

interface TronBackgroundProps {
  gameState?: any;
  gridSize?: number;
  gridOffsetX?: number;
  gridOffsetZ?: number;
  gridLineWidth?: number;
}

export const TronBackground: React.FC<TronBackgroundProps> = ({
  gameState,
  gridSize = 8.0,
  gridOffsetX = 0.0,
  gridOffsetZ = 0.0,
  gridLineWidth = 3.0
}) => {
  const gridRef = useRef<any>(null);

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
        cellColor={`rgba(0, 150, 255, ${.8 * 0.15})`} // Very dim blue
        // Section configuration - simplified during gameplay
        sectionSize={performanceMode ? gridSize * 10 : gridSize * 5}
        sectionThickness={performanceMode ? 1.0 : Math.max(1.0, gridLineWidth * 0.5)}
        sectionColor={`rgba(0, 200, 255, ${0.8 * 0.25})`} // Slightly brighter blue
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
