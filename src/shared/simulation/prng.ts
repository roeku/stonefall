// Deterministic pseudo-random number generator using xorshift32
export class PRNG {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0; // Ensure unsigned 32-bit
    if (this.state === 0) {
      this.state = 1; // Avoid zero seed
    }
  }

  // Generate next pseudo-random uint32
  next(): number {
    this.state ^= this.state << 13;
    this.state ^= this.state >>> 17;
    this.state ^= this.state << 5;
    return this.state >>> 0; // Ensure unsigned
  }

  // Generate random integer in range [min, max) using fixed-point
  range(min: number, max: number): number {
    const range = max - min;
    if (range <= 0) return min;

    // Use rejection sampling for uniform distribution
    const maxValidValue = Math.floor(0xffffffff / range) * range;
    let value;
    do {
      value = this.next();
    } while (value >= maxValidValue);

    return min + (value % range);
  }

  // Generate random float [0, 1) equivalent in fixed-point
  nextFloat(scale: number = 1000): number {
    return this.next() % (scale + 1);
  }
}
