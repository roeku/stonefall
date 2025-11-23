export type RGBColor = { r: number; g: number; b: number };

export const USERS_GRID_COLOR: RGBColor = { r: 36, g: 200, b: 255 };
export const PROGRAMS_GRID_COLOR: RGBColor = { r: 255, g: 69, b: 0 }; // Legacy orangered tint

const clampColorComponent = (value: number): number => Math.min(255, Math.max(0, value));
const componentToHex = (value: number): string =>
  clampColorComponent(value).toString(16).padStart(2, '0');
const rgbToHex = (color: RGBColor): string =>
  `#${componentToHex(color.r)}${componentToHex(color.g)}${componentToHex(color.b)}`;

export const mixGridTintHex = (bluePercentage?: number | null): string | undefined => {
  if (typeof bluePercentage !== 'number' || Number.isNaN(bluePercentage)) {
    return undefined;
  }

  const clampedBlue = Math.min(100, Math.max(0, bluePercentage));
  const blueRatio = clampedBlue / 100;
  const orangeRatio = 1 - blueRatio;

  const mixedColor: RGBColor = {
    r: Math.round(PROGRAMS_GRID_COLOR.r * orangeRatio + USERS_GRID_COLOR.r * blueRatio),
    g: Math.round(PROGRAMS_GRID_COLOR.g * orangeRatio + USERS_GRID_COLOR.g * blueRatio),
    b: Math.round(PROGRAMS_GRID_COLOR.b * orangeRatio + USERS_GRID_COLOR.b * blueRatio),
  };

  return rgbToHex(mixedColor);
};
