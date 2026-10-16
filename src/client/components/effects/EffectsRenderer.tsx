import React from 'react';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';
import { BOARD_BLOOM, RUN_BLOOM } from './bloomLooks';

/** Bloom pass, shared by the board and the game; `look` picks whose numbers (bloomLooks.ts). */
export const EffectsRenderer: React.FC<{ look?: 'run' | 'board' }> = ({ look = 'run' }) => {
  const b = look === 'board' ? BOARD_BLOOM : RUN_BLOOM;
  return (
    <EffectComposer>
      <Bloom
        blendFunction={BlendFunction.ADD}
        intensity={b.intensity}
        luminanceThreshold={b.luminanceThreshold}
        luminanceSmoothing={b.luminanceSmoothing}
      />
    </EffectComposer>
  );
};
