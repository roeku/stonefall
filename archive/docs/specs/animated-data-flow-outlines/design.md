# Design Document

## Overview

This design creates a tower edge mapping system that generates flowing energy lines along the actual block edges. The system maps the precise coordinates of all block edges and creates continuous paths for individual energy segments to flow along, simulating data packets moving through a network infrastructure.

## Architecture

### Component Structure

- **RedditOutlines.tsx**: Creates and manages the tower edge mapping and flowing energy lines
- **TowerEdgeMapper**: Maps precise coordinates of all block edges and corners
- **EnergyFlowSystem**: Manages individual flowing segments along the mapped paths
- **PathGenerator**: Creates continuous routes through the tower edge network

### Animation System

The energy flow animation will be implemented using:

1. **Edge coordinate mapping** to get precise block outline positions
2. **Continuous path generation** that connects edges between blocks
3. **Individual segment animation** using TubeGeometry for visible energy packets
4. **useFrame hook** for smooth 60fps animation updates with proper timing

## Components and Interfaces

### Enhanced RedditOutlines Component

```typescript
interface RedditOutlinesProps {
  gameState: GameState | null;
  convertPosition: (fixedValue: number) => number;
  animationSpeed?: number; // Flow speed multiplier
  flowDirection?: 'clockwise' | 'counterclockwise' | 'bidirectional';
  enableConnections?: boolean; // Show flow between adjacent blocks
}

interface FlowAnimationState {
  dashOffset: number;
  flowSpeed: number;
  connectionPaths: ConnectionPath[];
  animationPhase: number;
}

interface ConnectionPath {
  startBlock: number;
  endBlock: number;
  pathGeometry: THREE.BufferGeometry;
  flowDirection: number;
}
```

### Data Flow Shader Material

```glsl
// Vertex Shader
attribute float lineDistance;
varying float vLineDistance;
varying vec3 vWorldPosition;

void main() {
    vLineDistance = lineDistance;
    vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}

// Fragment Shader
uniform float time;
uniform float dashSize;
uniform float gapSize;
uniform float flowSpeed;
uniform vec3 flowColor;
uniform float intensity;

varying float vLineDistance;

void main() {
    float dashPattern = mod(vLineDistance - time * flowSpeed, dashSize + gapSize);
    float alpha = step(dashPattern, dashSize);

    // Add pulsing effect
    float pulse = sin(time * 2.0) * 0.3 + 0.7;

    // Distance-based fade
    float fade = 1.0 - smoothstep(0.0, 10.0, length(vWorldPosition));

    gl_FragColor = vec4(flowColor, alpha * intensity * pulse * fade);
}
```

## Data Models

### Animation Configuration

```typescript
interface FlowConfig {
  baseSpeed: number; // Base animation speed
  speedVariation: number; // Random speed variation per block
  pulseFrequency: number; // Pulsing effect frequency
  connectionThreshold: number; // Distance threshold for block connections
  fadeDistance: number; // Distance at which outlines fade
}

interface BlockOutlineState {
  blockIndex: number;
  animationOffset: number;
  flowSpeed: number;
  isConnected: boolean;
  connectionTargets: number[];
  lastUpdateTime: number;
}
```

### Performance Optimization

```typescript
interface OutlinePool {
  geometries: Map<string, THREE.BufferGeometry>;
  materials: Map<string, THREE.ShaderMaterial>;
  instances: THREE.InstancedMesh[];
}
```

## Error Handling

### Animation Fallbacks

1. **Shader compilation failure**: Fall back to basic LineDashedMaterial
2. **Performance degradation**: Reduce animation complexity or disable effects
3. **WebGL context loss**: Reinitialize materials and geometries
4. **Memory constraints**: Implement geometry pooling and cleanup

### Graceful Degradation

- If custom shaders fail, use standard Three.js materials
- If frame rate drops below 45fps, reduce animation complexity
- If memory usage exceeds thresholds, disable connection lines

## Testing Strategy

### Visual Testing

1. **Animation smoothness**: Verify 60fps performance across different devices
2. **Visual consistency**: Ensure animations match the tron aesthetic
3. **State transitions**: Test animation behavior during perfect placements
4. **Multi-block scenarios**: Verify performance with many animated outlines

### Performance Testing

1. **Frame rate monitoring**: Track fps during intensive animation sequences
2. **Memory usage**: Monitor WebGL memory consumption
3. **CPU profiling**: Ensure animation calculations don't block main thread
4. **Mobile compatibility**: Test on lower-end devices

### Integration Testing

1. **Game state synchronization**: Verify animations respond to game events
2. **Perfect placement effects**: Test enhanced animations for perfect blocks
3. **Game over scenarios**: Ensure animations handle state transitions
4. **Audio synchronization**: Verify visual effects complement audio feedback

## Implementation Details

### Animation Phases

1. **Initialization Phase**

   - Create outline geometries for each placed block
   - Initialize animation state and timing
   - Set up shader materials with appropriate uniforms

2. **Update Phase** (per frame)

   - Calculate dash offset based on elapsed time
   - Update flow speed based on game momentum
   - Manage connection paths between adjacent blocks
   - Apply performance optimizations

3. **Render Phase**
   - Update shader uniforms
   - Render outline geometries with animated materials
   - Apply post-processing effects if needed

### Flow Pattern Algorithms

```typescript
// Clockwise flow around block perimeter
function calculateClockwiseOffset(time: number, speed: number): number {
  return (time * speed) % (Math.PI * 2);
}

// Connection flow between blocks
function calculateConnectionFlow(startBlock: Block, endBlock: Block, time: number): number {
  const distance = calculateBlockDistance(startBlock, endBlock);
  const flowTime = (time * 2.0) % 1.0; // Normalize to 0-1
  return flowTime * distance;
}

// Bidirectional flow with phase offset
function calculateBidirectionalFlow(time: number, phaseOffset: number): number {
  return Math.sin(time + phaseOffset) * 0.5 + 0.5;
}
```

### Performance Optimizations

1. **Geometry Instancing**: Reuse outline geometries for similar block shapes
2. **Material Pooling**: Share shader materials across multiple outlines
3. **LOD System**: Reduce animation complexity for distant blocks
4. **Culling**: Skip animation updates for off-screen blocks
5. **Batch Updates**: Group shader uniform updates to minimize GPU state changes

### Integration with Existing Systems

- **TronBackground**: Synchronize grid animation timing with outline flow
- **PerfectPlacementEffects**: Enhance perfect placement animations
- **GameState**: React to game events for animation intensity changes
- **Audio System**: Coordinate visual flow with audio feedback timing
