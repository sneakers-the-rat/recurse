/**
 * Which word the pointer is really on, and what happens when it is clicked.
 *
 * **The nearest word within reach wins, not the shape that happened to be drawn last.** An SVG
 * hands an event to whichever element is uppermost, and a word's hit area is deliberately much
 * wider than its mark — a dot is four units across and a thumb is not — so on a crowded board
 * the reaches overlap and the word that lit up was the later one in the node list rather than
 * the one under the pointer. Every handler here therefore takes the word whose circle received
 * the event, asks the question again properly, and uses the answer.
 *
 * Every plate needs this and none of it is about what kind of board it is, so it is a hook
 * rather than a component: the caller keeps its own markup and takes the handlers.
 */

import { useCallback, useRef, useState } from 'react';
import type { Point } from '../../lib/types';
import type { At } from './PlateNode';
import { REACH } from './sizes';

export interface Pointing {
  /** The word the pointer is on, for lifting its moves out of the background. */
  overWord: string | null;
  /** The one move the pointer is on, if it is on a line rather than near a word. */
  overEdge: string | null;
  /** Hand to `PlateEdge`: `onEnter` and `onLeave` for the key it is drawn under. */
  edgeHandlers: (key: string) => { onEnter: () => void; onLeave: () => void };
  onHover: (word: string, at: At | null) => void;
  onUnhover: (word: string, at: At | null) => void;
  onActivate: (word: string, at: At | null) => void;
  onInspect: (word: string, at: At) => void;
}

/**
 * `live` is read through a ref rather than closed over, and that is the whole reason this is
 * shaped the way it is.
 *
 * The handlers are handed to every word on the board, so they have to keep their identity: a
 * memoised node given a fresh arrow function is a node that redraws on every frame anyway.
 * Positions and the camera change on every frame of a settle or a pan, and which words are
 * standable changes with every guess, so closing over any of it would mean a new callback —
 * and a full redraw of the whole board — each time.
 */
export function usePointing(live: {
  /** Every word drawn, which is what a pointer can be near. */
  nodes: readonly string[];
  positions: ReadonlyMap<string, Point>;
  /** The window onto the board in graph units, for turning pixels into positions. */
  view: { x: number; y: number; width: number; height: number };
  /** Is this somewhere the player can stand? A click there moves the cursor. */
  canStand: (word: string) => boolean;
  /** A click on somewhere they cannot stand: ask about the word instead. */
  onSelect: (word: string) => void;
  onAsk: (word: string) => void;
  /** Dev mode's read-aloud, if it is on. */
  onSpell?: ((word: string) => void) | undefined;
}): Pointing {
  const [overWord, setOverWord] = useState<string | null>(null);
  const [overEdge, setOverEdge] = useState<string | null>(null);

  const now = useRef(live);
  now.current = live;

  /**
   * The word the pointer is really on: the nearest one within reach, or none.
   *
   * See REACH. The pointer's position is turned into graph units the same way the viewBox
   * turns graph units into pixels — the view always has the plate's own aspect (camera.ts),
   * so the two axes scale alike and there is no letterboxing to allow for.
   */
  const nearest = useCallback((at: At) => {
    const svg = (at.currentTarget as SVGElement).ownerSVGElement;
    if (!svg) return null;
    const box = svg.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return null;
    const { nodes: drawn, positions: where, view: shot } = now.current;
    const x = shot.x + ((at.clientX - box.left) / box.width) * shot.width;
    const y = shot.y + ((at.clientY - box.top) / box.height) * shot.height;

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
  }, []);

  /**
   * Which word is lit, kept as a ref beside the state.
   *
   * Because hover is answered on `pointermove` as well as on entering a circle, and a
   * `setState` to the value it already holds still costs the plate a render — which is the
   * whole board's worth of edges and nodes rebuilt, sixty times a second, to arrive at the
   * same figure.
   */
  const lit = useRef<string | null>(null);
  const lift = useCallback((word: string | null) => {
    if (lit.current === word) return;
    lit.current = word;
    setOverWord(word);
  }, []);

  const onHover = useCallback(
    (word: string, at: At | null) => lift(at ? (nearest(at) ?? word) : word),
    [lift, nearest],
  );
  /**
   * Leaving one word's reach is not leaving the board: the pointer may well be inside a
   * neighbour's, in which case that neighbour is what is being pointed at now. So this asks
   * the same question as `onHover` and simply accepts the answer, including none.
   */
  const onUnhover = useCallback(
    (word: string, at: At | null) =>
      lift(at ? nearest(at) : lit.current === word ? null : lit.current),
    [lift, nearest],
  );

  /**
   * A tap or a click: the same nearest-word question, then stand on it or ask about it.
   *
   * Somewhere you can guess from is somewhere you stand on, so tapping there moves the cursor
   * rather than buying anything. Everywhere else, a click is a question about the word.
   */
  const onActivate = useCallback(
    (word: string, at: At | null) => {
      const { canStand, onSelect, onAsk } = now.current;
      const on = (at ? nearest(at) : null) ?? word;
      if (canStand(on)) onSelect(on);
      else onAsk(on);
    },
    [nearest],
  );

  /** Dev mode's read-aloud, resolved the same way. */
  const onInspect = useCallback(
    (word: string, at: At) => now.current.onSpell?.(nearest(at) ?? word),
    [nearest],
  );

  /**
   * One pair of handlers per edge, kept, because a fresh pair is a fresh prop and a fresh prop
   * is an edge that redraws on every frame — which is the whole thing `PlateEdge`'s memo exists
   * to stop. Edges come and go as the board grows, so this grows with them and is never
   * cleared: a few hundred closures against a board redrawing itself sixty times a second.
   */
  const handlers = useRef(new Map<string, { onEnter: () => void; onLeave: () => void }>());
  const edgeHandlers = useCallback((key: string) => {
    const kept = handlers.current.get(key);
    if (kept) return kept;
    const made = {
      onEnter: () => setOverEdge(key),
      onLeave: () => setOverEdge((at) => (at === key ? null : at)),
    };
    handlers.current.set(key, made);
    return made;
  }, []);

  return { overWord, overEdge, edgeHandlers, onHover, onUnhover, onActivate, onInspect };
}
