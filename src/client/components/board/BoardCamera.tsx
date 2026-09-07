import React, { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { PITCH, baseDistance, lookHeight, type BoardMode } from './boardFraming';

interface BoardCameraProps {
  mode: BoardMode;
  focusX: number;
  focusZ: number;
  /** Half-width of the subject on the floor, for plot and city framing. */
  extent: number;
  /** The selected tower, for tower framing. */
  tower?: { baseY: number; height: number } | null | undefined;
  /** Overrides the mode's aim height, e.g. the top of the stack a tower is about to land on. */
  focusY?: number | undefined;
  /** Tallest standing tower in the subject area, so placement can look down on it, not into it. */
  skyline?: number | undefined;
  yaw: number;
  zoom: number;
}

/** Slow orbit while browsing, so the board is never a still image. One turn takes ~3 minutes. */
const DRIFT_SPEED = 0.035;

/** Exponential approach rate. Higher is snappier; this reaches 95% of a move in ~0.9s. */
const EASE = 3.4;

const BACKGROUND = '#000814';

/** Vertical field of view the board is framed for, degrees. */
const BOARD_FOV = 30;

const setLens = (cam: THREE.PerspectiveCamera, fov: number, near: number): void => {
  if (cam.fov === fov && cam.near === near) return;
  cam.fov = fov;
  cam.near = near;
  cam.updateProjectionMatrix();
};

/**
 * The board's camera rig.
 *
 * Every mode is the same rig with different numbers: a focus point, a standoff, a pitch and a
 * yaw. Changing mode changes the numbers and the rig eases between them, which is what turns a
 * scope switch into a flight from your plot out over the city instead of a cut.
 *
 * Fog is owned here too, because its range only means anything relative to the standoff.
 */
export const BoardCamera: React.FC<BoardCameraProps> = ({
  mode,
  focusX,
  focusZ,
  extent,
  tower,
  focusY,
  skyline,
  yaw,
  zoom,
}) => {
  const { camera, size } = useThree();
  const pos = useRef<THREE.Vector3 | null>(null);
  const look = useRef(new THREE.Vector3());
  const drift = useRef(0);
  const fog = useRef<THREE.Fog>(null);

  useFrame((_, delta) => {
    const cam = camera as THREE.PerspectiveCamera;
    // A zero-size canvas drives the fit to Infinity and the ease to NaN, and a NaN camera never
    // recovers. Skip the frame rather than guess.
    if (size.width < 1 || size.height < 1) return;

    // The run installs a camera object of its own, but it now declares this same lens, so this
    // is a no-op in practice. Kept as the one place that asserts the app has a single lens.
    setLens(cam, BOARD_FOV, 1);

    const dt = Math.min(delta, 0.1);
    const towerFrame = tower ?? undefined;
    const distance =
      baseDistance(mode, {
        aspect: size.width / size.height,
        fovDeg: cam.fov,
        extent,
        ...(skyline !== undefined ? { skyline } : {}),
        ...(towerFrame ? { towerHeight: towerFrame.height } : {}),
      }) * zoom;
    if (!Number.isFinite(distance)) return;

    // Placement holds the grid's diagonal still: a rotating grid is materially harder to aim at.
    if (mode !== 'placing') drift.current += dt * DRIFT_SPEED;
    const angle = mode === 'placing' ? Math.PI / 4 : yaw + drift.current;
    const pitch = PITCH[mode];
    const lookY = focusY ?? lookHeight(mode, distance, towerFrame);

    const targetLook = new THREE.Vector3(focusX, lookY, focusZ);
    const targetPos = new THREE.Vector3(
      focusX + Math.sin(angle) * Math.cos(pitch) * distance,
      lookY + Math.sin(pitch) * distance,
      focusZ + Math.cos(angle) * Math.cos(pitch) * distance
    );

    if (!pos.current) {
      /**
       * First frame: continue from wherever the camera actually is.
       *
       * This used to start from a point high above the target and drop in, which meant every
       * arrival on the board was a cut no matter where the previous scene had been looking --
       * and the run leaves the camera on the very plot the board is about to frame. Inheriting
       * the pose turns the end of a run into a pull-back rather than a jump, which is why the
       * black veil over this transition could go.
       */
      pos.current = cam.position.clone();
      const dir = new THREE.Vector3();
      cam.getWorldDirection(dir);
      look.current =
        dir.lengthSq() > 0
          ? cam.position.clone().addScaledVector(dir, Math.max(1, distance))
          : targetLook.clone();
    }

    const t = 1 - Math.exp(-EASE * dt);
    pos.current.lerp(targetPos, t);
    look.current.lerp(targetLook, t);

    cam.position.copy(pos.current);
    cam.lookAt(look.current);

    if (fog.current) {
      fog.current.near = distance * 0.9;
      fog.current.far = distance * 3.4;
    }
  });

  return <fog ref={fog} attach="fog" args={[BACKGROUND, 100, 600]} />;
};
