/**
 * How much of a board to draw at the scale it is being looked at.
 *
 * A daily board is thirty words and the whole of it is always on screen, so nothing has ever
 * had to ask this. An atlas is thousands, and every one of them is three to seven SVG elements
 * with a hit area on it — so the question is not optional, and the answer has to be cheap
 * enough to give on every frame of a pan.
 *
 * **This is the seam everything multiscale goes behind, and it is deliberately trivial today.**
 * What it does now is cull to the rectangle the plate is already handed and has never used for
 * anything but hit-testing. What it is *for* is the rest: at a scale where a word is three
 * pixels wide, the honest thing to draw is not four thousand unreadable marks but sixty named
 * blobs, and the edges between them bundled — which is the same signature, a `Figure` in and a
 * smaller `Figure` out, with a territory standing in for its words.
 *
 * Territories first, then words: a region's box is one rectangle standing for a couple of
 * hundred of them, so most of the board is refused in sixty comparisons rather than four
 * thousand.
 */

import type { Box, View } from './camera';
import type { Figure, PlateEdge } from './plate';
import type { Point } from './types';

/** A place on the board big enough to test a whole crowd of words against at once. */
export interface Patch {
  words: readonly string[];
  at: Point;
  radius: number;
}

/**
 * How far outside the view still counts as worth drawing, in graph units.
 *
 * A word is drawn as a mark with a name above it, and a name is wider than the point it hangs
 * on, so culling exactly at the edge clips the labels of everything on the border. Past that
 * it is slack: a pan of less than this reuses the same set, which is what stops the drawn set
 * churning on every frame of a drag.
 */
export const MARGIN = 140;

/** Is this point inside the view, with `MARGIN` to spare? */
function within(at: Point, view: View, margin: number): boolean {
  return (
    at.x >= view.x - margin &&
    at.x <= view.x + view.width + margin &&
    at.y >= view.y - margin &&
    at.y <= view.y + view.height + margin
  );
}

/** And does this disc reach into it? */
function reaches(at: Point, radius: number, view: View, margin: number): boolean {
  return within(at, view, margin + radius);
}

/**
 * The part of a figure worth drawing for this view.
 *
 * An edge survives when *either* end does, so a move leading off the screen is still drawn
 * running off the screen — cutting it at the border would make the board look like it ends
 * there, which on a map is the one thing it must not say.
 *
 * Returns the figure itself when everything is in view, so a small board pays nothing and
 * nothing downstream re-renders for a pan that changed no answer.
 */
export function visible(
  figure: Figure,
  positions: ReadonlyMap<string, Point>,
  patches: readonly Patch[],
  view: View,
  margin: number = MARGIN,
): Figure {
  /*
    The coarse pass, and it only ever *refuses*.

    A territory that reaches into the view has some of its words in shot and usually most of
    them out, so every word it holds still has to be asked about individually. Taking a patch
    being in view as "all of it is drawn" is the tempting shortcut and it is wrong — with one
    territory covering the whole map it drew the whole map at every zoom, which is exactly the
    case this exists for.
  */
  const near = new Set<string>();
  for (const patch of patches) {
    if (!reaches(patch.at, patch.radius, view, margin)) continue;
    for (const word of patch.words) near.add(word);
  }

  const drawn = new Set<string>();
  for (const word of near) {
    const at = positions.get(word);
    if (at && within(at, view, margin)) drawn.add(word);
  }
  // Everything is in shot: hand the figure back rather than building two arrays to say so, and
  // so that nothing downstream re-renders for a pan that changed no answer.
  if (drawn.size === figure.nodes.length) return figure;

  const nodes = figure.nodes.filter((word) => drawn.has(word));
  const edges: PlateEdge[] = [];
  for (const edge of figure.edges) {
    if (drawn.has(edge.a) || drawn.has(edge.b)) edges.push(edge);
  }
  return { nodes, edges };
}

/** The rectangle a set of positions occupies, for framing a board that has no spine. */
export function boundsOf(positions: Iterable<Point>, pad = 0): Box {
  let first = true;
  const box: Box = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  for (const at of positions) {
    if (first) {
      box.minX = at.x;
      box.maxX = at.x;
      box.minY = at.y;
      box.maxY = at.y;
      first = false;
      continue;
    }
    box.minX = Math.min(box.minX, at.x);
    box.maxX = Math.max(box.maxX, at.x);
    box.minY = Math.min(box.minY, at.y);
    box.maxY = Math.max(box.maxY, at.y);
  }
  return {
    minX: box.minX - pad,
    maxX: box.maxX + pad,
    minY: box.minY - pad,
    maxY: box.maxY + pad,
  };
}
