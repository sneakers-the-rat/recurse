import { useEffect, useState } from 'react';
import type { Plate } from './camera';

/** The plate element and its size in pixels, which fixes the camera's scale. */
export function usePlateSize() {
  // A callback ref, because the plate is not mounted on the first render while data loads.
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [size, setSize] = useState<Plate>({ width: 0, height: 0 });

  useEffect(() => {
    if (!element) return;

    // Keep the old object when the size is unchanged, so the board does not re-render.
    const report = (width: number, height: number) => {
      if (width <= 0 || height <= 0) return;
      setSize((was) => (was.width === width && was.height === height ? was : { width, height }));
    };

    const box = element.getBoundingClientRect();
    report(box.width, box.height);

    // Use the observer's `contentRect`: `getBoundingClientRect` forces a synchronous layout.
    const observer = new ResizeObserver((entries) => {
      const rect = entries[entries.length - 1]?.contentRect;
      if (rect) report(rect.width, rect.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  // The element too, for usePanZoom's non-passive wheel listener.
  return [setElement, size, element] as const;
}
