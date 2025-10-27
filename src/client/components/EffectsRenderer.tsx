import React from 'react';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';

export const EffectsRenderer: React.FC = () => {
  return (
    <EffectComposer>
      {/* Enhanced bloom effect for Tron neon glow */}
      <Bloom
        blendFunction={BlendFunction.ADD}
        intensity={1.2}
        width={300}
        height={300}
        kernelSize={5}
        luminanceThreshold={0.1}
        luminanceSmoothing={0.4}
      />
    </EffectComposer>
  );
};
