import { PRNG } from './prng';
import { FixedMath } from './fixedMath';
import { GeometryUtils } from './geometry';
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
  }

  // Create initial game state
  createInitialState(): GameState {
    const initialBlock = this.createBaseBlock();
    this.gameState = {
      tick: 0,
      score: 0,
      combo: 0,
      blocks: [initialBlock],
      currentBlock: null,
      isGameOver: false,
      seed: this.prng.next(),
      recentTrimEffects: [],
    };

    const firstBlock = this.generateNextBlock(0);

    return {
      ...this.gameState,
      currentBlock: firstBlock,
    };
  }

  // Step simulation forward by one tick
  stepSimulation(state: GameState, input?: DropInput): GameState {
    if (state.isGameOver) return state;

    // Update internal game state reference
    this.gameState = state;

    const newTick = state.tick + 1;

    // Check if we should drop the current block
    if (input && input.tick === newTick && state.currentBlock) {
      // Initiate falling state instead of immediate placement
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

      const newBlocks = [...state.blocks, landed];

      const newState = {
        ...state,
        tick: newTick,
        score: state.score + scoreResult.points,
        combo: scoreResult.newCombo,
        blocks: newBlocks,
        currentBlock: null,
        recentTrimEffects: activeEffects,
      };

      this.gameState = newState;
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
    const gravity = this.config.GRAVITY ?? 4500;
    const terminal = this.config.TERMINAL_VELOCITY ?? 12000;

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
      // Use calculateDrop to trim and place properly
      const dropResult = this.calculateDrop({ ...block, y: newY }, topBlock);

      if (dropResult.newWidth <= 0 || dropResult.newWidth < this.config.MIN_WIDTH_THRESHOLD) {
        // Game over: fell off
        return null;
      }

      // Create landed block
      const landedBlock: Block = {
        x: dropResult.newX,
        y: topBlock.y + topBlock.height,
        rotation: block.rotation,
        width: dropResult.newWidth,
        height: this.config.BLOCK_HEIGHT,
        isFalling: false,
        velocityY: 0,
      };

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

  // Update block position and rotation based on game mode
  private updateBlockMovement(block: Block, tick: number): Block {
    const newX = this.calculateSlidePosition(tick);

    // Calculate rotation based on game mode
    let newRotation = 0;
    if (this.mode === 'rotating_block') {
      newRotation = this.calculateBlockRotation(tick);
    } else if (this.mode === 'rotating_base') {
      // Base rotates but block doesn't
      newRotation = 0;
    }
    // Classic mode keeps rotation at 0

    return {
      ...block,
      x: newX,
      rotation: newRotation,
    };
  }

  // Calculate horizontal slide position (ping-pong movement)
  private calculateSlidePosition(tick: number, speedMultiplier: number = 1000): number {
    const period = 180; // 3 seconds at 60 FPS for slower movement
    const adjustedPeriod = Math.floor((period * 1000) / speedMultiplier);
    const cyclePosition = tick % adjustedPeriod;
    const normalizedCycle = Math.floor((cyclePosition * 1000) / adjustedPeriod);

    // Create ping-pong pattern: 0 -> 1 -> 0
    let pingPong: number;
    if (normalizedCycle <= 500) {
      // First half: 0 -> 1
      pingPong = normalizedCycle * 2;
    } else {
      // Second half: 1 -> 0
      pingPong = 2000 - normalizedCycle * 2;
    }

    // Map to slide bounds: [-SLIDE_BOUNDS, +SLIDE_BOUNDS]
    const minBound = -this.config.SLIDE_BOUNDS;
    const maxBound = this.config.SLIDE_BOUNDS;
    const range = maxBound - minBound;
    return minBound + Math.floor((range * pingPong) / 1000);
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
    topBlock: Block
  ): { newX: number; newWidth: number; overlapArea: number } {
    // Create bounding boxes for collision detection
    const droppedRect = GeometryUtils.createAABB(
      droppedBlock.x,
      topBlock.y + topBlock.height + droppedBlock.height / 2,
      droppedBlock.width,
      droppedBlock.height
    );

    const topRect = GeometryUtils.createAABB(
      topBlock.x,
      topBlock.y + topBlock.height / 2,
      topBlock.width,
      topBlock.height
    );

    // For rotated blocks, use polygon collision
    if (this.mode === 'rotating_block' && droppedBlock.rotation !== 0) {
      return this.calculateRotatedDrop(droppedBlock, topBlock);
    }

    // Simple AABB collision for non-rotated blocks
    const overlapArea = GeometryUtils.aabbIntersectionArea(droppedRect, topRect);
    const overlapWidth =
      Math.min(droppedRect.maxX, topRect.maxX) - Math.max(droppedRect.minX, topRect.minX);

    if (overlapWidth <= 0) {
      // No overlap - block falls off
      return { newX: droppedBlock.x, newWidth: 0, overlapArea: 0 };
    }

    // Calculate new position (center of overlap)
    const overlapCenterX =
      (Math.max(droppedRect.minX, topRect.minX) + Math.min(droppedRect.maxX, topRect.maxX)) / 2;

    return {
      newX: overlapCenterX,
      newWidth: Math.max(0, overlapWidth),
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
  ): { points: number; newCombo: number } {
    let points = this.scoring.basePoints;
    let newCombo = 0;

    // Position perfect bonus
    const positionError = Math.abs(droppedBlock.x - topBlock.x);
    const isPositionPerfect = positionError <= this.scoring.positionPerfectWindow;

    // Apply bonuses (classic mode - only position matters)
    if (isPositionPerfect) {
      points += this.scoring.positionPerfectBonus;
      newCombo = currentCombo + 1;
    }

    // Perfect drop multiplier
    if (isPositionPerfect) {
      points = FixedMath.multiply(points, this.scoring.combinedPerfectMultiplier, 1000);
      newCombo = currentCombo + 1;
    }

    // Combo multiplier
    if (newCombo > 0) {
      const comboMultiplier = Math.min(
        this.scoring.maxComboMultiplier,
        1000 + newCombo * (this.scoring.comboStepMultiplier - 1000)
      );
      points = FixedMath.multiply(points, comboMultiplier, 1000);
    } else {
      // Reset combo if not perfect
      newCombo = 0;
    }

    // Milestone rewards
    const blockCount = (landedBlock.y / this.config.BLOCK_HEIGHT) | 0;
    for (const milestone of this.scoring.milestoneRewards) {
      if (blockCount === milestone) {
        points += milestone;
        break;
      }
    }

    return { points: Math.floor(points), newCombo };
  }

  // Generate next block with random width variation
  private generateNextBlock(_blockIndex: number): Block {
    // Next block should inherit the width of the current top block so
    // moving blocks match the last placed block size.
    const topBlock = this.getCurrentTopBlock();
    const inheritedWidth = topBlock ? topBlock.width : this.config.TOWER_WIDTH;

    // Position above the current tower
    const yPosition = topBlock
      ? topBlock.y + topBlock.height + this.config.BLOCK_HEIGHT * 2
      : this.config.BLOCK_HEIGHT * 3;

    return {
      x: 0, // Will be updated by movement calculation
      y: yPosition,
      rotation: 0, // Will be updated by rotation calculation
      width: inheritedWidth,
      height: this.config.BLOCK_HEIGHT,
    };
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
      y: 0,
      rotation: 0,
      width: this.config.TOWER_WIDTH * 2, // Base is wider for stability
      height: this.config.BLOCK_HEIGHT,
    };
  }

  // End the game with a specific reason
  private endGame(state: GameState, _reason: 'width' | 'fall'): GameState {
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
      maxCombo = Math.max(maxCombo, state.combo);
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
