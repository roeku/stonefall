/**
 * How far the relay's scene is squashed in height, 1 at true scale. Written by GameScene every
 * frame while the whole tower is shown (its `overview`), read by RelayNeighbours, so the towers
 * behind keep their heights against the one in front.
 */
export const OVERVIEW_SQUASH = { value: 1 };
