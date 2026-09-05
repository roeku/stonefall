import React from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { PlayerRegion, TowerMapEntry } from '../../../shared/types/api';
import {
  REGION_SPAN,
  cellToWorld,
  isCellInRegion,
  worldToCell,
} from '../../../shared/types/worldGrid';
import { DEFAULT_TOWER_GRID_SIZE, MAX_STACK_PER_CELL } from '../../../shared/types/towerPlacement';
import type { GridViewState } from '../../hooks/useGridView';
import { GPUInstancedTowerSystem } from '../game/GPUInstancedTowerSystem';
import { mixGridTintHex } from '../../utils/gridColors';
import { TowerGhost } from '../game/TowerGhost';
import { PlotPlatform } from '../game/PlotPlatform';
import { GridViewControls } from './GridViewControls';
import { ScopeToggle } from './ScopeToggle';
import {
  ArtButton,
  ArtButtonGhost,
  ArtChip,
  ArtPanel,
  BlocksIcon,
  HeightIcon,
} from './tron/TronArt';
import { TronBackground } from '../effects/TronBackground';
import { EffectsRenderer } from '../effects/EffectsRenderer';

const stubGameState = { isGameOver: true } as const;

export interface GridTarget {
  x: number;
  z: number;
}

interface GridSceneProps {
  towers: TowerMapEntry[];
  /** Set when a finished tower is waiting to be placed; enables placement mode. */
  pendingTower: TowerMapEntry | null;
  /** The player's buildable area. Null until they have one. */
  region: PlayerRegion | null;
  isPlacing: boolean;
  target: GridTarget | null;
  onTarget: (cell: GridTarget) => void;
  onPlace: (gridX: number, gridZ: number) => void;
  /** Fired when a tap lands on the floor but outside the player's own area. */
  onTapOutside: () => void;
  /** Tap-driven orbit and zoom. Placement overrides it, since the cell is the subject then. */
  view: GridViewState;
}

/** How many towers already sit in each cell, so the UI can report what a tap would stack onto. */
export const countByCell = (towers: TowerMapEntry[]): Map<string, number> => {
  const map = new Map<string, number>();
  for (const t of towers) {
    if (t.gridX === undefined || t.gridZ === undefined) continue;
    const key = `${t.gridX},${t.gridZ}`;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
};

/**
 * Scene contents for the grid, rendered inside the application's single shared Canvas.
 *
 * This deliberately does NOT own a Canvas. It used to, and so did the game -- switching between
 * them tore down one WebGL context and created another, which the browser answered by losing
 * the context outright and rendering the game black. One Canvas for the whole app, contents
 * swapped inside it.
 *
 * Browsing and placing are the same scene, differing only by whether a tower is in hand. All
 * input is tap: Reddit inline posts permit tap and click only.
 */
export const GridScene: React.FC<GridSceneProps> = ({
  towers,
  pendingTower,
  region,
  isPlacing,
  target,
  onTarget,
  onPlace,
  onTapOutside,
  view,
}) => {
  const isPlacementMode = pendingTower !== null && region !== null;
  const occupied = React.useMemo(() => countByCell(towers), [towers]);
  const targetStack = target ? (occupied.get(`${target.x},${target.z}`) ?? 0) : 0;
  const canPlace = targetStack < MAX_STACK_PER_CELL;
  const focus = React.useMemo(() => framingFor(towers), [towers]);

  /**
   * Floor tint, mixed from the blue/orange balance of what's actually built.
   *
   * The archived community view fed this to the grid and the rebuild hardcoded a blue, which
   * quietly removed the one way the floor said anything about the state of the game.
   */
  const gridTint = React.useMemo(() => {
    let blue = 0;
    let counted = 0;
    for (const t of towers) {
      if (!t.playerColorChoice) continue;
      counted += 1;
      if (t.playerColorChoice === 'blue') blue += 1;
    }
    return counted === 0
      ? DEFAULT_GRID_TINT
      : (mixGridTintHex((blue / counted) * 100) ?? DEFAULT_GRID_TINT);
  }, [towers]);

  // Null while browsing, which lets the camera fall back to framing the whole community.
  const placementFocusX = !isPlacementMode
    ? null
    : target
      ? cellToWorld(target.x)
      : region
        ? cellToWorld(region.centerX)
        : null;
  const placementFocusZ = !isPlacementMode
    ? null
    : target
      ? cellToWorld(target.z)
      : region
        ? cellToWorld(region.centerZ)
        : null;

  const handleTap = (event: { point: THREE.Vector3; stopPropagation: () => void }) => {
    if (!isPlacementMode || isPlacing || !region) return;
    event.stopPropagation();

    const x = worldToCell(event.point.x);
    const z = worldToCell(event.point.z);

    // Taps outside the player's own area can't place anything -- most of the grid belongs to
    // other people. They used to return silently, which was indistinguishable from the game
    // ignoring input; now they say so, and RegionOverlay draws the boundary they crossed.
    if (!isCellInRegion({ rx: 0, rz: 0 }, x - region.centerX, z - region.centerZ)) {
      onTapOutside();
      return;
    }

    // First tap targets, so the ghost shows the result; a second tap on the same cell commits.
    // Tapping elsewhere retargets, which keeps a mis-tap from being destructive.
    if (target && target.x === x && target.z === z) {
      if (canPlace) onPlace(x, z);
      return;
    }
    onTarget({ x, z });
  };

  return (
    <>
      <TronBackground
        gameState={stubGameState}
        gridSize={DEFAULT_TOWER_GRID_SIZE}
        gridOffsetX={0}
        gridOffsetZ={0}
        gridLineWidth={3}
        gridColorHex={gridTint}
      />

      {/* Bloom / post-processing, the same chain the game scene uses. Without it the grid's
          neon reads as flat lines with no glow, which is most of why it looked worse than the
          rest of the game. */}
      <EffectsRenderer />

      {/* Only the player's own boundary is drawn, and only as a line on the floor.
          Everyone else's plot needs no marking: their towers are already standing on the one
          shared grid, and outlining every sector turned the community view into a field of
          trays. */}
      {region && (
        <PlotPlatform
          centerX={region.centerX}
          centerZ={region.centerZ}
          radius={region.radius}
          color={isPlacementMode ? PLACING_COLOR : PLOT_COLOR}
          active={isPlacementMode}
        />
      )}

      {/* One invisible ground plane, raycast and converted to a cell, rather than a hitbox per
          cell. The hit point already carries the coordinates. */}
      {isPlacementMode && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} onClick={handleTap} visible={false}>
          <planeGeometry args={[6000, 6000]} />
        </mesh>
      )}

      <GPUInstancedTowerSystem
        isGameOver={true}
        playerTower={null}
        preAssignedTowers={towers}
        selectedTower={null}
        expectedTotalTowers={towers.length}
        leadingColor={null}
        fallbackBluePercentage={null}
      />

      {isPlacementMode && target && pendingTower && (
        <TowerGhost
          blocks={pendingTower.towerBlocks ?? []}
          worldX={cellToWorld(target.x)}
          worldZ={cellToWorld(target.z)}
          baseY={0}
          canPlace={canPlace}
        />
      )}

      {/* Browsing frames what the community has built; placing tightens onto the player's own
          area, and onto the targeted cell once there is one. Centring on the player's region
          while browsing would be wrong even though it sounds helpful -- the whole point of the
          landing view is to show everyone else's work. */}
      <GridCamera
        focusX={placementFocusX ?? focus.x}
        focusZ={placementFocusZ ?? focus.z}
        extent={REGION_EXTENT}
        placing={isPlacementMode}
        yaw={view.yaw}
        distance={view.distance}
      />
    </>
  );
};

/** Used until any tower has declared a colour; the blue end of the community tint mix. */
const DEFAULT_GRID_TINT = '#24c8ff';

/** Amber, so the player's own plot is never mistaken for the blue floor it sits on. */
const PLOT_COLOR = '#fbbf24';

/** Green while a tower is in hand, matching the ghost, so the two read as one action. */
const PLACING_COLOR = '#4ade80';

/** Half-width of a player's own area, which is all the camera needs to show while placing. */
const REGION_EXTENT = (REGION_SPAN * DEFAULT_TOWER_GRID_SIZE) / 2;

/**
 * Centre and half-width of everything built so far.
 *
 * The camera frames this rather than sitting at a fixed distance. A fixed distance is only ever
 * right for one population: tuned for a full grid it loses the first few towers in the middle of
 * an empty floor, and tuned for a few it crops the rest once the community fills in.
 */
const framingFor = (towers: TowerMapEntry[]): { x: number; z: number; extent: number } => {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (const t of towers) {
    const x = t.worldX;
    const z = t.worldZ;
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
    minX = Math.min(minX, x as number);
    maxX = Math.max(maxX, x as number);
    minZ = Math.min(minZ, z as number);
    maxZ = Math.max(maxZ, z as number);
  }

  // Nothing placed yet: sit over the origin at one region's worth of floor, so an empty grid
  // still looks like a place rather than an untextured void.
  if (minX === Infinity) return { x: 0, z: 0, extent: REGION_EXTENT };

  return {
    x: (minX + maxX) / 2,
    z: (minZ + maxZ) / 2,
    // A margin of one region keeps the outermost towers off the edge of the frame, and the floor
    // means a lone tower is framed as a tower rather than filling the screen.
    extent: Math.max((maxX - minX) / 2, (maxZ - minZ) / 2) + REGION_EXTENT,
  };
};

interface GridChromeProps {
  towers: TowerMapEntry[];
  isLoading: boolean;
  pendingTower: TowerMapEntry | null;
  region: PlayerRegion | null;
  isPlacing: boolean;
  error: string | null;
  target: GridTarget | null;
  /** True briefly after a tap outside the player's area, so the status can explain the miss. */
  outsideHint: boolean;
  /** Camera controls. Absent while a run is in progress, where there is no grid to look around. */
  view?: GridViewState;
  /** Commits the tower to the targeted cell. */
  onConfirmPlacement: () => void;
  onSkipPlacement: () => void;
  onPlay: () => void;
}

/** DOM chrome for the grid, layered above the shared Canvas. */
export const GridChrome: React.FC<GridChromeProps> = ({
  towers,
  isLoading,
  pendingTower,
  region,
  isPlacing,
  error,
  target,
  outsideHint,
  view,
  onConfirmPlacement,
  onSkipPlacement,
  onPlay,
}) => {
  const isPlacementMode = pendingTower !== null && region !== null;
  const occupied = React.useMemo(() => countByCell(towers), [towers]);
  const targetStack = target ? (occupied.get(`${target.x},${target.z}`) ?? 0) : 0;
  const canPlace = targetStack < MAX_STACK_PER_CELL;

  const { totalBlocks, tallest } = React.useMemo(() => {
    let total = 0;
    let max = 0;
    for (const t of towers) {
      const n = t.blockCount ?? t.towerBlocks?.length ?? 0;
      total += n;
      if (n > max) max = n;
    }
    return { totalBlocks: total, tallest: max };
  }, [towers]);

  const status = !isPlacementMode
    ? isLoading
      ? 'Loading the grid'
      : towers.length === 0
        ? 'Nothing built yet'
        : `${towers.length} towers`
    : outsideHint
      ? 'That cell belongs to someone else'
      : !target
        ? 'Tap a cell in your area'
        : !canPlace
          ? `Cell full (${MAX_STACK_PER_CELL} max)`
          : targetStack === 0
            ? 'Tap again to place'
            : `Tap again to stack on ${targetStack}`;

  return (
    <div className="tron-grid-chrome">
      <div className="tron-chrome__top">
        <div className="tron-readout">
          {/* The artwork, used as drawn. Content sits in a safe box measured inside its outline
              rather than the frame resizing around the content -- these shapes are drawn large
              and sparse, so short content fits them. */}
          <ArtPanel
            className={`tron-status${isPlacementMode && (!canPlace || outsideHint) ? ' tron-status--alert' : ''}`}
          >
            <span className="tron-status__title">
              {isPlacementMode ? 'Place your tower' : 'The grid'}
            </span>
            <span className="tron-status__value">{status}</span>
          </ArtPanel>

          {!isPlacementMode && towers.length > 0 && (
            <div className="tron-readout__stats">
              <ArtChip className="tron-chip" title="Blocks stacked">
                <BlocksIcon />
                <span className="tron-chip__value">{totalBlocks.toLocaleString()}</span>
              </ArtChip>
              <ArtChip className="tron-chip" title="Tallest tower, in blocks">
                <HeightIcon />
                <span className="tron-chip__value">{tallest.toLocaleString()}</span>
              </ArtChip>
            </div>
          )}
        </div>

        {/* The pivot's two views. Placement hides it: you are aiming at your own plot then, and
          switching to the community mid-aim would move the thing being aimed at.

          Laid out in the same row as the status panel rather than absolutely positioned. Both
          were absolute and centred independently, which is fine at desktop width and collides on
          a phone -- the toggle sat on top of the status text and clipped it. A phone is the
          target, so the top of the screen has to be one layout that can wrap. */}
        {!isPlacementMode && view && <ScopeToggle scope={view.scope} onChange={view.setScope} />}
      </div>

      {/* Camera controls sit apart from the status and stay quiet until touched: inline posts
          give us no gestures, so these are the only way to look around, but they are a tool and
          not the subject of the screen. Hidden while placing, where the camera is doing a
          specific job and letting it be moved would only make aiming harder. */}
      {!isPlacementMode && view && (
        <GridViewControls
          canZoomIn={view.canZoomIn}
          canZoomOut={view.canZoomOut}
          onZoomIn={view.zoomIn}
          onZoomOut={view.zoomOut}
          onRotateLeft={view.rotateLeft}
          onRotateRight={view.rotateRight}
        />
      )}

      <div className="tron-grid-actions">
        {error && (
          <div role="alert" className="tron-grid-error">
            {error}
          </div>
        )}

        {isPlacementMode ? (
          <>
            {/* Confirm is the primary action and it leads.

                Placement used to offer exactly one button -- "Place later" -- so the most
                prominent control on the screen was the way out of the task, and committing was an
                undocumented second tap on the same cell. The action you came here to perform has
                to be the one that looks like the action. */}
            <button
              type="button"
              className="tron-action"
              onClick={onConfirmPlacement}
              disabled={!target || !canPlace || isPlacing}
            >
              <ArtButton>
                <span className="tron-action__label">
                  {isPlacing
                    ? 'Placing\u2026'
                    : !target
                      ? 'Pick a cell'
                      : targetStack > 0
                        ? `Stack on ${targetStack}`
                        : 'Place here'}
                </span>
              </ArtButton>
            </button>
            <button
              type="button"
              className="tron-action tron-action--ghost"
              onClick={onSkipPlacement}
              disabled={isPlacing}
            >
              <ArtButtonGhost>
                <span className="tron-action__label">Place later</span>
              </ArtButtonGhost>
            </button>
          </>
        ) : (
          <button type="button" className="tron-action" onClick={onPlay}>
            <ArtButton>
              <span className="tron-action__label">Build a tower</span>
            </ArtButton>
          </button>
        )}
      </div>
    </div>
  );
};

/**
 * Camera height as a fraction of distance, which is really a choice about the horizon.
 *
 * The frame's top edge sits half the vertical fov above the view direction, so the horizon is
 * only visible when the downward tilt is less than that -- at fov 30 that means a ratio under
 * tan(15 degrees) = 0.27. An earlier 0.74 put the camera well above that limit and pointed it at
 * the floor, which is why the grid read as a survey of an empty plane: the horizon, and with it
 * any sense of distance, sat above the top of the screen the whole time.
 */
const BROWSE_HEIGHT_RATIO = 0.24;

/**
 * Where the browsing camera aims, as a fraction of its distance above the ground.
 *
 * Proportional rather than fixed because the subject changes with zoom. Up close the subject is
 * the plots; pulled back it is a skyline of towers hundreds of units tall, and an aim point
 * pinned near the floor would leave all of that above the frame.
 */
const BROWSE_LOOK_RATIO = 0.16;

/** Placing needs to read cells, so it looks down at the floor rather than out at the skyline. */
const PLACE_HEIGHT_RATIO = 0.8;

const GridCamera: React.FC<{
  focusX: number;
  focusZ: number;
  extent: number;
  placing: boolean;
  yaw: number;
  distance: number;
}> = ({ focusX, focusZ, extent, placing, yaw, distance: browseDistance }) => {
  const { camera, size } = useThree();
  const pos = React.useRef(new THREE.Vector3(70, 55, 70));
  const look = React.useRef(new THREE.Vector3(0, 0, 0));

  useFrame((_, delta) => {
    const cam = camera as THREE.PerspectiveCamera;

    // Guard against an unmeasured canvas. A size of zero drives the horizontal half-angle to
    // zero, the division below to Infinity and the lerp to NaN -- and a NaN position never
    // recovers, because every later lerp of a NaN is also NaN. One bad frame would black the
    // scene out for the rest of the session, so skip the frame rather than guess a size.
    if (size.width < 1 || size.height < 1) return;

    let distance: number;
    if (placing) {
      // Pull back far enough that the region fits both ways. Vertical is fov directly;
      // horizontal is the same angle widened by aspect, so on a portrait screen -- which is most
      // of Reddit -- width is the binding constraint, and this is what keeps the player's area
      // from spilling off the sides.
      const halfV = THREE.MathUtils.degToRad(cam.fov) / 2;
      const halfH = Math.atan(Math.tan(halfV) * (size.width / size.height));
      const fit = extent / Math.tan(Math.min(halfV, halfH));
      if (!Number.isFinite(fit)) return;
      // Looking down the diagonal means the axis-aligned extent is seen across its diagonal.
      distance = fit * Math.SQRT1_2;
    } else {
      distance = browseDistance;
    }

    const height = distance * (placing ? PLACE_HEIGHT_RATIO : BROWSE_HEIGHT_RATIO);

    // Aim above the floor when browsing so the frame holds sky and skyline rather than a wedge
    // of empty foreground; aim at the floor when placing, because the floor is the subject.
    const lookY = placing ? 4 : distance * BROWSE_LOOK_RATIO;

    // Orbit around the focus. Placing keeps the fixed diagonal: the player is reading a grid of
    // cells and a rotated grid is materially harder to aim at than an axis-aligned one.
    const angle = placing ? Math.PI / 4 : yaw;
    const targetPos = new THREE.Vector3(
      focusX + Math.sin(angle) * distance,
      height,
      focusZ + Math.cos(angle) * distance
    );
    const targetLook = new THREE.Vector3(focusX, lookY, focusZ);

    const t = 1 - Math.pow(0.0001, delta);
    pos.current.lerp(targetPos, t);
    look.current.lerp(targetLook, t);

    camera.position.copy(pos.current);
    camera.lookAt(look.current);
  });

  return null;
};
