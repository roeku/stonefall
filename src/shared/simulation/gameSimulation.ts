import { PRNG } from './prng';
import { FixedMath } from './fixedMath';
import { GeometryUtils } from './geometry';
import { emitDebug } from './debugLog';
import {
  GameConfig,
  DEFAULT_CONFIG,
  ScoringConfig,
  DEFAULT_SCORING,
  GameState,
  Block,
  DropInput,
  GameResult,
  GameMode,
} from './types';

export class GameSimulation {
  private readonly config: GameConfig;
  private readonly scoring: ScoringConfig;
  private readonly prng: PRNG;
  private readonly mode: GameMode;
  // Runtime overrides for tuning slide speed and bounds
  private runtimeSlideSpeed: number = 1000;
  private runtimeSlideAccel: number = 200; // scaling constant C for logarithmic increase (default 100)
  private runtimeSlideMax: number | null = null;
  private runtimeSlideBounds?: number;
  // Runtime multiplier for falling physics (1.0 = default)
  private runtimeFallSpeedMult: number = 10; // default 10x for snappier drops
  // If true, the main falling block is instantly placed; trimmed pieces still fall
  private runtimeInstantPlaceMain: boolean = true;
  // Offset to subtract from block count when computing slide speed acceleration. Used to
  // prevent intro-seeded blocks from accelerating the first playable blocks.
  private speedCountOffset: number = 0;

  constructor(
    seed: number,
    mode: GameMode = 'rotating_block',
    config?: Partial<GameConfig>,
    scoring?: Partial<ScoringConfig>
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.scoring = { ...DEFAULT_SCORING, ...scoring };
    this.prng = new PRNG(seed);
    this.mode = mode;
    // Initialize runtime bounds from config
    this.runtimeSlideBounds = this.config.SLIDE_BOUNDS;
  }

  // Combo-based height scaling (visual reward). 7% per combo, capped at 1.9x.
  private getHeightFactor(combo: number): number {
    const raw = 1 + 0.07 * combo;
    return Math.min(raw, 1.9);
  }

  // Mild speed bump beginning at combo >= 4, +2% per extra combo, capped 1.3x.
  private getSpeedFactor(combo: number): number {
    if (combo < 4) return 1;
    const raw = 1 + 0.02 * (combo - 3);
    return Math.min(raw, 1.3);
  }

  // Create initial game state
  createInitialState(): GameState {
    const initialBlock = this.createBaseBlock();
    this.gameState = {
      tick: 0,
      score: 0,
      combo: 0,
      maxCombo: 0,
      perfectBlockCount: 0,
      blocks: [initialBlock],
      currentBlock: null,
      isGameOver: false,
      seed: this.prng.next(),
      recentTrimEffects: [],
      lastPlacement: null,
    };

    this.currentBlockSpawnTick = 0; // Initial block spawns at tick 0
    const firstBlock = this.generateNextBlock(0);

    return {
      ...this.gameState,
      currentBlock: firstBlock,
    };
  }

  // Step simulation forward by one tick
  stepSimulation(state: GameState, input?: DropInput): GameState {
    const DEBUG_DROP = typeof globalThis !== 'undefined' && (globalThis as any).__DEBUG_DROP;
    if (DEBUG_DROP) {
      // (timestamp removed - previously unused profiling variable)
      // console.log(
      //   '[SIM DEBUG] stepSimulation called tick=',
      //   state.tick,
      //   'inputTick=',
      //   input?.tick,
      //   'time=',
      //   now
      // );
    }
    if (state.isGameOver) return state;

    // Update internal game state reference
    this.gameState = state;

    const newTick = state.tick + 1;

    // Check if we should drop the current block
    if (input && input.tick === newTick && state.currentBlock) {
      // if (DEBUG_DROP) console.log('[SIM DEBUG] applying drop input for tick', newTick);

      // If instant placement of main block is enabled (either via config or runtime override),
      // perform the drop placement immediately and generate next block.
      const instantConfig = this.config.INSTANT_PLACE_MAIN_BLOCK ?? false;
      if (instantConfig || this.runtimeInstantPlaceMain) {
        // Determine axis and compute drop/placement against top block
        const topBlock = state.blocks[state.blocks.length - 1];
        if (!topBlock) return this.endGame(state, 'fall');

        // Determine axis based on next index
        const nextIndex = state.blocks.length;
        const axis: 'x' | 'z' = nextIndex % 2 === 0 ? 'x' : 'z';

        const dropped = { ...state.currentBlock } as Block;
        // compute placement as if it had reached top surface
        const dropResult = this.calculateDrop(dropped, topBlock, axis);

        if (dropResult.newExtent <= 0 || dropResult.newExtent < this.config.MIN_WIDTH_THRESHOLD) {
          return this.endGame(state, 'fall');
        }

        let landedBlock: Block = {
          x: axis === 'x' ? dropResult.newCenter : topBlock.x,
          z: axis === 'z' ? dropResult.newCenter : (topBlock.z ?? 0),
          y: topBlock.y + topBlock.height,
          rotation: dropped.rotation,
          width: axis === 'x' ? dropResult.newExtent : topBlock.width,
          depth: axis === 'z' ? dropResult.newExtent : (topBlock.depth ?? topBlock.width),
          height: this.config.BLOCK_HEIGHT,
          isFalling: false,
          velocityY: 0,
        } as Block;

        // Build trim effects for the pieces that were cut off (approximate)
        const trimmedPieces: Array<{
          x: number;
          y: number;
          z?: number;
          width: number;
          depth?: number;
          height: number;
          velocityX: number;
          velocityY: number;
          velocityZ?: number;
        }> = [];
        // Constants for initial velocities (fixed-point units per second)
        const TRIM_VEL_X = 2000;
        const TRIM_VEL_Y = 2000; // upward
        const TRIM_VEL_Z = 0;

        const droppedCenter = axis === 'x' ? dropped.x : (dropped.z ?? 0);
        const droppedExtent = axis === 'x' ? dropped.width : (dropped.depth ?? dropped.width);
        const overlapCenter = dropResult.newCenter;
        const overlapExtent = dropResult.newExtent;

        const droppedMin = droppedCenter - Math.floor(droppedExtent / 2);
        const droppedMax = droppedCenter + Math.floor(droppedExtent / 2);
        const overlapMin = overlapCenter - Math.floor(overlapExtent / 2);
        const overlapMax = overlapCenter + Math.floor(overlapExtent / 2);

        const leftWidth = Math.max(0, overlapMin - droppedMin);
        const rightWidth = Math.max(0, droppedMax - overlapMax);
        const noActualTrim = overlapExtent === droppedExtent; // width retained (grace band)

        if (!noActualTrim) {
          if (axis === 'x') {
            if (leftWidth > 0) {
              const cx = droppedMin + Math.floor(leftWidth / 2);
              trimmedPieces.push({
                x: cx,
                y: topBlock.y + topBlock.height + Math.floor(dropped.height / 2),
                z: topBlock.z ?? 0,
                width: leftWidth,
                depth: dropped.depth ?? dropped.width,
                height: dropped.height,
                velocityX: -TRIM_VEL_X,
                velocityY: TRIM_VEL_Y,
                velocityZ: TRIM_VEL_Z,
              });
            }
            if (rightWidth > 0) {
              const cx = overlapMax + Math.floor(rightWidth / 2);
              trimmedPieces.push({
                x: cx,
                y: topBlock.y + topBlock.height + Math.floor(dropped.height / 2),
                z: topBlock.z ?? 0,
                width: rightWidth,
                depth: dropped.depth ?? dropped.width,
                height: dropped.height,
                velocityX: TRIM_VEL_X,
                velocityY: TRIM_VEL_Y,
                velocityZ: TRIM_VEL_Z,
              });
            }
          } else {
            // Z axis trimming
            const frontWidth = leftWidth;
            const backWidth = rightWidth;
            if (frontWidth > 0) {
              const cz = droppedMin + Math.floor(frontWidth / 2);
              trimmedPieces.push({
                x: topBlock.x,
                y: topBlock.y + topBlock.height + Math.floor(dropped.height / 2),
                z: cz,
                width: dropped.width,
                depth: frontWidth,
                height: dropped.height,
                velocityX: 0,
                velocityY: TRIM_VEL_Y,
                velocityZ: -TRIM_VEL_X,
              });
            }
            if (backWidth > 0) {
              const cz = overlapMax + Math.floor(backWidth / 2);
              trimmedPieces.push({
                x: topBlock.x,
                y: topBlock.y + topBlock.height + Math.floor(dropped.height / 2),
                z: cz,
                width: dropped.width,
                depth: backWidth,
                height: dropped.height,
                velocityX: 0,
                velocityY: TRIM_VEL_Y,
                velocityZ: TRIM_VEL_X,
              });
            }
          }
        }

        const newBlocks = [...state.blocks, landedBlock];
        const scoreResult = this.calculateScore(
          state.currentBlock!,
          topBlock,
          landedBlock,
          state.combo
        );

        // Apply post-score perfect height scaling
        if (scoreResult.isPerfect) {
          const factor = this.getHeightFactor(scoreResult.newCombo);
          const h = Math.max(1, Math.floor(this.config.BLOCK_HEIGHT * factor));
          landedBlock = { ...landedBlock, height: h } as Block;
        }

        const newRecent = [...state.recentTrimEffects];
        // With grace band active, trimmedPieces will be empty for near-perfect placements.
        if (trimmedPieces.length > 0) {
          newRecent.push({ originalBlock: dropped, trimmedPieces, tick: newTick });
        }

        const nextPerfectBlockCount =
          (state.perfectBlockCount ?? 0) + (scoreResult.isPerfect ? 1 : 0);
        const nextMaxCombo = Math.max(state.maxCombo ?? 0, scoreResult.newCombo);

        const newState = {
          ...state,
          tick: newTick,
          score: state.score + scoreResult.points,
          combo: scoreResult.newCombo,
          maxCombo: nextMaxCombo,
          perfectBlockCount: nextPerfectBlockCount,
          blocks: newBlocks,
          currentBlock: null,
          recentTrimEffects: newRecent,
          lastPlacement: {
            isPositionPerfect: scoreResult.isPerfect,
            noTrim: noActualTrim,
            comboAfter: scoreResult.newCombo,
          },
        };

        this.gameState = newState;
        this.currentBlockSpawnTick = newTick; // Track when this block was spawned
        const nextBlock = this.generateNextBlock(newBlocks.length);

        return {
          ...newState,
          currentBlock: nextBlock,
        };
      }

      // Otherwise follow normal falling initiation
      const fallingBlock: Block = {
        ...state.currentBlock,
        isFalling: true,
        velocityY: 0,
      };

      return {
        ...state,
        tick: newTick,
        currentBlock: fallingBlock,
      };
    }

    // Update current block position and rotation
    let updatedCurrentBlock = state.currentBlock;
    if (updatedCurrentBlock) {
      // If the block is falling, advance physics; otherwise update horizontal movement
      if (updatedCurrentBlock.isFalling) {
        updatedCurrentBlock = this.updateFallingBlock(updatedCurrentBlock, state.blocks);
      } else {
        updatedCurrentBlock = this.updateBlockMovement(updatedCurrentBlock, newTick);
      }
    }

    // Clean up old trim effects
    const activeEffects = state.recentTrimEffects.filter((effect) => newTick - effect.tick < 60);

    // If a falling block landed during physics update, finalize placement now
    if (this.lastLandedBlock) {
      const landed = this.lastLandedBlock;
      this.lastLandedBlock = null;

      const topBlock = state.blocks[state.blocks.length - 1];
      if (!topBlock) return this.endGame(state, 'fall');

      // Calculate score
      const scoreResult = this.calculateScore(state.currentBlock!, topBlock, landed, state.combo);
      let adjustedLanded = landed;
      if (scoreResult.isPerfect) {
        const factor = this.getHeightFactor(scoreResult.newCombo);
        const h = Math.max(1, Math.floor(this.config.BLOCK_HEIGHT * factor));
        adjustedLanded = { ...landed, height: h } as Block;
      }

      // Build trim effects for trimmed pieces (approximate)
      const trimmedPieces2: Array<{
        x: number;
        y: number;
        z?: number;
        width: number;
        depth?: number;
        height: number;
        velocityX: number;
        velocityY: number;
        velocityZ?: number;
      }> = [];
      const TRIM_VEL_X = 2000;
      const TRIM_VEL_Y = 2000;

      const dropped = state.currentBlock!;
      const nextIndex = state.blocks.length; // index this landed block will occupy
      const axis: 'x' | 'z' = nextIndex % 2 === 0 ? 'x' : 'z';

      const droppedCenter = axis === 'x' ? dropped.x : (dropped.z ?? 0);
      const droppedExtent = axis === 'x' ? dropped.width : (dropped.depth ?? dropped.width);
      const overlapCenter = axis === 'x' ? landed.x : (landed.z ?? 0);
      const overlapExtent = axis === 'x' ? landed.width : (landed.depth ?? landed.width);

      const droppedMin = droppedCenter - Math.floor(droppedExtent / 2);
      const droppedMax = droppedCenter + Math.floor(droppedExtent / 2);
      const overlapMin = overlapCenter - Math.floor(overlapExtent / 2);
      const overlapMax = overlapCenter + Math.floor(overlapExtent / 2);

      const leftWidth = Math.max(0, overlapMin - droppedMin);
      const rightWidth = Math.max(0, droppedMax - overlapMax);
      const noActualTrim = overlapExtent === droppedExtent;
      if (!noActualTrim) {
        if (axis === 'x') {
          if (leftWidth > 0) {
            const cx = droppedMin + Math.floor(leftWidth / 2);
            trimmedPieces2.push({
              x: cx,
              y: topBlock.y + topBlock.height + Math.floor(dropped.height / 2),
              z: topBlock.z ?? 0,
              width: leftWidth,
              depth: dropped.depth ?? dropped.width,
              height: dropped.height,
              velocityX: -TRIM_VEL_X,
              velocityY: TRIM_VEL_Y,
              velocityZ: 0,
            });
          }
          if (rightWidth > 0) {
            const cx = overlapMax + Math.floor(rightWidth / 2);
            trimmedPieces2.push({
              x: cx,
              y: topBlock.y + topBlock.height + Math.floor(dropped.height / 2),
              z: topBlock.z ?? 0,
              width: rightWidth,
              depth: dropped.depth ?? dropped.width,
              height: dropped.height,
              velocityX: TRIM_VEL_X,
              velocityY: TRIM_VEL_Y,
              velocityZ: 0,
            });
          }
        } else {
          if (leftWidth > 0) {
            const cz = droppedMin + Math.floor(leftWidth / 2);
            trimmedPieces2.push({
              x: topBlock.x,
              y: topBlock.y + topBlock.height + Math.floor(dropped.height / 2),
              z: cz,
              width: dropped.width,
              depth: leftWidth,
              height: dropped.height,
              velocityX: 0,
              velocityY: TRIM_VEL_Y,
              velocityZ: -TRIM_VEL_X,
            });
          }
          if (rightWidth > 0) {
            const cz = overlapMax + Math.floor(rightWidth / 2);
            trimmedPieces2.push({
              x: topBlock.x,
              y: topBlock.y + topBlock.height + Math.floor(dropped.height / 2),
              z: cz,
              width: dropped.width,
              depth: rightWidth,
              height: dropped.height,
              velocityX: 0,
              velocityY: TRIM_VEL_Y,
              velocityZ: TRIM_VEL_X,
            });
          }
        }
      }

      const newBlocks = [...state.blocks, adjustedLanded];

      const newRecent2 = [...activeEffects];
      // Grace band suppresses trimming for near-perfect; array stays empty then.
      if (trimmedPieces2.length > 0) {
        newRecent2.push({
          originalBlock: state.currentBlock!,
          trimmedPieces: trimmedPieces2,
          tick: newTick,
        });
      }

      const nextPerfectBlockCount =
        (state.perfectBlockCount ?? 0) + (scoreResult.isPerfect ? 1 : 0);
      const nextMaxCombo = Math.max(state.maxCombo ?? 0, scoreResult.newCombo);

      const newState = {
        ...state,
        tick: newTick,
        score: state.score + scoreResult.points,
        combo: scoreResult.newCombo,
        maxCombo: nextMaxCombo,
        perfectBlockCount: nextPerfectBlockCount,
        blocks: newBlocks,
        currentBlock: null,
        recentTrimEffects: newRecent2,
        lastPlacement: {
          isPositionPerfect: scoreResult.isPerfect,
          noTrim: noActualTrim,
          comboAfter: scoreResult.newCombo,
        },
      };

      this.gameState = newState;
      this.currentBlockSpawnTick = newTick; // Track when this block was spawned
      const nextBlock = this.generateNextBlock(newBlocks.length);

      return {
        ...newState,
        currentBlock: nextBlock,
      };
    }

    return {
      ...state,
      tick: newTick,
      currentBlock: updatedCurrentBlock,
      recentTrimEffects: activeEffects,
    };
  }

  // Update falling block physics per tick and detect collision with top block
  private updateFallingBlock(block: Block, blocks: ReadonlyArray<Block>): Block | null {
    const dt = 1 / this.config.TICK_RATE; // seconds per tick
    const gravity = (this.config.GRAVITY ?? 4500) * (this.runtimeFallSpeedMult ?? 1);
    const terminal = (this.config.TERMINAL_VELOCITY ?? 12000) * (this.runtimeFallSpeedMult ?? 1);

    const velY = (block.velocityY ?? 0) + Math.floor(gravity * dt);
    const clampedVel = Math.max(Math.min(velY, terminal), -terminal);

    // Move block down by velocity * dt
    const deltaY = Math.floor(clampedVel * dt);
    const newY = block.y - deltaY; // fixed-point: decreasing y goes down

    // Check collision with top block
    const topBlock = blocks[blocks.length - 1];
    if (!topBlock) return { ...block, y: newY, velocityY: clampedVel, isFalling: true };

    const blockBottom = newY - Math.floor(block.height / 2);
    const topSurface = topBlock.y + topBlock.height;

    // If the block bottom is at or below the top surface, finalize placement
    if (blockBottom <= topSurface) {
      // Determine which horizontal axis this falling block was moving along
      const nextIndex = blocks.length; // the index this block will occupy
      const axis: 'x' | 'z' = nextIndex % 2 === 0 ? 'x' : 'z';

      // Use calculateDrop to trim and place properly along the active axis
      const dropResult = this.calculateDrop({ ...block, y: newY }, topBlock, axis);

      if (dropResult.newExtent <= 0 || dropResult.newExtent < this.config.MIN_WIDTH_THRESHOLD) {
        // Game over: fell off
        return null;
      }

      // Create landed block (set width/depth depending on axis)
      const landedBlock: Block = {
        x: axis === 'x' ? dropResult.newCenter : topBlock.x,
        z: axis === 'z' ? dropResult.newCenter : (topBlock.z ?? 0),
        y: topBlock.y + topBlock.height,
        rotation: block.rotation,
        width: axis === 'x' ? dropResult.newExtent : topBlock.width,
        depth: axis === 'z' ? dropResult.newExtent : (topBlock.depth ?? topBlock.width),
        height: this.config.BLOCK_HEIGHT,
        isFalling: false,
        velocityY: 0,
      } as Block;

      // Apply placement by appending to blocks via gameState in dropBlock flow
      // Temporarily return null to indicate placement should occur in stepSimulation caller
      // We'll attach the landed block through the dropBlock flow which calls calculateDrop normally.
      // To keep behavior consistent, store landedBlock in a helper property
      this.lastLandedBlock = landedBlock;
      return null;
    }

    return { ...block, y: newY, velocityY: clampedVel, isFalling: true };
  }

  // Temporary holder for a landed block produced during physics update
  private lastLandedBlock: Block | null = null;

  // Track when the current block was spawned for smooth movement
  private currentBlockSpawnTick: number = 0;

  // Update block position and rotation based on game mode
  private updateBlockMovement(block: Block, tick: number): Block {
    // Determine axis based on current tower height (blocks.length)
    const index = (this.gameState && this.gameState.blocks.length) || 0;
    const axis = index % 2 === 0 ? 'x' : 'z';

    // Calculate relative tick since this block was spawned for consistent movement
    // For the initial block, ensure we start from tick 0
    const spawnTick = this.currentBlockSpawnTick;
    const relativeTick = Math.max(0, tick - spawnTick);
    const newPos = this.calculateSlidePosition(relativeTick, index);

    // Calculate rotation based on game mode
    let newRotation = 0;
    if (this.mode === 'rotating_block') {
      newRotation = this.calculateBlockRotation(tick);
    }

    // Ensure moving block sizes smoothly approach the current top block's size
    const topBlock = this.getCurrentTopBlock();
    const targetWidth = topBlock ? topBlock.width : this.config.TOWER_WIDTH;
    const targetDepth = topBlock ? (topBlock.depth ?? topBlock.width) : this.config.TOWER_WIDTH;

    // Lerp helper: if difference is small, snap to target to avoid jitter
    const LERP_FACTOR = 0.25;
    const lerp = (a: number, b: number) => {
      const diff = b - a;
      if (Math.abs(diff) < 1) return b;
      return Math.floor(a + diff * LERP_FACTOR);
    };

    const newWidth = lerp(block.width, targetWidth);
    const newDepth = lerp(block.depth ?? block.width, targetDepth);

    if (axis === 'x') {
      return {
        ...block,
        x: newPos,
        rotation: newRotation,
        width: newWidth,
        depth: newDepth,
      };
    }

    return {
      ...block,
      z: newPos,
      rotation: newRotation,
      width: newWidth,
      depth: newDepth,
    } as Block;
  }

  // Calculate horizontal slide position (smooth ping-pong movement)
  private calculateSlidePosition(tick: number, blockCount?: number): number {
    // Base period that will be scaled by a block-count-dependent speed multiplier.
    const basePeriod = 180; // base period in ticks

    let count = typeof blockCount === 'number' && blockCount >= 0 ? blockCount : 0;
    // Apply offset so early seeded blocks don't affect speed
    count = Math.max(0, count - (this.speedCountOffset || 0));

    // Compute speed multiplier with logarithmic increase per block:
    // f(n) = C * log(1 + n) — grows fast early, then flattens out.
    // runtimeSlideAccel acts as the scaling constant C.
    const logFactor = Math.log1p(count); // natural log of (1 + count)
    let speedMultiplier = this.runtimeSlideSpeed + Math.floor(this.runtimeSlideAccel * logFactor);
    if (this.gameState) {
      const combo = this.gameState.combo;
      const speedFactor = this.getSpeedFactor(combo);
      if (speedFactor !== 1) {
        const before = speedMultiplier;
        speedMultiplier = Math.floor(speedMultiplier * speedFactor);
        const DBG = (globalThis as any).__DEBUG_SPEED;
        if (DBG) {
          // console.log(
          //   '[SPEED] combo=',
          //   combo,
          //   'base=',
          //   before,
          //   'factor=',
          //   speedFactor.toFixed(2),
          //   'final=',
          //   speedMultiplier
          // );
          emitDebug('SPEED', 'Speed factor applied', {
            combo,
            base: before,
            factor: speedFactor,
            final: speedMultiplier,
          });
        }
      }
    }
    if (this.runtimeSlideMax !== null && speedMultiplier > this.runtimeSlideMax) {
      speedMultiplier = this.runtimeSlideMax;
    }

    const adjustedPeriod = Math.max(
      4,
      Math.floor((basePeriod * 1000) / Math.max(1, speedMultiplier))
    );

    const cyclePosition = tick % adjustedPeriod;
    const normalizedCycle = Math.floor((cyclePosition * 1000) / adjustedPeriod);

    // Handle first block differently - it starts from center
    if (count === 0) {
      // First block starts from center and moves normally
      // Use standard ping-pong pattern starting from center
      let progress: number;
      if (normalizedCycle <= 500) {
        progress = normalizedCycle / 500; // 0 to 1
      } else {
        progress = 1 - (normalizedCycle - 500) / 500; // 1 to 0
      }

      const bounds = this.runtimeSlideBounds ?? this.config.SLIDE_BOUNDS;
      // Start from center (0) and move to bounds
      return Math.floor(-bounds + 2 * bounds * progress);
    }

    // For subsequent blocks, determine starting direction based on block count
    const startFromLeft = count % 4 < 2;

    // For the very first few ticks after spawn, ensure we start exactly at the spawn position
    if (tick < 5) {
      const bounds = this.runtimeSlideBounds ?? this.config.SLIDE_BOUNDS;
      return startFromLeft ? -bounds : bounds;
    }

    // Create ping-pong pattern that starts from bounds: bound -> center -> bound
    let progress: number;
    if (normalizedCycle <= 500) {
      // First half: move from bound toward opposite bound
      progress = normalizedCycle / 500; // 0 to 1
    } else {
      // Second half: move back toward starting bound
      progress = 1 - (normalizedCycle - 500) / 500; // 1 to 0
    }

    // Map to slide bounds with proper starting direction
    const bounds = this.runtimeSlideBounds ?? this.config.SLIDE_BOUNDS;
    const minBound = -bounds;
    const maxBound = bounds;

    let position: number;
    if (startFromLeft) {
      // Start from left bound, move toward right bound
      position = minBound + (maxBound - minBound) * progress;
    } else {
      // Start from right bound, move toward left bound
      position = maxBound - (maxBound - minBound) * progress;
    }

    const finalPosition = Math.floor(position);

    return finalPosition;
  }

  // Runtime setters so UI/host can tune movement live
  public setSlideSpeedMultiplier(mult: number) {
    if (typeof mult === 'number' && isFinite(mult) && mult > 0) {
      this.runtimeSlideSpeed = Math.max(1, Math.floor(mult));
    }
  }

  // Set linear acceleration (additional multiplier per tick)
  public setSlideAcceleration(accel: number) {
    if (typeof accel === 'number' && isFinite(accel)) {
      this.runtimeSlideAccel = Math.max(0, Number(accel));
    }
  }

  // Optional cap for speed multiplier
  public setSlideSpeedMax(max?: number) {
    if (typeof max === 'number' && isFinite(max) && max > 0) {
      this.runtimeSlideMax = Math.floor(max);
    } else {
      this.runtimeSlideMax = null;
    }
  }

  public setSlideBounds(bounds: number) {
    if (typeof bounds === 'number' && isFinite(bounds) && bounds > 0) {
      this.runtimeSlideBounds = Math.floor(bounds);
    }
  }

  // Return the computed slide speed multiplier for a given block count
  public getSlideSpeedForBlockCount(count: number): number {
    const c = Math.max(0, Math.floor(count - (this.speedCountOffset || 0)));
    // Use logarithmic growth for f(n) = C * log(1 + n)
    const logFactor = Math.log1p(c);
    let speedMultiplier = this.runtimeSlideSpeed + Math.floor(this.runtimeSlideAccel * logFactor);
    if (this.runtimeSlideMax !== null && speedMultiplier > this.runtimeSlideMax) {
      speedMultiplier = this.runtimeSlideMax;
    }
    return speedMultiplier;
  }

  // Return the current moving block's slide speed multiplier (or null if none)
  public getCurrentBlockSlideSpeed(): number | null {
    if (!this.gameState || !this.gameState.currentBlock) return null;
    const count = this.gameState.blocks.length;
    return this.getSlideSpeedForBlockCount(count);
  }

  // Adjust falling speed multiplier at runtime (affects gravity and terminal velocity)
  public setFallSpeedMultiplier(mult: number) {
    if (typeof mult === 'number' && isFinite(mult) && mult > 0) {
      this.runtimeFallSpeedMult = Number(mult);
    }
  }

  public setInstantPlaceMain(enabled: boolean) {
    this.runtimeInstantPlaceMain = !!enabled;
  }

  // Offset how many blocks to ignore when computing slide speed acceleration.
  // For example, if 15 blocks are pre-seeded, set offset to 15 so the next
  // playable block uses speed as if it's the first.
  public setSpeedCountOffset(offset: number) {
    if (typeof offset === 'number' && isFinite(offset) && offset >= 0) {
      this.speedCountOffset = Math.floor(offset);
    } else {
      this.speedCountOffset = 0;
    }
  }

  // Calculate block rotation
  private calculateBlockRotation(tick: number, speedMultiplier: number = 1000): number {
    const rotationPerTick =
      FixedMath.multiply(this.config.ROTATION_SPEED, speedMultiplier, 1000) / this.config.TICK_RATE;
    return (tick * rotationPerTick) % 360000; // Keep within 0-360 degrees (in millidegrees)
  }

  // Calculate drop physics and trimming
  private calculateDrop(
    droppedBlock: Block,
    topBlock: Block,
    axis: 'x' | 'z' = 'x'
  ): { newCenter: number; newExtent: number; overlapArea: number } {
    // Perfect-drop grace band: if horizontal misalignment is within the positionPerfectWindow,
    // we keep full inherited width (no trim) so the block snaps perfectly, rewarding precision.
    // Choose which axis to evaluate overlap on. For the non-tested axis
    // we use the top block's existing extents.
    // Build AABBs where 'centerX' represents the horizontal axis under test.
    const droppedCenter = axis === 'x' ? droppedBlock.x : (droppedBlock.z ?? 0);
    const droppedExtent =
      axis === 'x' ? droppedBlock.width : (droppedBlock.depth ?? droppedBlock.width);
    const topCenter = axis === 'x' ? topBlock.x : (topBlock.z ?? 0);
    const topExtent = axis === 'x' ? topBlock.width : (topBlock.depth ?? topBlock.width);

    const alignmentError = Math.abs(droppedCenter - topCenter);
    // Clamp grace window so a misconfigured scoring window can't exceed a fraction of block width
    const maxGrace = Math.floor(topExtent / 5); // at most 20% of current width
    const graceWindow = Math.min(this.scoring.positionPerfectWindow, maxGrace);
    if (alignmentError <= graceWindow) {
      // Inside grace band: treat as perfect – snap to top center & keep full width.
      // (We snap so overhang doesn't appear visually; window kept intentionally small.)
      return {
        newCenter: topCenter,
        newExtent: topExtent,
        overlapArea: topExtent * droppedBlock.height,
      };
    }

    const droppedRect = GeometryUtils.createAABB(
      droppedCenter,
      topBlock.y + topBlock.height + droppedBlock.height / 2,
      droppedExtent,
      droppedBlock.height
    );

    const topRect = GeometryUtils.createAABB(
      topCenter,
      topBlock.y + topBlock.height / 2,
      topExtent,
      topBlock.height
    );

    // For rotated blocks (on X axis), use polygon collision
    if (axis === 'x' && this.mode === 'rotating_block' && droppedBlock.rotation !== 0) {
      const rotated = this.calculateRotatedDrop(droppedBlock, topBlock);
      return {
        newCenter: rotated.newX,
        newExtent: rotated.newWidth,
        overlapArea: rotated.overlapArea,
      };
    }

    // Simple AABB collision for non-rotated or Z-axis drops
    const overlapArea = GeometryUtils.aabbIntersectionArea(droppedRect, topRect);
    const overlapExtent =
      Math.min(droppedRect.maxX, topRect.maxX) - Math.max(droppedRect.minX, topRect.minX);

    if (overlapExtent <= 0) {
      // No overlap - block falls off
      return { newCenter: droppedCenter, newExtent: 0, overlapArea: 0 };
    }

    // Calculate new position (center of overlap)
    const overlapCenter =
      (Math.max(droppedRect.minX, topRect.minX) + Math.min(droppedRect.maxX, topRect.maxX)) / 2;

    return {
      newCenter: overlapCenter,
      newExtent: Math.max(0, overlapExtent),
      overlapArea,
    };
  }

  // Calculate drop for rotated blocks using polygon clipping
  private calculateRotatedDrop(
    droppedBlock: Block,
    topBlock: Block
  ): { newX: number; newWidth: number; overlapArea: number } {
    // Create rotated polygon for dropped block
    const droppedY = topBlock.y + topBlock.height + droppedBlock.height / 2;
    const droppedPolygon = GeometryUtils.createRotatedRect(
      droppedBlock.x,
      droppedY,
      droppedBlock.width,
      droppedBlock.height,
      droppedBlock.rotation
    );

    // Create AABB for top block (assuming it's not rotated)
    const topRect = GeometryUtils.createAABB(
      topBlock.x,
      topBlock.y + topBlock.height / 2,
      topBlock.width,
      topBlock.height
    );

    // Clip the dropped polygon against the top block
    const clippedPolygon = GeometryUtils.clipPolygonToAABB(droppedPolygon, topRect);

    if (clippedPolygon.length < 3) {
      // No meaningful overlap
      return { newX: droppedBlock.x, newWidth: 0, overlapArea: 0 };
    }

    const overlapArea = GeometryUtils.polygonArea(clippedPolygon);

    // Calculate bounding box of clipped polygon to determine new width
    const minX = Math.min(...clippedPolygon.map((p) => p.x));
    const maxX = Math.max(...clippedPolygon.map((p) => p.x));
    const newWidth = maxX - minX;
    const newX = (minX + maxX) / 2;

    return { newX, newWidth, overlapArea };
  }

  // Calculate score for a successful drop
  private calculateScore(
    droppedBlock: Block,
    topBlock: Block,
    landedBlock: Block,
    currentCombo: number
  ): { points: number; newCombo: number; isPerfect: boolean } {
    let points = this.scoring.basePoints;
    let newCombo = 0;

    // Horizontal alignment error (fixed-point)
    const positionError = Math.abs(droppedBlock.x - topBlock.x);
    const isPositionPerfect = positionError <= this.scoring.positionPerfectWindow;

    if (isPositionPerfect) {
      const DBG = (globalThis as any).__DEBUG_PERFECT;
      if (DBG) {
        // console.log(
        //   '[SCORING] PERFECT positionError=',
        //   positionError,
        //   'window=',
        //   this.scoring.positionPerfectWindow,
        //   'prevCombo=',
        //   currentCombo
        // );
        emitDebug('SCORING', 'Perfect placement', {
          positionError,
          window: this.scoring.positionPerfectWindow,
          prevCombo: currentCombo,
        });
      }
      // Increase combo for consecutive perfects
      newCombo = currentCombo + 1;
      // Base perfect bonus
      points += this.scoring.positionPerfectBonus;

      // Stacking perfect multiplier: apply combinedPerfectMultiplier^(streak)
      // combinedPerfectMultiplier is fixed-point (e.g., 1600 for 1.6x)
      // We exponentiate by applying repeated multiplication to maintain determinism.
      const baseMult = this.scoring.combinedPerfectMultiplier; // fixed-point
      let streakMult = 1000; // 1.0 in fixed-point
      for (let i = 0; i < newCombo; i++) {
        streakMult = FixedMath.multiply(streakMult, baseMult, 1000);
        // Clamp to prevent runaway large numbers breaking fixed math
        if (streakMult > 1000 * 100) {
          // cap at 100x
          streakMult = 1000 * 100;
          break;
        }
      }
      points = FixedMath.multiply(points, streakMult, 1000);
      if (DBG) {
        const hf = this.getHeightFactor(newCombo);
        // console.log(
        //   '[SCORING] streakMultApplied newCombo=',
        //   newCombo,
        //   'heightFactor=',
        //   hf.toFixed(3)
        // );
        emitDebug('SCORING', 'Streak multiplier applied', { newCombo, heightFactor: hf });
      }
    } else {
      const DBG = (globalThis as any).__DEBUG_PERFECT;
      if (DBG) {
        // console.log(
        //   '[SCORING] not perfect positionError=',
        //   positionError,
        //   'window=',
        //   this.scoring.positionPerfectWindow
        // );
        emitDebug('SCORING', 'Imperfect placement', {
          positionError,
          window: this.scoring.positionPerfectWindow,
        });
      }
      // Missed perfect resets combo
      newCombo = 0;
    }

    // Additional combo multiplier layering (optional). We keep prior design but
    // base it on newCombo AFTER streak application so late streaks still benefit.
    if (newCombo > 0) {
      const comboMultiplier = Math.min(
        this.scoring.maxComboMultiplier,
        1000 + newCombo * (this.scoring.comboStepMultiplier - 1000)
      );
      points = FixedMath.multiply(points, comboMultiplier, 1000);
    }

    // Milestone rewards
    const blockCount = (landedBlock.y / this.config.BLOCK_HEIGHT) | 0;
    for (const milestone of this.scoring.milestoneRewards) {
      if (blockCount === milestone) {
        points += milestone;
        break;
      }
    }

    return { points: Math.floor(points), newCombo, isPerfect: isPositionPerfect };
  }

  // Generate next block starting from bounds for smooth entry
  private generateNextBlock(_blockIndex: number): Block {
    // Next block should inherit the width of the current top block so
    // moving blocks match the last placed block size.
    const topBlock = this.getCurrentTopBlock();
    const inheritedWidth = topBlock ? topBlock.width : this.config.TOWER_WIDTH;

    // Position closer above the current tower so the moving block travels directly
    // across the top surface (more like classic stackers)
    const yPosition = topBlock
      ? topBlock.y + topBlock.height + Math.floor(this.config.BLOCK_HEIGHT * 1)
      : Math.floor(this.config.BLOCK_HEIGHT * 1.2);

    // Alternate axis: even blocks move on X, odd blocks move on Z
    const axis = _blockIndex % 2 === 0 ? 'x' : 'z';

    // For the first block, start from center; subsequent blocks start from bounds
    let startPosition: number;
    if (_blockIndex === 0) {
      // First block starts from center
      startPosition = 0;
    } else {
      // Subsequent blocks start from bounds for smooth entry movement
      const bounds = this.runtimeSlideBounds ?? this.config.SLIDE_BOUNDS;
      const startFromLeft = _blockIndex % 4 < 2;
      startPosition = startFromLeft ? -bounds : bounds;
    }

    return {
      x: axis === 'x' ? startPosition : topBlock ? topBlock.x : 0,
      z: axis === 'z' ? startPosition : topBlock ? (topBlock.z ?? 0) : 0,
      y: yPosition,
      rotation: 0, // Will be updated by rotation calculation
      width: inheritedWidth,
      depth: inheritedWidth,
      height: topBlock ? topBlock.height : this.config.BLOCK_HEIGHT,
    } as Block;
  }

  // Get the current top block of the tower
  private getCurrentTopBlock(): Block | null {
    if (this.gameState && this.gameState.blocks.length > 0) {
      return this.gameState.blocks[this.gameState.blocks.length - 1] || null;
    }
    return null;
  }

  // Store reference to current game state for block positioning
  private gameState: GameState | null = null;

  // Create the base block for the tower
  private createBaseBlock(): Block {
    return {
      x: 0,
      z: 0,
      y: 0,
      rotation: 0,
      width: this.config.TOWER_WIDTH * 2, // Base is wider for stability
      depth: this.config.TOWER_WIDTH * 2,
      height: this.config.BLOCK_HEIGHT,
    };
  }

  // End the game with a specific reason
  private endGame(state: GameState, reason: 'width' | 'fall'): GameState {
    console.log(
      'Game ending due to:',
      reason,
      'at tick:',
      state.tick,
      'blocks:',
      state.blocks.length
    );
    return {
      ...state,
      isGameOver: true,
      currentBlock: null,
    };
  }

  // Run a complete game simulation from inputs
  static simulateGame(
    seed: number,
    inputs: ReadonlyArray<DropInput>,
    mode: GameMode = 'rotating_block',
    config?: Partial<GameConfig>,
    scoring?: Partial<ScoringConfig>
  ): GameResult {
    const simulation = new GameSimulation(seed, mode, config, scoring);
    let state = simulation.createInitialState();

    const inputMap = new Map(inputs.map((input) => [input.tick, input]));
    let maxCombo = 0;

    // Run simulation until game over or max ticks
    const maxTicks = 3600; // 60 seconds at 60 FPS
    for (let tick = 1; tick <= maxTicks && !state.isGameOver; tick++) {
      const input = inputMap.get(tick);
      state = simulation.stepSimulation(state, input);
      const stateMaxCombo = (state as any).maxCombo;
      maxCombo = Math.max(
        maxCombo,
        typeof stateMaxCombo === 'number' ? stateMaxCombo : state.combo
      );
    }

    const gameOverReason: 'width' | 'fall' | 'manual' = state.isGameOver ? 'width' : 'manual';

    return {
      finalScore: state.score,
      blockCount: state.blocks.length - 1, // Exclude base block
      maxCombo,
      gameOverReason,
      finalState: state,
    };
  }
}
