import { useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface ScreenShakeOptions {
  intensity?: number;
  duration?: number;
  frequency?: number;
}

export const useScreenShake = (
  cameraRef: React.RefObject<THREE.PerspectiveCamera>,
  trigger: boolean,
  options: ScreenShakeOptions = {}
) => {
  const { intensity = 0.1, duration = 0.3, frequency = 20 } = options;

  const shakeStartTime = useRef<number>(0);
  const originalPosition = useRef<THREE.Vector3>(new THREE.Vector3());
  const isShaking = useRef<boolean>(false);

  // Start shake when triggered
  useEffect(() => {
    if (trigger && cameraRef.current && !isShaking.current) {
      shakeStartTime.current = Date.now();
      originalPosition.current.copy(cameraRef.current.position);
      isShaking.current = true;
    }
  }, [trigger, cameraRef]);

  useFrame(() => {
    if (!isShaking.current || !cameraRef.current) return;

    const elapsed = (Date.now() - shakeStartTime.current) / 1000;

    if (elapsed >= duration) {
      // End shake, restore original position
      cameraRef.current.position.copy(originalPosition.current);
      isShaking.current = false;
      return;
    }

    // Calculate shake intensity (decreases over time)
    const progress = elapsed / duration;
    const currentIntensity = intensity * (1 - progress);

    // Generate random shake offset
    const time = elapsed * frequency;
    const shakeX = Math.sin(time * 1.3) * currentIntensity * (Math.random() - 0.5) * 2;
    const shakeY = Math.sin(time * 1.7) * currentIntensity * (Math.random() - 0.5) * 2;
    const shakeZ = Math.sin(time * 1.1) * currentIntensity * (Math.random() - 0.5) * 2;

    // Apply shake to camera position
    cameraRef.current.position.copy(originalPosition.current);
    cameraRef.current.position.add(new THREE.Vector3(shakeX, shakeY, shakeZ));
  });

  return isShaking.current;
};
