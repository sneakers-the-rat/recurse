/**
 * The surface a board is drawn on.
 *
 * The camera is the `viewBox`, in graph units, with the surface's own aspect so both axes share
 * one scale. During a drag the surface is instead translated, overhanging the window by
 * `overhang` pixels; see `nudgeOf` in camera.ts. The outer `div` clips that overhang and is the
 * fixed rectangle pointers are measured against, so the gestures go on it.
 *
 * An undrawn rectangle under everything catches pointers that miss every mark and hands them to
 * `surface` in usePointing, which finds the nearest word. `touch-none` stops a finger on the
 * plate scrolling the page.
 */

import type { ReactNode } from "react";
import type { Pointing } from "./usePointing";

export function Plate({
  frame,
  label,
  gestures,
  surface,
  overhang = 0,
  nudge,
  engaged = false,
  children,
}: {
  /**
   * The `viewBox`, in graph units: the camera the board was last drawn from, grown by
   * `overhang` on every side. `nudge` is how far a drag has moved from it.
   */
  frame: { x: number; y: number; width: number; height: number };
  /** Accessible name. */
  label: string;
  /** Drag, pinch and wheel, from usePanZoom. Spread onto the wrapper. */
  gestures?: Record<string, unknown> | undefined;
  /** Pointer handlers for a pointer that is on no mark, from `usePointing`. */
  surface?: Pointing["surface"] | undefined;
  /**
   * Pixels past each edge of the window. Must be the number `frame` was grown by (`grown` in
   * camera.ts), or the axes stop sharing a scale.
   */
  overhang?: number | undefined;
  /** How far the drawing has been shifted from where it was drawn, in pixels. */
  nudge?: { x: number; y: number } | undefined;
  /** The wheel zooms the board rather than scrolling the page. See DWELL_MS in usePanZoom. */
  engaged?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      data-plate
      className={`relative h-full w-full touch-none overflow-hidden select-none active:cursor-grabbing ${
        engaged ? "cursor-zoom-in" : "cursor-grab"
      }`}
      {...gestures}
    >
      {/*
        The drag moves this `div` rather than the `<svg>`: a transform on the svg repaints all
        of it every frame, one on a composited div does not.
      */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          transformOrigin: "0 0",
          transform: `translate3d(${nudge?.x ?? 0}px, ${nudge?.y ?? 0}px, 0)`,
          // Keyed on the overhang, which is set as soon as a hand is down, so the layer exists
          // before the first shift rather than being built mid-drag.
          willChange: overhang > 0 ? "transform" : undefined,
        }}
      >
        <svg
          viewBox={`${frame.x} ${frame.y} ${frame.width} ${frame.height}`}
          role="img"
          aria-label={label}
          style={{
            position: "absolute",
            left: -overhang,
            top: -overhang,
            right: -overhang,
            bottom: -overhang,
          }}
        >
          {/* First, so marks keep their own taps; covers the overhang too. */}
          {surface && (
            <rect
              x={frame.x}
              y={frame.y}
              width={frame.width}
              height={frame.height}
              fill="none"
              pointerEvents="all"
              onPointerMove={surface.onPointerMove}
              onPointerLeave={surface.onPointerLeave}
              onClick={surface.onClick}
            />
          )}
          {children}
        </svg>
      </div>
    </div>
  );
}
