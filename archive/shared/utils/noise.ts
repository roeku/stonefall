/**
 * Shared noise utility functions for procedural generation and animation
 */

/**
 * Simple hash function for noise generation
 */
export function hash(n: number): number {
  return Math.sin(n) * 43758.5453123 - Math.floor(Math.sin(n) * 43758.5453123);
}

/**
 * 2D value noise function for smooth, non-repeating motion
 */
export function valueNoise2(x: number, y: number): number {
  // grid cell
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;

  const s00 = hash(xi + yi * 57);
  const s10 = hash(xi + 1 + yi * 57);
  const s01 = hash(xi + (yi + 1) * 57);
  const s11 = hash(xi + 1 + (yi + 1) * 57);

  // smoothstep interpolation
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);

  const a = s00 * (1 - u) + s10 * u;
  const b = s01 * (1 - u) + s11 * u;

  return a * (1 - v) + b * v;
}

/**
 * 3D value noise function for volumetric effects
 */
export function valueNoise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = x - xi;
  const yf = y - yi;
  const zf = z - zi;

  const s000 = hash(xi + yi * 57 + zi * 113);
  const s100 = hash(xi + 1 + yi * 57 + zi * 113);
  const s010 = hash(xi + (yi + 1) * 57 + zi * 113);
  const s110 = hash(xi + 1 + (yi + 1) * 57 + zi * 113);
  const s001 = hash(xi + yi * 57 + (zi + 1) * 113);
  const s101 = hash(xi + 1 + yi * 57 + (zi + 1) * 113);
  const s011 = hash(xi + (yi + 1) * 57 + (zi + 1) * 113);
  const s111 = hash(xi + 1 + (yi + 1) * 57 + (zi + 1) * 113);

  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = zf * zf * (3 - 2 * zf);

  const a0 = s000 * (1 - u) + s100 * u;
  const b0 = s010 * (1 - u) + s110 * u;
  const a1 = s001 * (1 - u) + s101 * u;
  const b1 = s011 * (1 - u) + s111 * u;

  const c0 = a0 * (1 - v) + b0 * v;
  const c1 = a1 * (1 - v) + b1 * v;

  return c0 * (1 - w) + c1 * w;
}
