import type { Quality } from '../../shared/types/settings';

/**
 * What the Quality setting changes, for a phone that cannot keep up with the full frame.
 *
 * The look is the glow, so Low keeps the bloom exactly as it is and draws less under it: at most
 * one pixel per CSS pixel instead of one and a half (under half the pixels on a phone, and the
 * bloom's buffers shrink with them), and no multisampling on the composer's frame, which at the
 * library's eight samples is most of the memory traffic a frame costs. Edges come out a little
 * harder. High is the game as it has always drawn.
 */

/** Canvas pixel ratio, lowest and highest: the device's own, held between the two. */
export const canvasDpr = (quality: Quality): [number, number] =>
  quality === 'low' ? [0.5, 1] : [0.7, 1.5];

/** Samples for the bloom composer's frame; 8 is the library's default. */
export const composerSamples = (quality: Quality): number => (quality === 'low' ? 0 : 8);
