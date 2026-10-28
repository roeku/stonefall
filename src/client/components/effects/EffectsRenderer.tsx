import React from 'react';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';
import { BOARD_BLOOM, RUN_BLOOM } from './bloomLooks';
import { useSettings } from '../../utils/settings';
import { composerSamples } from '../../utils/quality';

/**
 * Bloom pass, shared by the board and the game; `look` picks whose numbers (bloomLooks.ts). The
 * Quality setting thins the frame under it (utils/quality.ts), never the glow itself.
 */
export const EffectsRenderer: React.FC<{ look?: 'run' | 'board' }> = ({ look = 'run' }) => {
  const b = look === 'board' ? BOARD_BLOOM : RUN_BLOOM;
  const { quality } = useSettings();
  return (
    <EffectComposer multisampling={composerSamples(quality)}>
      <Bloom
        blendFunction={BlendFunction.ADD}
        intensity={b.intensity}
        luminanceThreshold={b.luminanceThreshold}
        luminanceSmoothing={b.luminanceSmoothing}
      />
    </EffectComposer>
  );
};
