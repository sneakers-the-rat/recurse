/**
 * Moves an open map's elements on each layout tick by writing their attributes directly.
 *
 * React renders the map only when what is on it changes; between renders this writes positions
 * to the existing elements, touching only territories that moved. React renders the same
 * positions from the live layout, so the two never disagree. Elements are found by their
 * `data-` attributes, rescanned when `structure` changes. A word stays in the territory it was
 * first drawn in, so a crossing move's two territories are looked up once per scan.
 */

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { Territory } from '../../lib/atlasLayout';
import { ringPath } from '../../lib/hull';
import type { Point } from '../../lib/types';

/** The live layout, as the painter reads it. */
export interface Painting {
  territories(): readonly Territory[];
  /** Position within the word's territory group. */
  offset(word: string): Point | undefined;
  /** How much of its full size a word is drawn at; below 1 while it grows. */
  scale(word: string): number;
  /** Position on the board, for crossing moves and labels. */
  place(word: string): Point | undefined;
  homeOf(word: string): number;
  /** See `onTick` in useAtlasLayout. */
  onTick(paint: () => void): () => void;
}

/**
 * Graph units something must move from where it was last painted before it is written again.
 * Measured from the last paint, not the last tick, so slow drift is still drawn eventually.
 */
const WORTH_DRAWING = 0.25;

function far(was: number, now: number): boolean {
  return was !== was || Math.abs(now - was) > WORTH_DRAWING;
}

/** One territory's elements, and what was last painted for it. */
interface Place {
  /** Its three layer groups (ground, moves, words), which share one transform. */
  groups: SVGGElement[];
  plate: SVGPathElement | null;
  words: Mark[];
  moves: Line[];
  /** Null until first painted, so a fresh scan paints everything. */
  at: Point | null;
  shape: number;
  /** Compared by identity: the layout returns the same ring until the hull moves. */
  ring: readonly Point[] | null;
}

/** One word's group, and where and how big it was last drawn. `NaN` is "never". */
interface Mark {
  word: string;
  el: SVGGElement;
  x: number;
  y: number;
  k: number;
}

/** A word's transform: its position, and its scale while it grows. */
export function markAt(at: Point, k: number): string {
  return k < 1 ? `translate(${at.x} ${at.y}) scale(${k})` : `translate(${at.x} ${at.y})`;
}

/** A move's line elements (visible line and hit area), and where its ends were last drawn. */
interface Line {
  a: string;
  b: string;
  lines: SVGLineElement[];
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

/** A move between two territories. */
interface Crossing extends Line {
  here: number;
  there: number;
}

interface Kit {
  places: Map<number, Place>;
  across: Crossing[];
}

function linesOf(group: Element): SVGLineElement[] {
  return [...group.querySelectorAll<SVGLineElement>('line')];
}

function endsOf(group: HTMLElement | SVGElement): { a: string; b: string } | null {
  const [a, b] = (group.dataset.edge ?? '').split(' ');
  return a !== undefined && b !== undefined ? { a, b } : null;
}

/** Every element the painter can move, found under `root`. */
function scan(root: SVGGElement, homeOf: (word: string) => number): Kit {
  const places = new Map<number, Place>();
  for (const group of root.querySelectorAll<SVGGElement>('g[data-slot]')) {
    const slot = Number(group.dataset.slot);
    let place = places.get(slot);
    if (!place) {
      place = { groups: [], plate: null, words: [], moves: [], at: null, shape: -1, ring: null };
      places.set(slot, place);
    }
    place.groups.push(group);
    if (group.dataset.layer === 'ground') {
      place.plate = group.querySelector<SVGPathElement>('path');
    }
    if (group.dataset.layer === 'words') {
      for (const one of group.querySelectorAll<SVGGElement>('g[data-word]')) {
        const word = one.dataset.word;
        if (word !== undefined) place.words.push({ word, el: one, x: NaN, y: NaN, k: NaN });
      }
    }
    if (group.dataset.layer === 'moves') {
      for (const one of group.querySelectorAll<SVGGElement>('g[data-edge]')) {
        const ends = endsOf(one);
        if (ends) place.moves.push({ ...ends, ...NOWHERE, lines: linesOf(one) });
      }
    }
  }

  const across: Crossing[] = [];
  for (const one of root.querySelectorAll<SVGGElement>('g[data-layer="across"] g[data-edge]')) {
    const ends = endsOf(one);
    if (!ends) continue;
    across.push({
      ...ends,
      ...NOWHERE,
      here: homeOf(ends.a),
      there: homeOf(ends.b),
      lines: linesOf(one),
    });
  }

  return { places, across };
}

/** Never drawn, so the first pass always draws it. */
const NOWHERE = { ax: NaN, ay: NaN, bx: NaN, by: NaN };

/** Redraw a move if either end has moved more than `WORTH_DRAWING`. */
function stretch(move: Line, a: Point, b: Point) {
  if (!far(move.ax, a.x) && !far(move.ay, a.y) && !far(move.bx, b.x) && !far(move.by, b.y)) return;
  move.ax = a.x;
  move.ay = a.y;
  move.bx = b.x;
  move.by = b.y;
  for (const line of move.lines) {
    line.setAttribute('x1', String(a.x));
    line.setAttribute('y1', String(a.y));
    line.setAttribute('x2', String(b.x));
    line.setAttribute('y2', String(b.y));
  }
}

/**
 * Paint the map on every tick. `label` says where a move's subword goes; without it the labels
 * stay where React put them.
 */
export function usePainting(
  live: Painting,
  /**
   * Changes whenever elements may have been added or removed, triggering a rescan. Must not
   * change when the layout merely moves.
   */
  structure: unknown,
  label?: (a: string, b: string) => Point | null,
) {
  const root = useRef<SVGGElement | null>(null);
  // The label layer's few children change with the pointer, so they are queried on every paint
  // rather than scanned.
  const labels = useRef<SVGGElement | null>(null);
  const kit = useRef<Kit | null>(null);
  const now = useRef({ live, label });
  now.current = { live, label };

  const paint = useCallback(() => {
    const here = root.current;
    const found = kit.current;
    if (!here || !found) return;
    const { live: ask, label: where } = now.current;

    const stirred = new Set<number>();
    for (const one of ask.territories()) {
      const place = found.places.get(one.slot);
      if (!place) continue;
      const slid = place.at === null || place.at.x !== one.at.x || place.at.y !== one.at.y;
      const reshaped = place.shape !== one.shape;
      if (!slid && !reshaped) continue;
      stirred.add(one.slot);

      if (slid) {
        const transform = `translate(${one.at.x} ${one.at.y})`;
        for (const group of place.groups) group.setAttribute('transform', transform);
        place.at = { x: one.at.x, y: one.at.y };
      }

      if (reshaped) {
        place.shape = one.shape;
        // See `GROUND_MOVED` in atlasLayout.ts for when the ring changes.
        if (place.plate && place.ring !== one.ring) {
          place.ring = one.ring;
          place.plate.setAttribute('d', ringPath(one.ring));
        }
        for (const mark of place.words) {
          const to = ask.offset(mark.word);
          if (!to) continue;
          const k = ask.scale(mark.word);
          if (!far(mark.x, to.x) && !far(mark.y, to.y) && k === mark.k) continue;
          mark.x = to.x;
          mark.y = to.y;
          mark.k = k;
          mark.el.setAttribute('transform', markAt(to, k));
        }
        for (const move of place.moves) {
          const a = ask.offset(move.a);
          const b = ask.offset(move.b);
          if (a && b) stretch(move, a, b);
        }
      }
    }

    // Crossing moves are in board coordinates; redraw those touching a territory that moved.
    for (const cross of found.across) {
      if (!stirred.has(cross.here) && !stirred.has(cross.there)) continue;
      const a = ask.place(cross.a);
      const b = ask.place(cross.b);
      if (a && b) stretch(cross, a, b);
    }

    // At most a few labels, so they are always rewritten.
    if (where && labels.current) {
      for (const one of labels.current.querySelectorAll<SVGGElement>('g[data-edge]')) {
        const ends = endsOf(one);
        const text = one.querySelector<SVGTextElement>('text');
        if (!ends || !text) continue;
        const at = where(ends.a, ends.b);
        if (!at) continue;
        text.setAttribute('x', String(at.x));
        text.setAttribute('y', String(at.y));
      }
    }
  }, []);

  // A layout effect, so new elements are corrected to the current layout before a frame shows.
  useLayoutEffect(() => {
    const here = root.current;
    if (!here) return;
    kit.current = scan(here, (word) => now.current.live.homeOf(word));
    paint();
  }, [structure, paint]);

  useEffect(() => live.onTick(paint), [live, paint]);

  /** `root` goes on the group holding everything paintable, `labels` on the subword layer. */
  return { root, labels };
}
