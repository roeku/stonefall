import React from 'react';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';

/** Bloom pass, shared by the grid and the game so the neon reads the same in both. */
export const EffectsRenderer: React.FC = () => {
  return (
    <EffectComposer>
      <Bloom
        blendFunction={BlendFunction.ADD}
        intensity={1.2}
        luminanceThreshold={0.1}
        luminanceSmoothing={0.4}
      />
    </EffectComposer>
  );
};
