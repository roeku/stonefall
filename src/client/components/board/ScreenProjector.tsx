import React, { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

/** World position to the canvas's CSS pixels, from its top left. Null while there is no camera. */
export type Project = (x: number, y: number, z: number) => { x: number; y: number } | null;

/**
 * Lends the chrome the scene's camera: where a point in the world is on screen right now, so
 * something in the DOM (XP flying to the level) can start from a tower's top. Renders nothing.
 */
export const ScreenProjector: React.FC<{ onProject: (project: Project | null) => void }> = ({
  onProject,
}) => {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  useEffect(() => {
    const v = new THREE.Vector3();
    onProject((x, y, z) => {
      v.set(x, y, z).project(camera);
      if (v.z > 1) return null;
      return { x: (v.x * 0.5 + 0.5) * size.width, y: (-v.y * 0.5 + 0.5) * size.height };
    });
    return () => onProject(null);
  }, [camera, size, onProject]);
  return null;
};
