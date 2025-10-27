import React, { useState, useEffect } from 'react';

interface PerformanceStats {
  fps: number;
  memory: number;
  isLowPerformance: boolean;
}

export const PerformanceDisplay: React.FC<{ visible?: boolean }> = ({ visible = false }) => {
  // Performance display completely disabled for production
  return null;

};
