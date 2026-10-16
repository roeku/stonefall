/**
 * How far the relay's scene is squashed in height, 1 at true scale. Written by GameScene every
 * frame while the whole tower is shown (its `overview`), read by RelayNeighbours, so the towers
 * behind keep their heights against the one in front.
 */
export const OVERVIEW_SQUASH = { value: 1 };

/**
 * What the waiting view shows of a tall tower: its top, the latest OVERVIEW_RECENT blocks at
 * their true size, or the whole of it, squashed to fit (GameScene OVERVIEW_MAX_HEIGHT). The
 * player picks; the top is where a tower opens.
 */
export type TowerView = 'top' | 'whole';

/** Blocks the top view shows. A tower no taller has nothing more to show, and no choice. */
export const OVERVIEW_RECENT = 100;
