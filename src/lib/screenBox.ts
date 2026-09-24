/**
 * An element's client rect, cached for pointer handlers.
 *
 * `getBoundingClientRect` forces a pending layout, which on a large map is a very large SVG, so
 * calling it per pointer event is slow. The cached rect is dropped when the element or window
 * resizes or anything scrolls, and re-measured on the next `at`. Used by usePanZoom.ts and
 * usePointing.ts.
 */

export interface ScreenBox {
  at: () => DOMRect | null;
  stop: () => void;
}

export function watchBox(element: Element): ScreenBox {
  let box: DOMRect | null = null;

  const forget = () => {
    box = null;
  };

  const observer = new ResizeObserver(forget);
  observer.observe(element);
  // Capturing, because scroll events do not bubble.
  window.addEventListener('scroll', forget, { capture: true, passive: true });
  window.addEventListener('resize', forget, { passive: true });

  return {
    at: () => (box ??= element.getBoundingClientRect()),
    stop: () => {
      observer.disconnect();
      window.removeEventListener('scroll', forget, { capture: true });
      window.removeEventListener('resize', forget);
    },
  };
}
