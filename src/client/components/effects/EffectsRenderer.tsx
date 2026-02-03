import React from 'react';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';

export const EffectsRenderer: React.FC = () => {
  return (
    <EffectComposer>
      {/* SMAA for high quality antialiasing */}
      {/* <SMAA /> */}

      {/* Enhanced bloom effect for Tron neon glow */}
      <Bloom
        blendFunction={BlendFunction.ADD}
        intensity={1.2}
        luminanceThreshold={0.1}
        luminanceSmoothing={0.4}
      />
    </EffectComposer>
  );
};
