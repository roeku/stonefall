import React from 'react';
import { PlayerColorTheme } from '../constants/playerColors';

interface CycleScrubberProps {
  currentCycleId: string;
  onCycleChange: (cycleId: string) => void;
  activeTheme?: PlayerColorTheme;
}

export const CycleScrubber: React.FC<CycleScrubberProps> = ({
  currentCycleId,
  onCycleChange,
  activeTheme,
}) => {
  // Helper to format date as YYYY-MM-DD
  const formatDate = (date: Date) => date.toISOString().split('T')[0] || new Date().toISOString().split('T')[0]!;

  // Helper to parse YYYY-MM-DD
  const parseDate = (dateStr: string) => new Date(dateStr);

  const handlePrev = (e: React.MouseEvent) => {
    e.stopPropagation();
    const date = parseDate(currentCycleId);
    date.setDate(date.getDate() - 1);
    onCycleChange(formatDate(date));
  };

  const handleNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    const date = parseDate(currentCycleId);
    const today = new Date();
    // Don't go past today
    if (date.toDateString() === today.toDateString()) return;

    date.setDate(date.getDate() + 1);
    onCycleChange(formatDate(date));
  };

  const isToday = (dateStr: string) => {
    const today = new Date().toISOString().split('T')[0];
    return dateStr === today;
  };

  const accentColor = activeTheme?.accentHex || '#00f2fe';

  return (
    <div
      className="gap-2 flex items-center justify-center pointer-events-auto"
      style={{ color: accentColor }}
    >
      <button
        onClick={handlePrev}
        className="transition-colors p-1 opacity-70 hover:opacity-100 border-none bg-transparent "
        aria-label="Previous Cycle"
        style={{ color: accentColor }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
          <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
        </svg>
      </button>

      <div
        className="text-[10px] font-mono min-w-[60px] text-center tracking-wider opacity-90"
        style={{
          color: accentColor,
          textShadow: `0 0 5px ${accentColor}40`
        }}
      >
        {isToday(currentCycleId) ? 'TODAY' : currentCycleId}
      </div>

      <button
        onClick={handleNext}
        disabled={isToday(currentCycleId)}
        className={`p-1 transition-colors border-none bg-transparent ${isToday(currentCycleId)
          ? 'cursor-not-allowed opacity-30'
          : 'hover:opacity-100 opacity-70'
          }`}
        aria-label="Next Cycle"
        style={{ color: isToday(currentCycleId) ? '#666' : accentColor }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
          <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" />
        </svg>
      </button>
    </div>
  );
};
