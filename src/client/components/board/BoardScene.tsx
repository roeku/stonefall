import React from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { PlayerRegion, TowerMapEntry } from '../../../shared/types/api';
import type { FactionId } from '../../../shared/types/factions';
import { factionHex } from '../../../shared/types/factions';
import {
  KEEP_RADIUS,
  cellKind,
  chebyshev,
  type Holdings,
  type PlacementVerdict,
} from '../../../shared/types/territory';
import { cellToWorld, worldToCell } from '../../../shared/types/worldGrid';
import type { GridViewState } from '../../hooks/useGridView';
import { EffectsRenderer } from '../effects/EffectsRenderer';
import { PlotPlatform } from '../game/PlotPlatform';
import { TowerGhost } from '../game/TowerGhost';
import { BoardCamera, type Quake } from './BoardCamera';
import { BoardFloor, GROUND_Y } from './BoardFloor';
import { BoardTowers } from './BoardTowers';
import { CellMarker } from './CellMarker';
import { PlotBeacon } from './PlotBeacon';
import { SelectionHalo } from './SelectionHalo';
import { TerritoryTiles } from './TerritoryTiles';
import { CrumblingTowers, type Crumble } from './CrumblingTowers';
import { LandingRings, type LandingRing } from '../game/LandingRings';
import { countByCell, openingCellFor, stackTopAt } from './boardCells';
import {
  PLOT_HALF,
  baseDistance,
  mapFrame,
  mapFrameAround,
  plotCenter,
  type BoardMode,
  placingLookHeight,
} from './boardFraming';
import { towerBox } from './boardInstancing';
import { compressHeight } from './rimMaterial';
import { planTiles } from './tilePlan';

export interface GridTarget {
  x: number;
  z: number;
}

export interface Viewer {
  userId: string | null;
  faction: FactionId;
  region: PlayerRegion | null;
}

export interface BoardSceneProps {
  /** Towers in the current scope, already positioned by the server. */
  towers: TowerMapEntry[];
  /** Who holds what, across the whole board. */
  holdings: Holdings;
  viewer: Viewer;
  /** Set when a finished tower is waiting to be raised; enables placement mode. */
  pendingTower: TowerMapEntry | null;
  isPlacing: boolean;
  target: GridTarget | null;
  onTarget: (cell: GridTarget) => void;
  onPlace: (gridX: number, gridZ: number) => void;
  /** Transient feedback for a tap that could not do what it was aimed at. */
  onHint: (message: string) => void;
  /** The rules, judged against what the board currently shows. */
  judge: (x: number, z: number, score: number) => PlacementVerdict;
  selected: TowerMapEntry | null;
  onSelect: (tower: TowerMapEntry | null) => void;
  /** A cell tapped while browsing: empty land to claim, or somebody's hold to size up. */
  selectedCell: GridTarget | null;
  onSelectCell: (cell: GridTarget | null) => void;
  view: GridViewState;
  /** Towers coming down. */
  crumbles: readonly Crumble[];
  /** The last jolt the camera should feel. */
  quake: Quake | null;
  /** Shockwaves where towers were just raised, in world space. */
  rings: readonly LandingRing[];
  /** Whether the player and the board have loaded, so the camera knows its subject. */
  ready: boolean;
  /** The post has just opened; the camera descends onto the subject instead of inheriting. */
  entrance: boolean;
  /** False on a closed day's map: looked at, not built on. */
  live: boolean;
}

/** The floor's own colour. Neutral: the tiles carry the factions now. */
const FLOOR_TINT = '#2a86a8';
/** Green while a tower is in hand, matching the ghost, so the two read as one action. */
const PLACING_COLOR = '#4ade80';
const BLOCKED_COLOR = '#f87171';
/** How hard standing towers are squashed while a cell is being chosen. Full map, like the city. */
const PLACING_COMPRESS = 1;
const SELECT_COLOR = '#e2f6ff';

/**
 * Scene contents for the board, rendered inside the application's single shared Canvas.
 *
 * Browsing, looking at one tower or one cell, and raising a tower are the same scene; they
 * differ by what the camera treats as its subject and whether a tower is in hand. All input is
 * tap: Reddit inline posts permit tap and click only.
 */
export const BoardScene: React.FC<BoardSceneProps> = ({
  towers,
  holdings,
  viewer,
  pendingTower,
  isPlacing,
  target,
  onTarget,
  onPlace,
  onHint,
  judge,
  selected,
  onSelect,
  selectedCell,
  onSelectCell,
  view,
  crumbles,
  quake,
  rings,
  ready,
  entrance,
  live,
}) => {
  const { size } = useThree();
  const region = viewer.region;
  const isPlacementMode = pendingTower !== null;
  const mode: BoardMode = isPlacementMode
    ? 'placing'
    : selected
      ? 'tower'
      : selectedCell
        ? 'cell'
        : view.scope;

  const occupied = React.useMemo(() => countByCell(towers), [towers]);
  const ghostBaseY = React.useMemo(
    () => (target ? stackTopAt(towers, target.x, target.z) : 0),
    [towers, target]
  );
  /**
   * Where the ghost is drawn and the camera aims, in the squashed heights placement draws.
   *
   * The stack top used to be taken at true scale while the towers were drawn compressed, so a
   * ghost aimed at a tall stack floated hundreds of units above the drawn top and the camera
   * flew up through the stack to look at it. Same curve as the towers, so the ghost sits on
   * what is on screen and the rig looks down on it from outside.
   */
  const ghostDrawY = React.useMemo(
    () => compressHeight(ghostBaseY, PLACING_COMPRESS),
    [ghostBaseY]
  );
  const verdict = React.useMemo(
    () => (target && pendingTower ? judge(target.x, target.z, pendingTower.score) : null),
    [target, pendingTower, judge]
  );
  const canPlace = verdict?.ok === true;

  /**
   * Where placement starts aiming: the keep's centre, then outward to the first cell with room.
   * The tower appears where the run was just built, so it is in frame from the first frame.
   */
  const openingCell = React.useMemo<GridTarget | null>(
    () =>
      region
        ? openingCellFor(
            { centerX: region.centerX, centerZ: region.centerZ, radius: KEEP_RADIUS },
            occupied,
            8
          )
        : null,
    [region, occupied]
  );

  React.useEffect(() => {
    if (!isPlacementMode || target || !openingCell) return;
    onTarget(openingCell);
  }, [isPlacementMode, target, openingCell, onTarget]);

  const aim = target ?? openingCell;

  /**
   * The tallest thing standing near where the player is about to raise, at the height it will be
   * drawn, so the camera rig knows how far up it has to be to look down on the cell.
   */
  const skyline = React.useMemo(() => {
    if (!isPlacementMode || !aim) return 0;
    let tallest = 0;
    for (const t of towers) {
      if (t.gridX === undefined || t.gridZ === undefined) continue;
      if (chebyshev(t.gridX, t.gridZ, aim.x, aim.z) > 4) continue;
      const box = towerBox(t.towerBlocks, t.height);
      const top = (t.stackBaseY ?? 0) / 1000 + (box ? box.maxY : 0);
      if (top > tallest) tallest = top;
    }
    return compressHeight(tallest, PLACING_COMPRESS);
  }, [towers, aim, isPlacementMode]);

  const plot = React.useMemo(() => (region ? plotCenter(region) : null), [region]);
  // The map is framed on the viewer's own plot when they have one, and on everything built when
  // they do not: centring on the middle of the map put the camera over somebody else's ground.
  const map = React.useMemo(
    () => (plot ? mapFrameAround(towers, plot) : mapFrame(towers)),
    [towers, plot]
  );

  const selectedFrame = React.useMemo(() => {
    if (!selected) return null;
    const box = towerBox(selected.towerBlocks, selected.height);
    const baseY = (selected.stackBaseY ?? 0) / 1000;
    return {
      x: (selected.worldX ?? 0) + (box ? (box.minX + box.maxX) / 2 : 0),
      z: (selected.worldZ ?? 0) + (box ? (box.minZ + box.maxZ) / 2 : 0),
      baseY,
      height: box ? box.maxY - box.minY : 1.5,
    };
  }, [selected]);

  const tiles = React.useMemo(
    () =>
      planTiles(
        holdings,
        viewer.userId
          ? { faction: viewer.faction, region: region ? { rx: region.rx, rz: region.rz } : null }
          : null
      ),
    [holdings, viewer.userId, viewer.faction, region]
  );

  // What the camera is centred on.
  const focus = (() => {
    if (isPlacementMode && aim) return { x: cellToWorld(aim.x), z: cellToWorld(aim.z) };
    if (isPlacementMode && plot) return plot;
    if (mode === 'tower' && selectedFrame) return { x: selectedFrame.x, z: selectedFrame.z };
    if (mode === 'cell' && selectedCell) {
      return { x: cellToWorld(selectedCell.x), z: cellToWorld(selectedCell.z) };
    }
    if (mode === 'mine' && plot) return plot;
    return { x: map.x, z: map.z };
  })();
  const extent = mode === 'all' ? map.extent : PLOT_HALF;

  const fadeDistance =
    baseDistance(mode, {
      aspect: size.height > 0 ? size.width / size.height : 1,
      fovDeg: 30,
      extent,
      skyline,
      ...(selectedFrame ? { towerHeight: selectedFrame.height } : {}),
    }) *
    view.zoom *
    1.7;

  const aimAt = (x: number, z: number) => {
    if (cellKind(x, z) === 'road') {
      onHint('That is a road.');
      return;
    }
    // First tap targets, so the ghost shows the result; a second tap on the same cell commits.
    // Tapping elsewhere retargets, which keeps a mis-tap from being destructive.
    if (target && target.x === x && target.z === z) {
      if (canPlace) onPlace(x, z);
      else if (verdict && !verdict.ok) onHint(verdict.reason);
      return;
    }
    onTarget({ x, z });
  };

  const handleFloorTap = (event: { point: THREE.Vector3; stopPropagation: () => void }) => {
    event.stopPropagation();
    const x = worldToCell(event.point.x);
    const z = worldToCell(event.point.z);
    if (isPlacementMode) {
      if (isPlacing) return;
      aimAt(x, z);
      return;
    }
    if (selected) {
      onSelect(null);
      return;
    }
    if (cellKind(x, z) === 'road') {
      if (selectedCell) onSelectCell(null);
      return;
    }
    if (selectedCell && selectedCell.x === x && selectedCell.z === z) {
      onSelectCell(null);
      return;
    }
    onSelectCell({ x, z });
  };

  const handleTowerTap = (tower: TowerMapEntry) => {
    if (isPlacementMode) {
      // Tapping a tower while placing aims at its cell: "stack on that", or "take that".
      if (isPlacing || tower.gridX === undefined || tower.gridZ === undefined) return;
      aimAt(tower.gridX, tower.gridZ);
      return;
    }
    onSelectCell(null);
    onSelect(selected?.sessionId === tower.sessionId ? null : tower);
  };

  const myHex = factionHex(viewer.faction);
  // Squash heights where the floor is the subject: the whole map, and placing, where a plot's
  // standing towers would otherwise be a wall the camera sits inside. Rubble shares the squash,
  // so a tower felled on the map falls from the height it was drawn at.
  const compress = mode === 'all' ? 1 : mode === 'placing' ? PLACING_COMPRESS : 0;

  return (
    <>
      <BoardFloor color={FLOOR_TINT} fadeDistance={fadeDistance} />

      {/* Bloom, the same chain the game scene uses. The rims are what it lights. */}
      <EffectsRenderer />

      <TerritoryTiles
        keeps={tiles.keeps}
        land={tiles.land}
        reach={tiles.reach}
        emphasiseReach={isPlacementMode}
      />

      {/* Only the viewer's own keep is outlined. Everyone else's ground is told by its tile. */}
      {region && (
        <PlotPlatform
          centerX={region.centerX}
          centerZ={region.centerZ}
          radius={KEEP_RADIUS}
          color={isPlacementMode ? PLACING_COLOR : myHex}
          active={isPlacementMode}
        />
      )}

      {mode === 'all' && plot && live && <PlotBeacon x={plot.x} z={plot.z} color={myHex} />}

      {/* One invisible ground plane, raycast and converted to a cell, rather than a hitbox per
          cell. The hit point already carries the coordinates. */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, GROUND_Y, 0]}
        onClick={handleFloorTap}
        visible={false}
      >
        <planeGeometry args={[12000, 12000]} />
      </mesh>

      <BoardTowers
        towers={towers}
        focusX={focus.x}
        focusZ={focus.z}
        selectedId={!isPlacementMode && selected ? selected.sessionId : null}
        dimAll={isPlacementMode}
        compress={compress}
        onTap={handleTowerTap}
      />

      <CrumblingTowers crumbles={crumbles} compress={compress} />
      <LandingRings rings={rings} />

      {selected && !isPlacementMode && <SelectionHalo tower={selected} color={SELECT_COLOR} />}

      {!isPlacementMode && selectedCell && (
        <CellMarker
          worldX={cellToWorld(selectedCell.x)}
          worldZ={cellToWorld(selectedCell.z)}
          color={SELECT_COLOR}
          beamHeight={14}
        />
      )}

      {isPlacementMode && pendingTower && aim && (
        <>
          <CellMarker
            worldX={cellToWorld(aim.x)}
            worldZ={cellToWorld(aim.z)}
            color={canPlace ? PLACING_COLOR : BLOCKED_COLOR}
            // Clear of the skyline, so the aim point is findable from above.
            beamHeight={Math.max(24, skyline * 1.15)}
          />
          <TowerGhost
            blocks={pendingTower.towerBlocks ?? []}
            worldX={cellToWorld(aim.x)}
            worldZ={cellToWorld(aim.z)}
            baseY={ghostDrawY}
            canPlace={canPlace}
          />
        </>
      )}

      <BoardCamera
        mode={mode}
        focusX={focus.x}
        focusZ={focus.z}
        // Placement looks halfway up the skyline, or at the top of the stack the tower will
        // land on, so the stack is framed from outside rather than looked through.
        focusY={isPlacementMode && aim ? placingLookHeight(skyline, ghostDrawY) : undefined}
        extent={extent}
        skyline={skyline}
        tower={mode === 'tower' ? selectedFrame : null}
        yaw={view.yaw}
        zoom={view.zoom}
        ready={ready}
        entrance={entrance}
        quake={quake}
      />
    </>
  );
};
