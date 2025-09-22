import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface PerfectDropState {
  active: boolean;
  startTime: number;
  duration: number;
}

export const usePerfectDropEffect = (
  cameraRef: React.RefObject<THREE.PerspectiveCamera | null>,
  onTimeScale: (scale: number) => void
) => {
  const perfectDropState = useRef<PerfectDropState>({
    active: false,
    startTime: 0,
    duration: 0.12, // 120ms as specified
  });

  const originalCameraPosition = useRef<THREE.Vector3>(new THREE.Vector3());
  const effectIntensity = 0.15; // How much the camera "pops"

  const triggerPerfectDrop = () => {
    if (cameraRef.current && !perfectDropState.current.active) {
      perfectDropState.current = {
        active: true,
        startTime: Date.now(),
        duration: 0.12,
      };

      // Store original position for restoration
      originalCameraPosition.current.copy(cameraRef.current.position);
    }
  };

  useFrame(() => {
    if (!perfectDropState.current.active || !cameraRef.current) return;

    const elapsed = (Date.now() - perfectDropState.current.startTime) / 1000;
    const progress = Math.min(elapsed / perfectDropState.current.duration, 1);

    if (progress >= 1) {
      // Effect completed - restore normal state
      perfectDropState.current.active = false;
      onTimeScale(1.0); // Restore normal time
      return;
    }

    // Calculate time scale with slow-motion effect
    // Start at 0.3 (slow) and ramp back to 1.0 (normal)
    const timeScale = 0.3 + 0.7 * progress;
    onTimeScale(timeScale);

    // Camera pop effect - slight forward movement and return
    const popIntensity = Math.sin(progress * Math.PI) * effectIntensity;
    const popDirection = new THREE.Vector3(0, 0, -1); // Move slightly toward tower

    // Apply camera pop
    const targetPosition = originalCameraPosition.current
      .clone()
      .add(popDirection.multiplyScalar(popIntensity));

    cameraRef.current.position.copy(targetPosition);
  });

  return {
    triggerPerfectDrop,
    isActive: perfectDropState.current.active,
  };
};
