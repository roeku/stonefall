import React, { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { PITCH, baseDistance, lookHeight, type BoardMode } from './boardFraming';

/** A jolt, e.g. a tower coming down near the subject. */
export interface Quake {
  /** performance.now() when it hit. */
  at: number;
  /** 1 is a tower felled beside the subject; smaller for news from further away. */
  strength: number;
}

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
  /**
   * Whether the subject is known yet. Until the player and the board have loaded, the focus is a
   * guess -- the middle of the world -- and a camera that eased toward the guess would then fly
   * across the map to the real subject. So the rig holds still until it knows where to look.
   */
  ready: boolean;
  /**
   * Nothing came before this: the post has just opened. The camera descends onto the subject
   * rather than inheriting a pose, because the only pose there is to inherit is the canvas's
   * default, which looks at the world origin.
   */
  entrance: boolean;
  quake?: Quake | null | undefined;
}

/** Slow orbit while browsing, so the board is never a still image. One turn takes ~3 minutes. */
const DRIFT_SPEED = 0.035;

/** Exponential approach rate. Higher is snappier; this reaches 95% of a move in ~0.9s. */
const EASE = 3.4;
/** The opening descent is slower, so it reads as arriving rather than as a cut. */
const ENTRANCE_EASE = 1.9;
const ENTRANCE_SECONDS = 1.6;

const BACKGROUND = '#000814';

/** Vertical field of view the board is framed for, degrees. */
const BOARD_FOV = 30;

const QUAKE_MS = 520;

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
  ready,
  entrance,
  quake,
}) => {
  const { camera, size } = useThree();
  const pos = useRef<THREE.Vector3 | null>(null);
  const look = useRef(new THREE.Vector3());
  const drift = useRef(0);
  const arriving = useRef(0);
  const shake = useRef(new THREE.Vector3());
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
      if (!ready) return;
      if (entrance) {
        // The post just opened: come down onto the subject from above it, so the first thing
        // the player sees is their own ground arriving, not a pan from the origin.
        pos.current = targetPos
          .clone()
          .add(new THREE.Vector3(0, distance * 1.1, 0))
          .addScaledVector(targetPos.clone().sub(targetLook).setY(0).normalize(), distance * 0.35);
        look.current = targetLook.clone();
        arriving.current = ENTRANCE_SECONDS;
      } else {
        /**
         * Continue from wherever the camera actually is.
         *
         * The run leaves the camera on the very plot the board is about to frame, so inheriting
         * the pose turns the end of a run into a pull-back rather than a jump.
         */
        pos.current = cam.position.clone();
        const dir = new THREE.Vector3();
        cam.getWorldDirection(dir);
        look.current =
          dir.lengthSq() > 0
            ? cam.position.clone().addScaledVector(dir, Math.max(1, distance))
            : targetLook.clone();
      }
    }

    const rate = arriving.current > 0 ? ENTRANCE_EASE : EASE;
    arriving.current = Math.max(0, arriving.current - dt);
    const t = 1 - Math.exp(-rate * dt);
    pos.current.lerp(targetPos, t);
    look.current.lerp(targetLook, t);

    // A felled tower shakes the ground: a short, decaying, non-repeating wobble, scaled by the
    // standoff so it reads the same from a plot and from the whole map.
    shake.current.set(0, 0, 0);
    if (quake) {
      const q = (performance.now() - quake.at) / QUAKE_MS;
      if (q >= 0 && q < 1) {
        const amp = quake.strength * (1 - q) * (1 - q) * distance * 0.006;
        const phase = q * 46;
        shake.current.set(
          Math.sin(phase * 1.7 + 0.3) * amp,
          Math.cos(phase * 1.3 + 1.1) * amp * 0.7,
          Math.sin(phase * 1.9 + 2.4) * amp
        );
      }
    }

    cam.position.copy(pos.current).add(shake.current);
    cam.lookAt(look.current);

    if (fog.current) {
      fog.current.near = distance * 0.9;
      fog.current.far = distance * 3.4;
    }
  });

  return <fog ref={fog} attach="fog" args={[BACKGROUND, 100, 600]} />;
};
