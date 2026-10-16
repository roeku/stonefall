/**
 * The bloom's numbers, apart from the React pass so tools/promo/pipeline.ts can take the same
 * ones without pulling React in. Every other setting is the library's default (Kawase blur,
 * large kernel, half resolution), additive.
 */
export interface BloomLook {
  intensity: number;
  luminanceThreshold: number;
  luminanceSmoothing: number;
}

/** The run's: every rim a hot line with a wide halo, on a tower seen from a few blocks away. */
export const RUN_BLOOM: BloomLook = {
  intensity: 1.2,
  luminanceThreshold: 0.1,
  luminanceSmoothing: 0.4,
};

/**
 * The board's. The run's halo is a fraction of a block wide at run distance, but from over the
 * map it is wider than a tower, and since each colour gathers round its keep the towers stand
 * shoulder to shoulder: their halos summed into one haze, pastel at best and white at the
 * centre, and the colour that says whose tower it is was lost. On the plot the floor's tiles and
 * a keep's tall stack lit the whole frame grey. So only what is properly bright blooms, and less:
 * rims still glow, bodies and the floor do not, and a crowded quarter reads as towers.
 */
export const BOARD_BLOOM: BloomLook = {
  intensity: 0.6,
  luminanceThreshold: 0.3,
  luminanceSmoothing: 0.3,
};
