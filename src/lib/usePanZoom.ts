/**
 * Dragging, pinching and wheeling the plate.
 *
 * The camera arithmetic is in camera.ts; this is the part that listens. Pointer
 * events throughout, so one set of handlers covers a mouse, a trackpad and two
 * thumbs — and `touch-action: none` on the plate (see GraphPlate) is what stops a
 * drag on the board from scrolling the page instead.
 *
 * Two decisions worth knowing:
 *
 * - **A drag must not become a tap.** Words on the plate are buttons, and a pan that
 *   starts on one used to select it as the finger came up. Anything that moved more
 *   than a few pixels swallows the click that follows it, in the capture phase, before
 *   the node ever hears about it.
 * - **The camera is only moved by the player, or by the opening.** `jumpTo` and
 *   `glideTo` exist for the intro; nothing else here moves the view, so a word
 *   arriving never yanks the board out from under a thumb.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  between,
  clampCamera,
  ease,
  panBy,
  zoomAround,
  type Box,
  type Camera,
  type Plate,
} from './camera';

/** Pixels of movement past which a gesture is a drag and not a tap. */
const DRAG_SLOP = 6;
/** One wheel notch, as a scale factor. Trackpads send many small ones. */
const WHEEL_STEP = 0.0022;

/**
 * How long a pointer must rest on the plate before the wheel belongs to the board.
 *
 * The board is a full screen tall and the page scrolls past it, so a wheel over the plate
 * is genuinely ambiguous — and the answer used to be "both", which is the one answer that
 * cannot be right: the page scrolled *and* the board zoomed, on the same notch. (The
 * mechanism was that React attaches `wheel` passively, so the `preventDefault` in the
 * handler was silently doing nothing at all. It is a native non-passive listener now, and
 * the choice is made deliberately rather than lost.)
 *
 * **The wait is only for the case where there is genuinely something to lose.** While a round is
 * being played the page is one fixed-height screen and does not scroll at all, so there is no
 * ambiguity to resolve and no reason to make anybody wait for a zoom: the board simply has the
 * wheel. It is when the round ends and the page runs on past the plate that deference is worth
 * anything, and that is the only time this waits. Making every board wait was most of why the
 * wheel felt broken — half a second of nothing happening, on a page that was never going to
 * scroll.
 *
 * When the page *can* scroll, scrolling past is the default and the board has to be asked for by
 * putting a pointer on it and letting the wheel go quiet. Two details:
 *
 * - **The pointer has to have moved here.** A page scrolled under a stationary mouse slides the
 *   plate up to meet it, and the mouse has not been asked about anything. The wait used to start
 *   on `pointerenter`, which is exactly what that scroll fires, so the board took the wheel out
 *   from under a page the player was reading.
 * - **A wheel that goes to the page restarts the wait rather than ending it**, so a scroll in
 *   progress can never be interrupted mid-gesture, and a pointer already resting on the plate
 *   does not have to be jiggled to get the board's attention once the scrolling stops.
 */
const DWELL_MS = 500;

/**
 * Whether there is any page to scroll, which is the whole reason the wheel is ever contested.
 *
 * Asked at the moment the wheel arrives rather than remembered, because the answer changes
 * inside a round: finishing one adds the result and the move list below the plate.
 */
function pageScrolls(): boolean {
  const page = document.scrollingElement ?? document.documentElement;
  return page.scrollHeight > page.clientHeight + 1;
}

export interface PanZoom {
  camera: Camera;
  /** Put the camera somewhere at once, with no animation. */
  jumpTo: (camera: Camera) => void;
  /** Move the camera over `ms`, easing. Returns nothing; it is fire and forget. */
  glideTo: (camera: Camera, ms: number) => void;
  /** True while a glide is running, so the caller can wait for it. */
  moving: boolean;
  /**
   * The wheel now belongs to the board rather than to the page — so say so on screen.
   * The plate takes a lit border and the cursor changes; without that, a wheel that
   * suddenly stops scrolling the page is indistinguishable from a stuck page.
   */
  engaged: boolean;
  /** Spread onto the SVG. */
  handlers: {
    onPointerDown: (event: React.PointerEvent) => void;
    onPointerMove: (event: React.PointerEvent) => void;
    onPointerUp: (event: React.PointerEvent) => void;
    onPointerCancel: (event: React.PointerEvent) => void;
    onClickCapture: (event: React.MouseEvent) => void;
  };
}

/**
 * `plate` is the element's size in pixels and `bounds` the figure's own extent, used
 * only to stop a gesture from losing the board. Both may change; neither moves the
 * camera on its own. `target` is the plate element, which the wheel is listened for on
 * directly — see DWELL_MS for why it cannot go through React.
 */
export function usePanZoom(
  initial: Camera,
  plate: Plate,
  bounds: Box,
  target: HTMLElement | null,
): PanZoom {
  const [camera, setCamera] = useState(initial);
  const [moving, setMoving] = useState(false);

  // Live pointers, by id, so one finger pans and two pinch.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const travelled = useRef(0);
  const glide = useRef<number | null>(null);

  const plateRef = useRef(plate);
  plateRef.current = plate;
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;

  const stopGlide = useCallback(() => {
    if (glide.current !== null) cancelAnimationFrame(glide.current);
    glide.current = null;
    setMoving(false);
  }, []);

  const jumpTo = useCallback(
    (next: Camera) => {
      stopGlide();
      setCamera(next);
    },
    [stopGlide],
  );

  const glideTo = useCallback((next: Camera, ms: number) => {
    stopGlide();
    setMoving(true);
    let start: number | null = null;
    let from: Camera | null = null;
    const step = (now: number) => {
      if (start === null) start = now;
      const t = Math.min(1, (now - start) / ms);
      setCamera((current) => {
        from ??= current;
        return between(from, next, ease(t));
      });
      if (t < 1) {
        glide.current = requestAnimationFrame(step);
      } else {
        glide.current = null;
        setMoving(false);
      }
    };
    glide.current = requestAnimationFrame(step);
  }, [stopGlide]);

  useEffect(() => () => stopGlide(), [stopGlide]);

  /**
   * Whether the wheel is the board's or the page's, and the wait that decides it.
   *
   * Kept in a ref as well as in state: the wheel handler is registered once and must read
   * the live answer without being torn down and rebuilt every time it changes, while the
   * border and the cursor need a render to follow it.
   */
  const [engaged, setEngaged] = useState(false);
  const engagedRef = useRef(false);
  const engage = useCallback((next: boolean) => {
    if (engagedRef.current === next) return;
    engagedRef.current = next;
    setEngaged(next);
  }, []);

  useEffect(() => {
    if (!target) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    /** Where the pointer last was, so a plate that moves under it is not mistaken for a move. */
    let at: { x: number; y: number } | null = null;

    /** The board has the wheel from here, and the lit border says so. */
    const take = () => {
      clearTimeout(timer);
      engage(true);
    };

    /**
     * A pointer has been put on the plate on purpose. Take the wheel, or start the clock.
     *
     * Nothing to defer to means nothing to wait for: with the page at one screen there is no
     * scroll to interrupt, so the board takes the wheel at once.
     *
     * Nothing happens at all once the board has it. A twitch of the hand must not hand it back
     * — losing it mid-zoom and sending the next notch to the page would be the same confusion
     * in a smaller form. Leaving the plate is what gives it up.
     */
    const arm = () => {
      if (engagedRef.current) return;
      if (!pageScrolls()) {
        take();
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(() => engage(true), DWELL_MS);
    };

    /**
     * Note where the pointer is, and say whether it actually went there.
     *
     * Scrolling the page fires `pointermove` at whatever arrives under a mouse that never
     * went anywhere, and taking those at face value is what let a scroll engage the board.
     * The wheel records a position too, for the same reason from the other side: the
     * boundary event a scroll fires carries the coordinates the wheel already reported, so
     * remembering them is what tells the two apart.
     */
    const moveTo = (x: number, y: number) => {
      const moved = at === null || at.x !== x || at.y !== y;
      at = { x, y };
      return moved;
    };

    const onPointerMove = (event: PointerEvent) => {
      if (moveTo(event.clientX, event.clientY)) arm();
    };

    // A hand put on the board is as deliberate as a hand moved across it, wherever it lands.
    const onPointerDown = (event: PointerEvent) => {
      moveTo(event.clientX, event.clientY);
      arm();
    };

    const release = () => {
      clearTimeout(timer);
      at = null;
      engage(false);
    };

    const onWheel = (event: WheelEvent) => {
      if (!engagedRef.current) {
        // A page of one screen has no scroll to lose, so this notch is the board's — and a
        // wheel over the plate is proof enough that a pointer is here to say so out loud.
        if (!pageScrolls()) {
          take();
        } else {
          // Otherwise the page keeps it: say nothing, do nothing, and let it scroll as it
          // would. The position is recorded so that the boundary `pointermove` a scroll fires
          // at the arriving plate is not mistaken for a hand being put on it; the wait starts
          // again from here, so this gesture can only ever end with the page still scrolling.
          moveTo(event.clientX, event.clientY);
          clearTimeout(timer);
          timer = setTimeout(() => engage(true), DWELL_MS);
          return;
        }
      }
      // Ours, so it is *only* ours — including at the zoom stops, where doing nothing is
      // still an answer and letting the page have the leftovers would be the old bug back.
      event.preventDefault();
      stopGlide();
      const box = target.getBoundingClientRect();
      const over = { x: event.clientX - box.left, y: event.clientY - box.top };
      // Exponential in the delta, so a trackpad's stream of small deltas and a mouse's
      // single large one both feel like the same gesture.
      const factor = Math.exp(-event.deltaY * WHEEL_STEP);
      setCamera((current) =>
        clampCamera(
          zoomAround(current, plateRef.current, factor, over),
          boundsRef.current,
          plateRef.current,
        ),
      );
    };

    target.addEventListener('pointermove', onPointerMove);
    target.addEventListener('pointerdown', onPointerDown);
    target.addEventListener('pointerleave', release);
    // Non-passive, which is the whole point: a passive listener may not call
    // `preventDefault`, and React registers `wheel` passively, so the handler this
    // replaces was asking the page not to scroll and being ignored.
    target.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      clearTimeout(timer);
      target.removeEventListener('pointermove', onPointerMove);
      target.removeEventListener('pointerdown', onPointerDown);
      target.removeEventListener('pointerleave', release);
      target.removeEventListener('wheel', onWheel);
    };
  }, [target, engage, stopGlide]);

  const lastSpread = useRef<number | null>(null);

  /**
   * The gestures, built once.
   *
   * Identity matters here: these go to the plate as one prop, and the plate is redrawn
   * on every frame of a settle. A fresh object each render is a changed prop, which
   * defeats every memo below it. Everything they touch is a ref or a state setter, so
   * there is nothing to close over that goes stale.
   */
  const handlers = useMemo(() => {
    /** Distance between the two live pointers, for a pinch. */
    const spread = () => {
      const [a, b] = [...pointers.current.values()];
      if (!a || !b) return null;
      return {
        gap: Math.hypot(a.x - b.x, a.y - b.y),
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      };
    };

    const local = (event: React.PointerEvent | React.WheelEvent) => {
      const box = (event.currentTarget as Element).getBoundingClientRect();
      return { x: event.clientX - box.left, y: event.clientY - box.top };
    };

    return {
      onPointerDown: (event: React.PointerEvent) => {
        // A hand on the board stops whatever the game was doing with it.
        stopGlide();
        pointers.current.set(event.pointerId, local(event));
        travelled.current = 0;
        lastSpread.current = spread()?.gap ?? null;
      },

      onPointerMove: (event: React.PointerEvent) => {
        const was = pointers.current.get(event.pointerId);
        if (!was) return;
        const now = local(event);
        pointers.current.set(event.pointerId, now);
        const dx = now.x - was.x;
        const dy = now.y - was.y;
        travelled.current += Math.hypot(dx, dy);

        if (pointers.current.size >= 2) {
          const pinch = spread();
          if (pinch && lastSpread.current && lastSpread.current > 0) {
            const factor = pinch.gap / lastSpread.current;
            setCamera((current) =>
              clampCamera(
                zoomAround(current, plateRef.current, factor, pinch.mid),
                boundsRef.current,
                plateRef.current,
              ),
            );
          }
          lastSpread.current = pinch?.gap ?? null;
          return;
        }

        setCamera((current) =>
          clampCamera(panBy(current, dx, dy), boundsRef.current, plateRef.current),
        );
      },

      onPointerUp: (event: React.PointerEvent) => {
        pointers.current.delete(event.pointerId);
        lastSpread.current = spread()?.gap ?? null;
      },

      onPointerCancel: (event: React.PointerEvent) => {
        pointers.current.delete(event.pointerId);
        lastSpread.current = null;
      },

      onClickCapture: (event: React.MouseEvent) => {
        // A pan that began on a word must not also select it.
        if (travelled.current > DRAG_SLOP) {
          event.preventDefault();
          event.stopPropagation();
          travelled.current = 0;
        }
      },
    };
  }, [stopGlide]);

  return { camera, jumpTo, glideTo, moving, engaged, handlers };
}
