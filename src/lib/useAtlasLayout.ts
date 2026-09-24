/**
 * Runs `atlasLayout` in React: builds it for the map on screen, hands it each new board, and
 * ticks it on animation frames while anything moves.
 *
 * The motion on screen is the simulation's own; nothing is interpolated. The clock is real
 * milliseconds, because the plate animates the same arrival schedule (sprout.ts) in CSS. A tick
 * does not re-render: it calls the painters registered with `onTick` (see usePainting.ts), and
 * React renders only when the board itself changes.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  atlasLayout,
  NOTHING,
  type AtlasLayout,
  type Remembered,
  type Sizes,
  type Territory,
} from './atlasLayout';
import type { Box } from './camera';
import type { Figure } from './plate';
import { clusterGraph, type Regions } from './regions';
import { NO_ENTRANCE, type Entrances } from './sprout';
import type { Point } from './types';

/**
 * Simulation steps per frame: the speed control. At three, a reheat settles in about a second and
 * a half. Raising the decay instead would change whether it converges.
 */
const STEPS_PER_FRAME = 3;

export interface AtlasView {
  /** Built when asked, since the arrangement moves between renders. Cheap: tens per map. */
  territories(): readonly Territory[];
  /** The whole map, for the camera. */
  figure: Box;
  /** A word's position on the board, computed on request. */
  place(word: string): Point | undefined;
  /** A word's position within its region, which is where the plate draws it. */
  offset(word: string): Point | undefined;
  /** The `Territory.slot` a word is drawn in. */
  homeOf(word: string): number;
  /** What the atlas saves. Too costly to compute per frame. */
  settled(): Remembered;
  moving: boolean;
  /**
   * Register a painter to run after every tick; returns its unsubscribe. Stable for the life of
   * the hook.
   */
  onTick(paint: () => void): () => void;
}

export function useAtlasLayout(
  figure: Figure | null,
  regions: Regions,
  sizes: Sizes,
  /**
   * The saved map, read when it opens. A new object rebuilds the layout from it; the same one
   * carries on.
   */
  saved: Remembered | null,
  /** The arrival schedule, from `entrances` in sprout.ts, which the plate also reads. */
  arrivals: Entrances = NO_ENTRANCE,
): AtlasView | null {
  const clusters = useMemo(
    () => (figure ? clusterGraph(figure, regions) : null),
    [figure, regions],
  );

  // Writing a ref from a memo is safe because `update` is idempotent on the same board, which
  // StrictMode's double run relies on.
  const held = useRef<{ from: Remembered | null; layout: AtlasLayout } | null>(null);
  const layout = useMemo<AtlasLayout | null>(() => {
    if (!clusters) return null;
    if (!held.current || held.current.from !== saved) {
      const made = atlasLayout(clusters, sizes, saved ?? NOTHING);
      // Settled before it is first shown. A restored map has nothing to settle.
      made.settle();
      held.current = { from: saved, layout: made };
      return made;
    }
    held.current.layout.update(clusters, sizes, arrivals);
    return held.current.layout;
    // `arrivals` changes only with the figure, which `clusters` already follows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clusters, sizes, saved]);

  const [moving, setMoving] = useState(false);

  // A ref, so registering a painter does not render.
  const painters = useRef(new Set<() => void>());
  const onTick = useCallback((paint: () => void) => {
    painters.current.add(paint);
    return () => {
      painters.current.delete(paint);
    };
  }, []);
  const repaint = () => {
    for (const paint of painters.current) paint();
  };

  // Keyed on `clusters` too: a guess updates the same layout object with a new board.
  useEffect(() => {
    if (!layout) return;
    let raf: number | null = null;

    const began = performance.now();
    const step = () => {
      const since = performance.now() - began;
      let moved = false;
      for (let at = 0; at < STEPS_PER_FRAME; at++) if (layout.tick(since)) moved = true;
      repaint();
      if (moved || layout.moving()) {
        raf = requestAnimationFrame(step);
        return;
      }
      raf = null;
      // The only render a run causes; the camera waits for it.
      setMoving(false);
    };

    if (!layout.moving()) {
      repaint();
      setMoving(false);
      return;
    }
    setMoving(true);
    raf = requestAnimationFrame(step);
    return () => {
      if (raf !== null) cancelAnimationFrame(raf);
      raf = null;
    };
    // `repaint` closes over nothing that outlives a frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, clusters]);

  // Keyed on `clusters` for the same reason as the loop.
  return useMemo(() => {
    if (!layout) return null;
    return {
      territories: () => layout.territories(),
      figure: layout.bounds(),
      moving,
      onTick,
      place: (word: string) => layout.place(word),
      offset: (word: string) => layout.offset(word),
      homeOf: (word: string) => layout.homeOf(word),
      settled: () => layout.remember(),
    };
  }, [layout, clusters, moving, onTick]);
}
