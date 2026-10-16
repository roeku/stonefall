import { useEffect, type RefObject } from 'react';
import { isInlineOnReddit } from '../utils/platform';

/**
 * The grab tool's hands: a drag on the world turns the camera round its subject and tips it, two
 * fingers pinch the zoom, and a mouse wheel zooms.
 *
 * Only while the tool is on, and never inline in the feed: there a drag or a wheel is the feed's,
 * to scroll past the post, and the tool opens the post full screen instead (BoardChrome). Checked
 * on every press as well as when the tool is turned on, because a post that went full screen can
 * come back inline with the tool still on.
 *
 * A drag is a drag only once it has moved further than a tap would, so a tap with the tool on
 * still picks a tower; and the click a drag ends with is not taken for a tap (`justDragged`).
 */

/** Radians the camera turns for a drag across the whole width of the frame. */
const TURN_PER_WIDTH = Math.PI * 1.2;
/** Radians it tips for a drag down the whole height. */
const TIP_PER_HEIGHT = 1.5;
/** Pixels a press may wander and still be a tap. */
const TAP_SLOP = 7;
/** Zoom factor for a hundred pixels of wheel. */
const WHEEL_ZOOM = 1.15;
/** How long after a drag a click is still the drag's, ms. */
const AFTER_DRAG_MS = 300;

let draggedAt = -Infinity;

/** True just after a drag, so the click that ends it does not also pick what it ended on. */
export const justDragged = (): boolean => performance.now() - draggedAt < AFTER_DRAG_MS;

export const useOrbitDrag = (
  target: RefObject<HTMLElement | null>,
  on: boolean,
  orbitBy: (yaw: number, tilt: number) => void,
  zoomBy: (factor: number) => void
): void => {
  useEffect(() => {
    const el = target.current;
    if (!el || !on) return;
    const pointers = new Map<number, { x: number; y: number }>();
    let start: { x: number; y: number } | null = null;
    let dragging = false;
    let spread = 0;

    const spreadNow = (): number => {
      const [a, b] = [...pointers.values()];
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    };

    const onDown = (e: PointerEvent) => {
      if (!(e.target instanceof HTMLCanvasElement) || isInlineOnReddit()) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        start = { x: e.clientX, y: e.clientY };
        dragging = false;
      } else if (pointers.size === 2) {
        spread = spreadNow();
      }
      try {
        e.target.setPointerCapture(e.pointerId);
      } catch {
        // A pointer that is already gone has nothing to capture.
      }
    };

    const onMove = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (pointers.size >= 2) {
        const next = spreadNow();
        if (spread > 0 && next > 0) zoomBy(spread / next);
        spread = next;
        dragging = true;
        draggedAt = performance.now();
        return;
      }
      if (!dragging) {
        if (!start || Math.hypot(e.clientX - start.x, e.clientY - start.y) < TAP_SLOP) return;
        dragging = true;
      }
      draggedAt = performance.now();
      const w = Math.max(1, el.clientWidth);
      const h = Math.max(1, el.clientHeight);
      orbitBy((-dx / w) * TURN_PER_WIDTH, (dy / h) * TIP_PER_HEIGHT);
    };

    const onUp = (e: PointerEvent) => {
      if (!pointers.delete(e.pointerId)) return;
      if (dragging) draggedAt = performance.now();
      if (pointers.size < 2) spread = 0;
      if (pointers.size === 0) start = null;
    };

    const onWheel = (e: WheelEvent) => {
      if (!(e.target instanceof HTMLCanvasElement) || isInlineOnReddit()) return;
      e.preventDefault();
      zoomBy(Math.pow(WHEEL_ZOOM, e.deltaY / 100));
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('wheel', onWheel);
    };
  }, [target, on, orbitBy, zoomBy]);
};
