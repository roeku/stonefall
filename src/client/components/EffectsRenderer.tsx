import React from 'react';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';

export const EffectsRenderer: React.FC = () => {
  return (
    <EffectComposer>
      {/* Bloom effect for neon glow - keep for active block outline */}
      <Bloom
        blendFunction={BlendFunction.ADD}
        intensity={0.6}
        width={300}
        height={300}
        kernelSize={3}
        luminanceThreshold={0.2}
        luminanceSmoothing={0.025}
      />
    </EffectComposer>
  );
};
