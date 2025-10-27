import React from 'react';
import { PerfectPlacementGlow } from './PerfectPlacementGlow';

interface PerfectPlacementEffectsProps {
  triggerKey: number;
  effectPosition: [number, number, number];
  blockWidth: number;
  blockHeight: number;
  tier?: number; // escalation tier 0-15 now
  onComplete?: () => void;
}

export const PerfectPlacementEffects: React.FC<PerfectPlacementEffectsProps> = ({ triggerKey, effectPosition, blockWidth, blockHeight, tier = 0, onComplete }) => {
  const [activeGlow, setActiveGlow] = React.useState(true);
  // sparkStart removed (unused once SparkBurst disabled)
  React.useEffect(() => {
    setActiveGlow(true);
    return () => { };
  }, [triggerKey]);

  return (
    <>
      <PerfectPlacementGlow
        active={activeGlow}
        contactPosition={effectPosition}
        blockWidth={blockWidth}
        blockHeight={blockHeight}
        tier={tier}
        onComplete={() => { setActiveGlow(false); onComplete?.(); }}
      />
      {/* <SparkBurst start={sparkStart} origin={effectPosition} width={blockWidth} height={blockHeight} tier={tier} /> */}
    </>
  );
};
