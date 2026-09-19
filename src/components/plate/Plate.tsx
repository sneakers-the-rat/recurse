/**
 * The surface a board is drawn on.
 *
 * Small on purpose: what it owns is the one decision every plate has to make the same way —
 * **the camera is the `viewBox` and there is no other transform.** No CSS transform, no scaled
 * `<g>` wrapper. Everything a plate draws is written in graph units, and `camera.ts` turns the
 * camera into the rectangle of them that is on screen. That is what lets `usePointing` map a
 * pixel back to a position with two divisions, and why the view always has the plate's own
 * aspect: both axes share one scale and there is no letterboxing to allow for.
 *
 * `touch-none` is what makes dragging the board possible at all: without it a finger on the
 * plate scrolls the page instead.
 */

import type { ReactNode } from 'react';

export function Plate({
  view,
  label,
  gestures,
  engaged = false,
  children,
}: {
  /**
   * The window onto the board, in graph units — a camera, not the figure's extent.
   * See camera.ts: words are a fixed size and the surplus board runs off the edges.
   */
  view: { x: number; y: number; width: number; height: number };
  /** What this figure is, for anyone who cannot see it. */
  label: string;
  /** Drag, pinch and wheel, from usePanZoom. Spread onto the SVG. */
  gestures?: Record<string, unknown> | undefined;
  /**
   * The wheel belongs to the board rather than to the page, because a pointer has come
   * to rest here. Shown as the cursor, alongside the lit border App draws: a wheel that
   * has stopped scrolling the page needs to say why. See DWELL_MS in usePanZoom.
   */
  engaged?: boolean;
  children: ReactNode;
}) {
  return (
    <svg
      viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
      className={`h-full w-full touch-none select-none active:cursor-grabbing ${
        engaged ? 'cursor-zoom-in' : 'cursor-grab'
      }`}
      role="img"
      {...gestures}
      aria-label={label}
    >
      {children}
    </svg>
  );
}
