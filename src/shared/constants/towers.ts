export const MAX_VISIBLE_TOWERS = 5000; // Increased to support larger daily cycles

/**
 * Cap on how many towers one player can keep placed.
 *
 * Bounds both storage and how much of the community view a single player can occupy. Reaching
 * the cap doesn't block play; it means removing something before placing something new.
 */
export const MAX_PLACEMENTS_PER_PLAYER = 50;

// Multiplier describing how much empty space we want beyond the tower count
export const DEFAULT_TOWER_GRID_DENSITY = 3.14159265359;

export const computeGridCapacityForRadius = (radius: number): number => {
  const safeRadius = Math.max(0, Math.floor(radius));
  if (safeRadius === 0) {
    return 1;
  }

  let capacity = 0;
  for (let x = -safeRadius; x <= safeRadius; x++) {
    for (let z = -safeRadius; z <= safeRadius; z++) {
      if (Math.hypot(x, z) <= safeRadius) {
        capacity += 1;
      }
    }
  }

  return Math.max(1, capacity);
};

export const computeGridRadiusForCapacity = (
  towerCount: number,
  density: number = DEFAULT_TOWER_GRID_DENSITY
): number => {
  if (!Number.isFinite(towerCount) || towerCount <= 0) {
    return 1;
  }

  const safeDensity =
    Number.isFinite(density) && density > 0 ? density : DEFAULT_TOWER_GRID_DENSITY;
  const desiredSlots = Math.ceil(towerCount * safeDensity);

  let radius = Math.max(1, Math.ceil(Math.sqrt(desiredSlots / Math.PI)));
  while (computeGridCapacityForRadius(radius) < desiredSlots) {
    radius += 1;
  }

  return radius;
};
