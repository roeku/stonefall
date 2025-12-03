import React, { useEffect, useState } from 'react';
import './tronLoadingScreen.css';

interface TronLoadingScreenProps {
  isLoading: boolean;
  progress: number;
  message?: string;
}

export const TronLoadingScreen: React.FC<TronLoadingScreenProps> = ({
  isLoading,
  progress,
  message = 'INITIALIZING GRID'
}) => {
  const [isVisible, setIsVisible] = useState(true);
  const [showContent, setShowContent] = useState(false);

  useEffect(() => {
    if (isLoading) {
      setIsVisible(true);
      // Small delay to trigger enter animations
      requestAnimationFrame(() => setShowContent(true));
    } else {
      setShowContent(false);
      const timer = setTimeout(() => setIsVisible(false), 800); // Wait for exit animations
      return () => clearTimeout(timer);
    }
  }, [isLoading]);

  if (!isVisible) return null;

  return (
    <div className={`tron-loading-screen ${!isLoading ? 'fade-out' : ''}`}>
      <div className="tron-loading-grid" />

      <div className="tron-loading-content">
        <div className={`tron-logo-container ${showContent ? 'visible' : ''}`}>
          <div className="tron-logo-glow" />
          {/* Stonefall Logo SVG */}
          <svg className="tron-logo-svg" viewBox="0 0 100 100" fill="currentColor">
            <path d="M50 10 L90 30 L90 70 L50 90 L10 70 L10 30 Z" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M50 20 L80 35 L80 65 L50 80 L20 65 L20 35 Z" fill="currentColor" opacity="0.8" />
          </svg>
          <div className="tron-logo-scan" />
        </div>

        <div className={`tron-loading-info ${showContent ? 'visible' : ''}`}>
          <div className="tron-loading-message">{message}</div>

          <div className="tron-progress-container">
            <div className="tron-progress-track">
              <div
                className="tron-progress-fill"
                style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
              />
            </div>
            <div className="text-cyan-400 font-mono text-xs tracking-widest mt-2">
              {Math.round(progress)}%
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
