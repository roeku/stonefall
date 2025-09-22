// Fixed-point math utilities for deterministic calculations
export class FixedMath {
  // Fixed-point multiplication: (a * b) / scale
  static multiply(a: number, b: number, scale: number = 1000): number {
    // Use standard JavaScript math to avoid BigInt conversion issues
    return Math.floor((a * b) / scale);
  }

  // Fixed-point division: (a * scale) / b
  static divide(a: number, b: number, scale: number = 1000): number {
    if (b === 0) return 0;
    return Math.floor((a * scale) / b);
  }

  // Convert float to fixed-point
  static fromFloat(value: number, scale: number = 1000): number {
    return Math.round(value * scale);
  }

  // Convert fixed-point to float
  static toFloat(value: number, scale: number = 1000): number {
    return value / scale;
  }

  // Fixed-point square root approximation using Newton's method
  static sqrt(value: number, scale: number = 1000): number {
    if (value <= 0) return 0;

    let x = value;
    let prev = 0;

    // Newton's method: x_new = (x + value/x) / 2
    // Simplified to avoid BigInt issues
    while (Math.abs(x - prev) > 1) {
      prev = x;
      x = Math.floor((x + Math.floor((value * scale) / x)) / 2);
    }

    return Math.floor(x);
  }

  // Pre-computed sine table for performance (0-360 degrees in millidegrees)
  private static readonly SIN_TABLE = (() => {
    const table: number[] = [];
    for (let i = 0; i < 360000; i += 100) {
      // Every 0.1 degree
      table.push(Math.round(Math.sin(((i / 1000) * Math.PI) / 180) * 1000));
    }
    return table;
  })();

  // Fixed-point sine lookup (angle in millidegrees)
  static sin(angleMilli: number): number {
    // Normalize angle to [0, 360000)
    const normalized = ((angleMilli % 360000) + 360000) % 360000;
    const index = Math.floor(normalized / 100);
    return FixedMath.SIN_TABLE[index] || 0;
  }

  // Fixed-point cosine lookup (angle in millidegrees)
  static cos(angleMilli: number): number {
    // cos(x) = sin(x + 90°)
    return FixedMath.sin(angleMilli + 90000);
  }

  // Clamp value to range [min, max]
  static clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  // Linear interpolation
  static lerp(a: number, b: number, t: number, scale: number = 1000): number {
    return a + Math.floor(((b - a) * t) / scale);
  }
}
