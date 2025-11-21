export const MAX_VISIBLE_TOWERS = 1000;

// Multiplier describing how much empty space we want beyond the tower count
export const DEFAULT_TOWER_GRID_DENSITY = 1.61803398875;

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
