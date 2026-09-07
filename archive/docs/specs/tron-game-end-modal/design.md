# Tron: Legacy Game End Modal - Design Document

## Overview

The Tron Game End Modal is a sophisticated overlay component that appears when a player completes a game session. It serves as both a results display and an engagement gateway, featuring progressive content loading, advanced animations, and a minimization system. The design strictly adheres to the established Tron: Legacy aesthetic, building upon the proven data-ribbon design patterns.

The modal operates in three primary states: **Opening** (with progressive content loading), **Active** (full display), and **Minimized** (collapsed to bottom-right corner). Each state transition uses carefully choreographed animations that reinforce the futuristic, high-tech atmosphere.

## Architecture

### Component Structure

```
GameEndModal/
├── GameEndModal.tsx          # Main modal component
├── GameEndModalContent.tsx   # Content sections with loading states
├── MinimizedIndicator.tsx    # Bottom-right minimized state
└── gameEndModal.css         # Tron-styled animations and layouts
```

### State Management

The modal uses a finite state machine approach:

```typescript
type ModalState = 'hidden' | 'opening' | 'active' | 'closing' | 'minimized';

interface GameEndModalState {
  modalState: ModalState;
  contentLoaded: {
    playerStats: boolean;
    rankData: boolean;
    congratsMessage: boolean;
    actionButtons: boolean;
  };
  playerData: {
    rank?: number;
    username: string;
    score: number;
    blocks: number;
    perfectStreak: number;
  };
}
```

### Integration Points

- **Trigger**: Game state `isGameOver` becomes true
- **Data Source**: Existing game state + server session data
- **Parent Component**: App.tsx (same level as existing UI overlays)
- **Z-Index Layer**: Above UnifiedTowerSystem, below critical system modals

## Components and Interfaces

### GameEndModal Component

```typescript
interface GameEndModalProps {
  isVisible: boolean;
  gameState: GameState;
  playerTower?: TowerMapEntry;
  onPlayAgain: () => void;
  onShare: (sessionData: GameSessionData) => void;
  onMinimize: () => void;
}

export const GameEndModal: React.FC<GameEndModalProps> = ({
  isVisible,
  gameState,
  playerTower,
  onPlayAgain,
  onShare,
  onMinimize,
}) => {
  // State management for modal phases and content loading
  // Progressive content loading logic
  // Animation orchestration
};
```

### Content Sections

#### Player Info Section

```typescript
interface PlayerInfoSectionProps {
  rank?: number;
  username: string;
  isLoaded: boolean;
}

// Displays rank badge + username with loading states
// Uses established golden rank badge styling
// Includes loading shimmer effects
```

#### Statistics Section

```typescript
interface StatsSectionProps {
  score: number;
  blocks: number;
  perfectStreak: number;
  isLoaded: boolean;
}

// Three-column layout: Score | Blocks | Perfect
// Uses data-ribbon formatting patterns
// Animated number counting when data loads
```

#### Congratulations Section

```typescript
interface CongratsSection {
  isLoaded: boolean;
}

// Block icon + congratulations message
// Bordered container with grid patterns
// Slide-in animation with scanning effects
```

#### Action Buttons Section

```typescript
interface ActionButtonsProps {
  onPlayAgain: () => void;
  onShare: () => void;
  isLoaded: boolean;
}

// "Try Again" and "Boast" buttons
// Tron-style borders and hover effects
// Power-up animation when becoming active
```

### MinimizedIndicator Component

```typescript
interface MinimizedIndicatorProps {
  onClick: () => void;
  playerRank?: number;
}

// Small circular indicator in bottom-right
// Shows rank badge or game icon
// Subtle pulsing glow animation
// Click to reopen modal
```

## Data Models

### Modal Animation Phases

```typescript
interface AnimationPhase {
  name: string;
  duration: number;
  delay: number;
  easing: string;
}

const OPENING_PHASES: AnimationPhase[] = [
  { name: 'backdrop-fade', duration: 300, delay: 0, easing: 'ease-out' },
  {
    name: 'container-scale',
    duration: 500,
    delay: 100,
    easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  },
  { name: 'scanning-lines', duration: 800, delay: 200, easing: 'linear' },
  { name: 'content-reveal', duration: 400, delay: 300, easing: 'ease-out' },
];

const CLOSING_PHASES: AnimationPhase[] = [
  { name: 'content-stagger-out', duration: 600, delay: 0, easing: 'ease-in' },
  {
    name: 'container-collapse',
    duration: 800,
    delay: 400,
    easing: 'cubic-bezier(0.55, 0.055, 0.675, 0.19)',
  },
  {
    name: 'minimize-to-corner',
    duration: 500,
    delay: 800,
    easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
  },
];
```

### Content Loading States

```typescript
interface LoadingState {
  isLoading: boolean;
  hasError: boolean;
  data?: any;
  loadedAt?: number;
}

interface ContentStates {
  playerStats: LoadingState;
  rankData: LoadingState;
  sessionData: LoadingState;
}
```

## Visual Design Specifications

### Layout Structure

```
┌─────────────────────────────────────────────────────────────┐
│  ╔═══════════════════════════════════════════════════════╗  │
│  ║                                                   [X] ║  │
│  ║   [#3] USERNAME                                       ║  │
│  ║                                                       ║  │
│  ║   Score        Blocks        Perfect                  ║  │
│  ║   5555         55            2                        ║  │
│  ║                                                       ║  │
│  ║  ┌─────────────────────────────────────────────────┐  ║  │
│  ║  │ [□] Congrats                                    │  ║  │
│  ║  │     You made it onto the grid! You've           │  ║  │
│  ║  │     proven yourself worthy!                     │  ║  │
│  ║  └─────────────────────────────────────────────────┘  ║  │
│  ║                                                       ║  │
│  ║   [Try Again]              [Boast]                    ║  │
│  ╚═══════════════════════════════════════════════════════╝  │
└─────────────────────────────────────────────────────────────┘
```

### Color Palette

```css
:root {
  /* Primary Tron Colors */
  --tron-cyan: #00ffff;
  --tron-orange: #ff6600;
  --tron-gold: #ffd700;

  /* Modal Specific */
  --modal-backdrop: rgba(0, 0, 0, 0.85);
  --modal-border: rgba(0, 255, 255, 0.6);
  --modal-bg: linear-gradient(135deg, rgba(0, 20, 40, 0.95), rgba(0, 0, 0, 0.98));

  /* Content Areas */
  --content-border: rgba(0, 255, 255, 0.4);
  --content-bg: rgba(0, 255, 255, 0.02);

  /* Loading States */
  --loading-shimmer: linear-gradient(90deg, transparent, rgba(0, 255, 255, 0.1), transparent);
}
```

### Typography Hierarchy

```css
.tron-modal-title {
  font-family: 'Orbitron', monospace;
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.tron-modal-stats {
  font-family: 'Orbitron', monospace;
  font-size: 32px;
  font-weight: 900;
  font-feature-settings: 'tnum';
}

.tron-modal-labels {
  font-family: 'Orbitron', monospace;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.15em;
  text-transform: uppercase;
}

.tron-modal-message {
  font-family: 'Orbitron', monospace;
  font-size: 16px;
  font-weight: 500;
  line-height: 1.4;
}
```

## Animation Specifications

### Opening Sequence

1. **Backdrop Fade** (0-300ms)

   - Semi-transparent overlay fades in
   - `opacity: 0 → 0.85`

2. **Container Scale** (100-600ms)

   - Modal container scales from center
   - `transform: scale(0.8) → scale(1)`
   - Slight overshoot for dynamic feel

3. **Border Scanning** (200-1000ms)

   - Animated border lines trace the modal perimeter
   - Cyan glow effect follows the scanning line
   - Multiple passes with decreasing intensity

4. **Content Reveal** (300-700ms)
   - Content sections appear with staggered timing
   - Each section slides in from different directions
   - Loading placeholders for pending data

### Progressive Content Loading

```css
@keyframes contentAppear {
  0% {
    opacity: 0;
    transform: translateY(20px);
  }
  100% {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes rankBadgeGlow {
  0% {
    box-shadow: 0 0 8px rgba(255, 215, 0, 0.4);
  }
  50% {
    box-shadow: 0 0 20px rgba(255, 215, 0, 0.8);
  }
  100% {
    box-shadow: 0 0 8px rgba(255, 215, 0, 0.4);
  }
}

@keyframes numberCount {
  0% {
    transform: scale(0.8);
    opacity: 0;
  }
  50% {
    transform: scale(1.1);
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}
```

### Closing Sequence

1. **Content Stagger Out** (0-600ms)

   - Elements disappear in reverse order of appearance
   - Each element fades and slides out
   - Scanning lines reverse direction

2. **Container Collapse** (400-1200ms)

   - Modal container shrinks toward bottom-right
   - Maintains aspect ratio during collapse
   - Border effects intensify during collapse

3. **Minimize to Corner** (800-1300ms)
   - Final collapse to small circular indicator
   - Position: `bottom: 20px, right: 20px`
   - Subtle pulsing glow to indicate interactivity

### Loading State Animations

```css
@keyframes shimmerLoading {
  0% {
    background-position: -200px 0;
  }
  100% {
    background-position: calc(200px + 100%) 0;
  }
}

.tron-loading-placeholder {
  background: linear-gradient(
    90deg,
    rgba(0, 255, 255, 0.1) 0%,
    rgba(0, 255, 255, 0.2) 50%,
    rgba(0, 255, 255, 0.1) 100%
  );
  background-size: 200px 100%;
  animation: shimmerLoading 1.5s infinite;
}
```

## Error Handling

### Loading Failures

- **Rank Data Unavailable**: Show "?" in rank badge with subtle error styling
- **Session Save Failed**: Display retry option in action buttons
- **Network Timeout**: Graceful degradation with cached game state data
- **Partial Data**: Progressive display of available information

### Animation Failures

- **Reduced Motion Preference**: Respect `prefers-reduced-motion` media query
- **Performance Issues**: Fallback to simpler animations on low-end devices
- **CSS Animation Support**: Graceful degradation for older browsers

## Testing Strategy

### Visual Regression Testing

- Screenshot comparisons for each modal state
- Animation frame testing for smooth transitions
- Cross-browser compatibility verification
- Mobile responsiveness validation

### Interaction Testing

- Modal opening/closing sequences
- Progressive content loading scenarios
- Minimize/restore functionality
- Keyboard navigation and accessibility
- Touch interaction on mobile devices

### Performance Testing

- Animation frame rate monitoring
- Memory usage during state transitions
- Loading time measurements
- Stress testing with rapid state changes

### Integration Testing

- Game state integration verification
- Server data loading scenarios
- Error state handling
- Concurrent modal interactions

## Accessibility Considerations

### Keyboard Navigation

- Tab order: Close button → Action buttons → Minimize
- Escape key closes modal
- Enter/Space activates focused buttons
- Focus trap within modal when active

### Screen Reader Support

```html
<div
  role="dialog"
  aria-labelledby="modal-title"
  aria-describedby="modal-description"
  aria-modal="true"
>
  <h2 id="modal-title">Game Results</h2>
  <div id="modal-description">Your tower defense game statistics and achievements</div>
</div>
```

### Visual Accessibility

- High contrast mode support
- Reduced motion preferences
- Focus indicators with sufficient contrast
- Text scaling compatibility
- Color-blind friendly design (not relying solely on color for information)

## Performance Optimization

### Animation Performance

- Use `transform` and `opacity` for animations (GPU acceleration)
- Avoid layout-triggering properties during animations
- Implement `will-change` hints for animated elements
- Use `transform3d()` to force hardware acceleration

### Memory Management

- Clean up animation timers on component unmount
- Lazy load heavy visual effects
- Optimize CSS animations with efficient selectors
- Implement animation frame throttling for complex sequences

### Loading Optimization

- Prioritize critical content (player stats) over secondary data
- Implement progressive enhancement for visual effects
- Cache frequently accessed data
- Use efficient state update patterns to minimize re-renders
