/**
 * Which word the pointer is on, and what a click on it does. Shared by every plate.
 *
 * Every handler resolves the pointer to the nearest word within `REACH` of its position rather
 * than trusting whichever element received the event. A pointer with a button down is dragging
 * the board and is ignored, so what was lit stays lit until it comes up.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { watchBox, type ScreenBox } from '../../lib/screenBox';
import type { Point } from '../../lib/types';
import type { At } from './PlateNode';
import { REACH } from './sizes';

export interface Pointing {
  overWord: string | null;
  /** The move the pointer is on, keyed `${a} ${b}`. */
  overEdge: string | null;
  /** `onEnter` and `onLeave` for the `PlateEdge` with this key. */
  edgeHandlers: (key: string) => {
    onEnter: (at: Held) => void;
    onLeave: (at: Held) => void;
  };
  onHover: (word: string, at: At | null) => void;
  onUnhover: (word: string, at: At | null) => void;
  onActivate: (word: string, at: At | null) => void;
  onInspect: (word: string, at: At) => void;
  /**
   * Handlers for the rectangle under the whole plate, which is how a pointer near a small mark
   * but not on it still finds the word. Nothing within reach means nothing lit or clicked.
   */
  surface: {
    onPointerMove: (at: At) => void;
    onPointerLeave: () => void;
    onClick: (at: At) => void;
  };
}

/** Anything that can say whether a button is down. Null for focus and blur. */
export type Held = { buttons?: number } | null | undefined;

/** A button is down, so the board is being dragged. */
function held(at: Held): boolean {
  return (at?.buttons ?? 0) !== 0;
}

/**
 * `live` is read through a ref so the handlers keep their identity across renders and the
 * memoised nodes and edges they are passed to do not redraw.
 */
export function usePointing(live: {
  nodes: readonly string[];
  positions: { get(word: string): Point | undefined };
  /** The window onto the board in graph units, for turning pixels into positions. */
  view: { x: number; y: number; width: number; height: number };
  /** A click on a word the player can stand on selects it; on any other word, asks about it. */
  canStand: (word: string) => boolean;
  onSelect: (word: string) => void;
  onAsk: (word: string) => void;
  /** Dev mode's spell-out, if it is on. */
  onSpell?: ((word: string) => void) | undefined;
}): Pointing {
  const [overWord, setOverWord] = useState<string | null>(null);
  const [overEdge, setOverEdge] = useState<string | null>(null);

  const now = useRef(live);
  now.current = live;

  /**
   * The on-screen rectangle of the plate's window (`[data-plate]`), not of the svg, which
   * overhangs it and moves during a drag. Watched rather than measured per event; see
   * screenBox.ts. Made on the first event, since the element is not known before.
   */
  const watching = useRef<{ window: Element; box: ScreenBox } | null>(null);
  useEffect(() => () => watching.current?.box.stop(), []);
  const boxOf = useCallback((svg: SVGSVGElement) => {
    const window = svg.closest('[data-plate]') ?? svg;
    if (watching.current?.window !== window) {
      watching.current?.box.stop();
      watching.current = { window, box: watchBox(window) };
    }
    return watching.current.box.at();
  }, []);

  /** The nearest drawn word within `REACH` of the pointer, or null. */
  const nearest = useCallback((at: At) => {
    const svg = (at.currentTarget as SVGElement).ownerSVGElement;
    if (!svg) return null;
    const box = boxOf(svg);
    if (!box || box.width <= 0 || box.height <= 0) return null;
    // Off the window is near nothing, or leaving the board would light a word past its edge.
    const px = at.clientX - box.left;
    const py = at.clientY - box.top;
    if (px < 0 || py < 0 || px > box.width || py > box.height) return null;

    const { nodes: drawn, positions: where, view: shot } = now.current;
    const x = shot.x + (px / box.width) * shot.width;
    const y = shot.y + (py / box.height) * shot.height;

    let best: string | null = null;
    let nearby = REACH * REACH;
    for (const word of drawn) {
      const p = where.get(word);
      if (!p) continue;
      const away = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (away > nearby) continue;
      nearby = away;
      best = word;
    }
    return best;
  }, [boxOf]);

  // Mirrors `overWord`, so a `pointermove` that changes nothing skips the `setState` and render.
  const lit = useRef<string | null>(null);
  const lift = useCallback((word: string | null) => {
    if (lit.current === word) return;
    lit.current = word;
    setOverWord(word);
  }, []);

  const onHover = useCallback(
    (word: string, at: At | null) => {
      if (held(at)) return;
      lift(at ? (nearest(at) ?? word) : word);
    },
    [lift, nearest],
  );
  // Leaving one mark may put the pointer nearest another, so this re-asks `nearest`.
  const onUnhover = useCallback(
    (word: string, at: At | null) => {
      if (held(at)) return;
      lift(at ? nearest(at) : lit.current === word ? null : lit.current);
    },
    [lift, nearest],
  );

  const stand = useCallback((on: string | null) => {
    if (on === null) return;
    const { canStand, onSelect, onAsk } = now.current;
    if (canStand(on)) onSelect(on);
    else onAsk(on);
  }, []);

  const onActivate = useCallback(
    (word: string, at: At | null) => stand((at ? nearest(at) : null) ?? word),
    [nearest, stand],
  );

  // Unlike a mark's handlers there is no word to fall back on. That is also why a big mark keeps
  // its own handlers: a point deep inside it may be beyond `REACH` of its centre.
  const surface = useMemo(
    () => ({
      onPointerMove: (at: At) => {
        if (held(at)) return;
        lift(nearest(at));
      },
      onPointerLeave: () => lift(null),
      onClick: (at: At) => stand(nearest(at)),
    }),
    [lift, nearest, stand],
  );

  const onInspect = useCallback(
    (word: string, at: At) => now.current.onSpell?.(nearest(at) ?? word),
    [nearest],
  );

  // Cached per edge key so `PlateEdge`'s memo holds. Never cleared; edges only accumulate.
  const handlers = useRef(
    new Map<string, { onEnter: (at: Held) => void; onLeave: (at: Held) => void }>(),
  );
  const edgeHandlers = useCallback((key: string) => {
    const kept = handlers.current.get(key);
    if (kept) return kept;
    const made = {
      onEnter: (at: Held) => {
        if (!held(at)) setOverEdge(key);
      },
      onLeave: (at: Held) => {
        if (!held(at)) setOverEdge((on) => (on === key ? null : on));
      },
    };
    handlers.current.set(key, made);
    return made;
  }, []);

  return { overWord, overEdge, edgeHandlers, onHover, onUnhover, onActivate, onInspect, surface };
}
