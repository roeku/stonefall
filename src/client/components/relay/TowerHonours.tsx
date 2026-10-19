import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { FixedMath } from '../../../shared/simulation';
import type { Block } from '../../../shared/simulation/types';
import { Avatar } from './Avatar';

/**
 * Who built the tower, marked on it: the best turns (shared/relay/rules.ts `noteBestTurn`), each a
 * bracket beside the stretch of blocks it laid, and the builder's face with how many blocks the
 * turn stacked and its longest run of perfects. The best turn is gold; the viewer's own best is
 * marked whatever its rank.
 *
 * Laid out as a list, not scattered: the faces stand in one column to the tower's left, each at
 * the height of its stretch, with a hairline running in to its bracket. The right of the tower is
 * the crew's. A mark gives way to everything else on screen, since the tower can be read without
 * it and the chrome cannot: a face slides along its stretch to find room, and steps back when
 * there is none, behind a better turn's face, the readout, a banner, or the buttons at the foot.
 *
 * Drawn inside the tower's group, so the brackets squash with it when the whole tower is shown.
 * The camera turns round the tower while it waits, so every frame the brackets are moved to the
 * side of the stretch that is the screen's left, clear of its widest block.
 */

export interface Honour {
  userId: string;
  name: string;
  avatar: string | null;
  from: number;
  to: number;
  laid: number;
  streak: number;
  /** 1 is the tower's best turn. */
  rank: number;
  mine: boolean;
}

/** Every number the marks are tuned by. World units unless said. */
const HONOURS = {
  /** How far off the stretch's widest block the bracket stands. */
  GAP: 0.8,
  /** The bracket's thickness. */
  BAR: 0.22,
  /** Screen pixels a face needs to itself, up and down. */
  ROOM_PX: 40,
  /** The face column: never nearer the edge than this, nor further from the tower than this. */
  EDGE_PX: 14,
  LEAD_MAX_PX: 132,
  /** Narrower than this and a mark does not fit beside the tower: it steps back. */
  FIT_PX: 96,
  /** Perfects in a row worth saying. */
  STREAK_FROM: 3,
};

/**
 * The chrome a mark gives way to. The foot of the readout or a banner, and the top of what stands
 * at the foot of the screen, are also the limits a face slides between.
 */
const CHROME = [
  '.relay-top__readout',
  '.relay-top__side',
  '.relay-banner',
  '.relay-bottom > *',
  '.relay-notice',
  '.hud-callout',
  '.lobby',
];

const GOLD = '#ffd166';
const INK = '#f3f7fa';

/** What the column needs from each mark every frame, and what a mark needs from the column. */
interface Shared {
  /** Where each mark's face would sit, in canvas pixels: at its bracket, at the slid height. */
  anchors: Map<string, { x: number; y: number }>;
  labels: Map<string, HTMLDivElement>;
  /** The band a face may slide in, canvas pixels from the top. */
  band: { top: number; bottom: number };
}

/** A stretch's blocks as the frame loop reads them: centres and half extents, world units. */
const stretchOf = (blocks: readonly Block[], from: number, to: number) =>
  blocks.slice(from, Math.min(to, blocks.length)).map((b) => ({
    x: FixedMath.toFloat(b.x),
    z: FixedMath.toFloat(b.z ?? 0),
    hw: FixedMath.toFloat(b.width) / 2,
    hd: FixedMath.toFloat(b.depth ?? b.width) / 2,
  }));

const OneHonour: React.FC<{
  h: Honour;
  blocks: readonly Block[];
  faction: string;
  shared: React.MutableRefObject<Shared>;
}> = ({ h, blocks, faction, shared }) => {
  const bracket = useRef<THREE.Mesh>(null);
  const face = useRef<THREE.Group>(null);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const left = useMemo(() => new THREE.Vector3(), []);
  const probe = useMemo(() => new THREE.Vector3(), []);
  const stretch = useMemo(() => stretchOf(blocks, h.from, h.to), [blocks, h.from, h.to]);

  const first = blocks[h.from];
  const last = blocks[Math.min(h.to, blocks.length) - 1];
  const bottom = first ? FixedMath.toFloat(first.y - first.height / 2) : 0;
  const top = last ? FixedMath.toFloat(last.y + last.height / 2) : 0;
  const span = Math.max(0.4, top - bottom);
  const mid = (bottom + top) / 2;

  const box = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: h.rank === 1 ? GOLD : INK,
        transparent: true,
        opacity: h.rank === 1 ? 1 : 0.7,
        toneMapped: false,
      }),
    [h.rank]
  );
  useEffect(
    () => () => {
      box.dispose();
      material.dispose();
    },
    [box, material]
  );

  useFrame(() => {
    const b = bracket.current;
    const f = face.current;
    if (!b || !f) return;
    // The screen's left, flat on the floor, whichever way the camera has turned.
    left.setFromMatrixColumn(camera.matrixWorld, 0).negate().setY(0);
    if (left.lengthSq() < 1e-6) left.set(-1, 0, 0);
    left.normalize();
    // Clear of the stretch's widest reach that way: a leaning tower's blocks are not all centred.
    let reach = 0;
    for (const s of stretch) {
      const r = s.x * left.x + s.z * left.z + s.hw * Math.abs(left.x) + s.hd * Math.abs(left.z);
      if (r > reach) reach = r;
    }
    const off = reach + HONOURS.GAP;
    b.position.set(left.x * off, mid, left.z * off);

    // The face rides its bracket: at its middle, or as near it as the band allows.
    b.updateMatrixWorld();
    const screenAt = (y: number) => {
      probe.set(0, y, 0);
      b.localToWorld(probe).project(camera);
      return {
        x: (probe.x * 0.5 + 0.5) * size.width,
        y: (-probe.y * 0.5 + 0.5) * size.height,
        behind: probe.z > 1,
      };
    };
    const hi = screenAt(0.5);
    const lo = screenAt(-0.5);
    const band = shared.current.band;
    let at = (hi.y + lo.y) / 2;
    if (lo.y - hi.y > 1) {
      at = Math.min(
        Math.max(at, band.top + HONOURS.ROOM_PX / 2),
        band.bottom - HONOURS.ROOM_PX / 2
      );
      at = Math.min(Math.max(at, hi.y), lo.y);
    }
    const k = lo.y - hi.y > 1 ? (lo.y - at) / (lo.y - hi.y) : 0.5;
    f.position.set(b.position.x, mid + (k - 0.5) * span, b.position.z);
    if (hi.behind) shared.current.anchors.delete(h.userId);
    else shared.current.anchors.set(h.userId, { x: (hi.x + lo.x) / 2, y: at });
  });

  if (!first || !last) return null;
  return (
    <>
      <mesh
        ref={bracket}
        geometry={box}
        material={material}
        scale={[HONOURS.BAR, span, HONOURS.BAR]}
        raycast={() => null}
      />
      <group ref={face}>
        <Html zIndexRange={[4, 0]} style={{ pointerEvents: 'none' }}>
          <div
            ref={(el) => {
              if (el) shared.current.labels.set(h.userId, el);
              else shared.current.labels.delete(h.userId);
            }}
            className={`honour${h.rank === 1 ? ' honour--first' : ''}${h.mine ? ' honour--mine' : ''}`}
            style={{ ['--rim-rgb' as string]: faction, opacity: 0 }}
          >
            <Avatar className="honour__face" src={h.avatar} name={h.name} />
            <span className="honour__words">
              <span className="honour__laid">
                +{h.laid}
                {h.streak >= HONOURS.STREAK_FROM && (
                  <span className="honour__streak">{h.streak}×</span>
                )}
              </span>
              <span className="honour__name">{h.mine ? 'you' : h.name}</span>
            </span>
            <span className="honour__lead" aria-hidden="true" />
          </div>
        </Html>
      </group>
    </>
  );
};

interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Whether two rectangles overlap. */
const overlaps = (a: Rect, b: Rect): boolean =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

export const TowerHonours: React.FC<{
  honours: readonly Honour[];
  blocks: readonly Block[];
  /** The tower's colour as "r, g, b", for the rings round the faces. */
  faction: string;
}> = ({ honours, blocks, faction }) => {
  const size = useThree((s) => s.size);
  const gl = useThree((s) => s.gl);
  const shared = useRef<Shared>({
    anchors: new Map(),
    labels: new Map(),
    band: { top: 0, bottom: Number.POSITIVE_INFINITY },
  });
  const ranked = useMemo(() => [...honours].sort((a, b) => a.rank - b.rank), [honours]);

  // The column: where the faces stand, what they give way to, and which have room.
  useFrame(() => {
    const { anchors, labels, band } = shared.current;
    // The chrome, in the canvas's own pixels, which is what the marks are placed in.
    const canvas = gl.domElement.getBoundingClientRect();
    const local = (r: DOMRect): Rect => ({
      left: r.left - canvas.left,
      right: r.right - canvas.left,
      top: r.top - canvas.top,
      bottom: r.bottom - canvas.top,
    });
    const chrome = Array.from(document.querySelectorAll(CHROME.join(',')))
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0)
      .map(local);
    const readout = document.querySelector('.relay-top__readout');
    const foot = Array.from(document.querySelectorAll('.relay-bottom > *'))
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.height > 0);
    // Below the readout, and below a banner when one is up, so a face whose stretch runs past the
    // banner slides down clear of it instead of stepping back.
    const banner = document.querySelector('.relay-banner');
    band.top =
      Math.max(
        readout ? local(readout.getBoundingClientRect()).bottom : 0,
        banner ? local(banner.getBoundingClientRect()).bottom : 0
      ) + 6;
    band.bottom = foot.length > 0 ? Math.min(...foot.map((r) => local(r).top)) - 6 : size.height;

    let nearest = Number.POSITIVE_INFINITY;
    for (const h of ranked) nearest = Math.min(nearest, anchors.get(h.userId)?.x ?? nearest);
    const column = Math.max(HONOURS.EDGE_PX, nearest - HONOURS.LEAD_MAX_PX);

    const taken: number[] = [];
    for (const h of ranked) {
      const el = labels.get(h.userId);
      if (!el) continue;
      const a = anchors.get(h.userId);
      let show = false;
      if (a) {
        const box: Rect = {
          left: column,
          right: a.x,
          top: a.y - HONOURS.ROOM_PX / 2,
          bottom: a.y + HONOURS.ROOM_PX / 2,
        };
        show =
          a.x - column >= HONOURS.FIT_PX &&
          box.bottom > 0 &&
          box.top < size.height &&
          !chrome.some((c) => overlaps(box, c)) &&
          // The viewer's own shows wherever the chrome lets it: it is theirs to find.
          (h.mine || taken.every((t) => Math.abs(t - a.y) >= HONOURS.ROOM_PX));
        if (show) {
          el.style.width = `${Math.round(a.x - column)}px`;
          taken.push(a.y);
        }
      }
      el.style.opacity = show ? '1' : '0';
    }
  });

  return (
    <group name="tower-honours">
      {ranked.map((h) => (
        <OneHonour key={h.userId} h={h} blocks={blocks} faction={faction} shared={shared} />
      ))}
    </group>
  );
};
