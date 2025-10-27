import React, { useState, useEffect } from 'react';
import { PostGameState } from '../hooks/usePostGameState';
import { TowerMapEntry } from '../../shared/types/api';

interface PostGameUIProps {
  postGameState: PostGameState;
  onExploreWorld: () => void;
  onPlayAgain: () => void;
  onShowStats: () => void;
}

export const PostGameUI: React.FC<PostGameUIProps> = ({
  postGameState,
  onExploreWorld,
  onPlayAgain,
  onShowStats,
}) => {
  const [showButtons, setShowButtons] = useState(false);

  // Delay showing buttons for dramatic effect
  useEffect(() => {
    const timer = setTimeout(() => setShowButtons(true), 1500);
    return () => clearTimeout(timer);
  }, []);

  if (!postGameState.isInPostGame) return null;

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center z-30 pointer-events-none">
      {/* Score Display */}
      <div className="text-center mb-8">
        <div
          className="text-6xl font-bold text-white mb-2"
          style={{
            textShadow: '0 0 20px rgba(255, 255, 255, 0.5)',
            animation: 'scoreGlow 2s ease-in-out infinite alternate'
          }}
        >
          {postGameState.gameScore.toLocaleString()}
        </div>
        <div className="text-xl text-gray-300">
          {postGameState.gameBlocks} blocks • Tower complete
        </div>
      </div>

      {/* Action Buttons */}
      {showButtons && (
        <div
          className="flex flex-col gap-4 pointer-events-auto"
          style={{
            animation: 'slideUp 0.8s ease-out'
          }}
        >
          {/* Primary Action - Explore World */}
          <button
            onClick={onExploreWorld}
            className="px-8 py-4 rounded-xl text-lg font-semibold transition-all duration-300 transform hover:scale-105"
            style={{
              background: 'linear-gradient(135deg, #4facfe, #00f2fe)',
              color: 'white',
              boxShadow: '0 8px 32px rgba(79, 172, 254, 0.4)',
              border: 'none',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.boxShadow = '0 12px 40px rgba(79, 172, 254, 0.6)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.boxShadow = '0 8px 32px rgba(79, 172, 254, 0.4)';
            }}
          >
            🌍 Explore Tower World
          </button>

          {/* Secondary Actions */}
          <div className="flex gap-3">
            <button
              onClick={onShowStats}
              className="px-6 py-3 rounded-lg text-sm font-medium transition-all duration-200"
              style={{
                background: 'rgba(255, 255, 255, 0.1)',
                color: 'white',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                backdropFilter: 'blur(10px)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
              }}
            >
              📊 View Stats
            </button>

            <button
              onClick={onPlayAgain}
              className="px-6 py-3 rounded-lg text-sm font-medium transition-all duration-200"
              style={{
                background: 'rgba(255, 255, 255, 0.1)',
                color: 'white',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                backdropFilter: 'blur(10px)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
              }}
            >
              🎮 Play Again
            </button>


          </div>
        </div>
      )}

      {/* Tower Info */}
      {postGameState.playerTower && (
        <div
          className="mt-6 text-center text-sm text-gray-400"
          style={{
            animation: showButtons ? 'fadeIn 1s ease-in 0.5s both' : 'none'
          }}
        >
          Your tower has been saved to the world
        </div>
      )}

      <style jsx>{`
        @keyframes scoreGlow {
          0% { text-shadow: 0 0 20px rgba(255, 255, 255, 0.5); }
          100% { text-shadow: 0 0 30px rgba(79, 172, 254, 0.8), 0 0 40px rgba(79, 172, 254, 0.4); }
        }
        
        @keyframes slideUp {
          0% { 
            opacity: 0; 
            transform: translateY(30px); 
          }
          100% { 
            opacity: 1; 
            transform: translateY(0); 
          }
        }
        
        @keyframes fadeIn {
          0% { opacity: 0; }
          100% { opacity: 1; }
        }
      `}</style>
    </div>
  );
};
