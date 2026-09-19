import { useEffect, useState } from 'react';
import type { Plate } from './camera';

/**
 * How big the plate is, in pixels, and the element it is drawn on.
 *
 * Every board needs this and needs it the same way: the camera is a window on to graph units,
 * and the window's size in pixels is what fixes the scale. The camera wants the real thing and
 * not a ratio — scale is pixels per graph unit, and that is what keeps a word the same size on
 * a bare board and a crowded one.
 *
 * Two boards measuring it two ways would be two places for the eighty-millisecond mistake
 * below to come back.
 */
export function usePlateSize() {
  // A callback ref, not a ref object: the plate does not exist on the first
  // render — the game is still loading its data — so an effect that reads
  // ref.current once on mount finds null and never looks again, which is how the
  // board ended up laid out for a phone on a desktop.
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [size, setSize] = useState<Plate>({ width: 0, height: 0 });

  useEffect(() => {
    if (!element) return;

    /**
     * Take a size, and say nothing if it is the size we already had.
     *
     * Both halves matter. A fresh `{width, height}` object every time is a new prop
     * for the camera and a new view for the plate, so re-reporting an unchanged size
     * re-rendered the board for nothing — and the plate is resized by ordinary play,
     * because the error line under the guess bar reserves its space and the header's
     * statement fades in.
     */
    const report = (width: number, height: number) => {
      if (width <= 0 || height <= 0) return;
      setSize((was) => (was.width === width && was.height === height ? was : { width, height }));
    };

    const box = element.getBoundingClientRect();
    report(box.width, box.height);

    // The observer's own `contentRect`, never `getBoundingClientRect` again: asking the
    // element forces a synchronous layout of the whole document, and the document
    // contains a thousand-element SVG. Measured at 80ms of the first second of a page
    // load, for a number the observer had already worked out and handed over.
    const observer = new ResizeObserver((entries) => {
      const rect = entries[entries.length - 1]?.contentRect;
      if (rect) report(rect.width, rect.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  // The element itself as well as its size: the wheel is listened for on it directly,
  // because React's own `wheel` is passive and cannot refuse a scroll. See usePanZoom.
  return [setElement, size, element] as const;
}
