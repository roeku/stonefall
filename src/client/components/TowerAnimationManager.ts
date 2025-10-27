// Tower rise/sink animation system for dynamic loading
import * as THREE from 'three';

export interface AnimatedTower {
  towerId: string;
  targetY: number;
  currentY: number;
  animationState: 'rising' | 'visible' | 'sinking' | 'hidden';
  animationProgress: number;
  animationSpeed: number;
}

export class TowerAnimationManager {
  private animatedTowers = new Map<string, AnimatedTower>();
  private animationDuration = 2.0; // 2 seconds for rise/sink

  // Start tower rising animation
  startRising(towerId: string, targetY: number, startDelay = 0): void {
    const existing = this.animatedTowers.get(towerId);
    const startY = existing?.currentY ?? -50; // Start underground

    this.animatedTowers.set(towerId, {
      towerId,
      targetY,
      currentY: startY,
      animationState: 'rising',
      animationProgress: 0,
      animationSpeed: 1 / this.animationDuration,
    });

    // Add staggered delay for multiple towers
    if (startDelay > 0) {
      setTimeout(() => {
        const tower = this.animatedTowers.get(towerId);
        if (tower && tower.animationState === 'rising') {
          tower.animationProgress = 0;
        }
      }, startDelay);
    }
  }

  // Start tower sinking animation
  startSinking(towerId: string): void {
    const tower = this.animatedTowers.get(towerId);
    if (!tower) return;

    tower.animationState = 'sinking';
    tower.animationProgress = 0;
  }

  // Update all tower animations
  updateAnimations(deltaTime: number): void {
    this.animatedTowers.forEach((tower, towerId) => {
      if (tower.animationState === 'visible' || tower.animationState === 'hidden') {
        return; // No animation needed
      }

      tower.animationProgress += tower.animationSpeed * deltaTime;

      if (tower.animationState === 'rising') {
        // Smooth ease-out animation
        const progress = Math.min(1, tower.animationProgress);
        const eased = 1 - Math.pow(1 - progress, 3);

        tower.currentY = THREE.MathUtils.lerp(-50, tower.targetY, eased);

        if (progress >= 1) {
          tower.animationState = 'visible';
          tower.currentY = tower.targetY;
        }
      } else if (tower.animationState === 'sinking') {
        // Smooth ease-in animation
        const progress = Math.min(1, tower.animationProgress);
        const eased = Math.pow(progress, 2);

        tower.currentY = THREE.MathUtils.lerp(tower.targetY, -50, eased);

        if (progress >= 1) {
          tower.animationState = 'hidden';
          tower.currentY = -50;
          // Mark for removal
          this.animatedTowers.delete(towerId);
        }
      }
    });
  }

  // Get current Y position for tower
  getTowerY(towerId: string): number | null {
    const tower = this.animatedTowers.get(towerId);
    return tower ? tower.currentY : null;
  }

  // Check if tower is visible (not hidden or sinking)
  isTowerVisible(towerId: string): boolean {
    const tower = this.animatedTowers.get(towerId);
    return tower ? tower.animationState === 'visible' || tower.animationState === 'rising' : false;
  }

  // Get animation state
  getTowerState(towerId: string): string | null {
    const tower = this.animatedTowers.get(towerId);
    return tower ? tower.animationState : null;
  }

  // Remove tower from animation system
  removeTower(towerId: string): void {
    this.animatedTowers.delete(towerId);
  }

  // Get all animated towers
  getAllAnimatedTowers(): AnimatedTower[] {
    return Array.from(this.animatedTowers.values());
  }

  // Cleanup finished animations
  cleanup(): void {
    const toRemove: string[] = [];
    this.animatedTowers.forEach((tower, towerId) => {
      if (tower.animationState === 'hidden') {
        toRemove.push(towerId);
      }
    });
    toRemove.forEach((id) => this.animatedTowers.delete(id));
  }
}
