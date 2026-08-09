# Components Directory Structure

This directory contains all React components for the Stonefall client application, organized into logical subdirectories for improved maintainability and discoverability.

## Directory Structure

### 📱 `ui/`
User interface components - modals, HUD elements, controls, and overlays.

- **GameUI.tsx** - Main game UI with menus and modals
- **TronHud.tsx** - Heads-up display for score/combo tracking
- **TournamentOverlay.tsx** - Tournament mode overlay
- **GameEndControls.tsx** - Game end screen controls
- **ChunkLoadingIndicator.tsx** - Loading indicator for chunks
- **InlineGridDisplay.tsx** - Grid display for tower viewing
- **CycleScrubber.tsx** - Cycle scrubber UI component
- **GameBalanceBar.tsx** - Balance bar display
- **TowerCountDisplay.tsx** - Online tower count display
- **TronModalLogo.tsx** - Modal logo component
- **gameEndModal.css** - Game end modal styles

### 🎮 `game/`
Core game rendering components - scene management, block rendering, and GPU-optimized systems.

- **GameScene_Simple.tsx** - Main game scene and physics loop
- **GameBlock_Simple.tsx** - Individual game block component
- **GPUGameBlocks.tsx** - GPU instanced block rendering for active gameplay
- **GPUInstancedTowerSystem.tsx** - GPU instanced tower rendering system
- **InstancedTowerRenderer.tsx** - High-performance tower renderer

### ✨ `effects/`
Visual effects components - particles, backgrounds, glows, and animations.

- **TronBackground.tsx** - Tron-style grid background
- **TronClearDisintegration.tsx** - Block clear disintegration effect
- **TronLegacyParticles.tsx** - Tron-style particle effects
- **FloatingParticles.tsx** - Floating particle system
- **GrowthEffects.tsx** - Block growth animation effects
- **TrimEffects.tsx** - Block trim animation effects
- **PerfectPlacementGlow.tsx** - Perfect placement glow effect
- **EffectsRenderer.tsx** - Post-processing effects renderer

### 🔊 `audio/`
Audio management components - sound effects and music systems.

- **AudioPlayer.ts** - Core audio playback system
- **TowerAudioManager.ts** - Tower-specific audio management

### 🗼 `tower/`
Tower-specific components - visualization, camera control, and map display.

- **TowerMap.tsx** - Tower map display component
- **TowerVisualization.tsx** - 3D tower visualization
- **TowerCameraController.tsx** - Tower camera controls

### ⚙️ `system/`
System utilities - performance monitoring, geometry batching, and app state.

- **GeometryBatcher.ts** - Geometry batching utility for performance
- **PerformanceConnector.tsx** - Performance monitoring connector
- **AppStateMonitor.tsx** - Application state monitoring

## Import Guidelines

When importing components from these directories:

```typescript
// From the client root (e.g., App.tsx)
import { GameUI } from './components/ui/GameUI';
import { GameScene } from './components/game/GameScene_Simple';

// From within a component subdirectory
import { AudioPlayer } from '../audio/AudioPlayer';  // Same level sibling
import { GameState } from '../../../shared/simulation';  // Up to shared
import { useGameState } from '../../hooks/useGameState';  // Up to client
```

## Benefits of This Structure

1. **Improved Navigation** - Find components faster by category
2. **Better Maintainability** - Related components are grouped together
3. **Clearer Dependencies** - Easier to see component relationships
4. **Easier Onboarding** - New developers can understand the codebase structure quickly
5. **Better IDE Support** - Auto-complete and search work better with organized directories

## Adding New Components

When adding a new component:

1. Determine its primary purpose (UI, game rendering, effects, etc.)
2. Place it in the appropriate subdirectory
3. Update this README if adding a significant new component
4. Ensure import paths are correct relative to the component's location
