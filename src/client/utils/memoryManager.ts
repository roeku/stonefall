// Memory management utilities for performance optimization

export class MemoryManager {
  private static instance: MemoryManager;
  private cleanupTasks: (() => void)[] = [];
  private cleanupInterval: NodeJS.Timeout | null = null;

  static getInstance(): MemoryManager {
    if (!MemoryManager.instance) {
      MemoryManager.instance = new MemoryManager();
    }
    return MemoryManager.instance;
  }

  constructor() {
    this.startCleanupInterval();
  }

  // Register a cleanup task
  registerCleanupTask(task: () => void): void {
    this.cleanupTasks.push(task);
  }

  // Remove a cleanup task
  unregisterCleanupTask(task: () => void): void {
    const index = this.cleanupTasks.indexOf(task);
    if (index > -1) {
      this.cleanupTasks.splice(index, 1);
    }
  }

  // Run all cleanup tasks
  runCleanup(): void {
    this.cleanupTasks.forEach((task) => {
      try {
        task();
      } catch (error) {
        console.warn('Cleanup task failed:', error);
      }
    });

    // Clean up global debug events
    this.cleanupDebugEvents();

    // Clean up any lingering timeouts/intervals
    this.cleanupTimers();
  }

  private cleanupDebugEvents(): void {
    try {
      const g = globalThis as any;
      if (g.__DEBUG_EVENTS && Array.isArray(g.__DEBUG_EVENTS)) {
        // Keep only the last 50 events
        if (g.__DEBUG_EVENTS.length > 50) {
          g.__DEBUG_EVENTS = g.__DEBUG_EVENTS.slice(-50);
        }
      }
    } catch (error) {
      // Ignore cleanup errors
    }
  }

  private cleanupTimers(): void {
    // This is a bit hacky, but we can track timer IDs if needed
    // For now, we'll just log that cleanup is happening
    console.log('🧹 Memory cleanup completed');
  }

  private startCleanupInterval(): void {
    // Run cleanup every 30 seconds
    this.cleanupInterval = setInterval(() => {
      this.runCleanup();
    }, 30000);
  }

  // Stop the cleanup interval (call on app unmount)
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.cleanupTasks = [];
  }

  // Get memory usage information
  getMemoryInfo(): { used: number; total: number; percentage: number } | null {
    if ('memory' in performance) {
      const memory = (performance as any).memory;
      return {
        used: Math.round(memory.usedJSHeapSize / 1024 / 1024), // MB
        total: Math.round(memory.totalJSHeapSize / 1024 / 1024), // MB
        percentage: Math.round((memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100),
      };
    }
    return null;
  }

  // Force garbage collection if available
  forceGC(): void {
    if ('gc' in window) {
      (window as any).gc();
      console.log('🗑️ Forced garbage collection');
    }
  }
}

// Utility functions for common cleanup tasks
export const createTimeoutCleanup = (timeouts: NodeJS.Timeout[]) => {
  return () => {
    timeouts.forEach((timeout) => clearTimeout(timeout));
    timeouts.length = 0;
  };
};

export const createIntervalCleanup = (intervals: NodeJS.Timeout[]) => {
  return () => {
    intervals.forEach((interval) => clearInterval(interval));
    intervals.length = 0;
  };
};

export const createEventListenerCleanup = (
  element: EventTarget,
  eventType: string,
  listener: EventListener
) => {
  return () => {
    element.removeEventListener(eventType, listener);
  };
};

// Hook for using memory manager in React components
export const useMemoryManager = () => {
  const manager = MemoryManager.getInstance();

  React.useEffect(() => {
    return () => {
      // Component cleanup
      manager.runCleanup();
    };
  }, [manager]);

  return {
    registerCleanup: (task: () => void) => manager.registerCleanupTask(task),
    unregisterCleanup: (task: () => void) => manager.unregisterCleanupTask(task),
    runCleanup: () => manager.runCleanup(),
    getMemoryInfo: () => manager.getMemoryInfo(),
    forceGC: () => manager.forceGC(),
  };
};

// Import React for the hook
import React from 'react';
