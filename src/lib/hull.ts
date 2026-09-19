/**
 * The ground a crowd of words stands on: a plate that holds all of them, with room to spare.
 *
 * **A territory is a plate, not a skin.** It was a contour of a metaball field — a union of soft
 * discs and capsules along the moves — and what that draws is the *words*, one more time, in a
 * second medium: a thin membrane shrink-wrapped round the graph, necking between neighbours and
 * budding a lobe per outlier. The words were already on the board. What the ground has to say is
 * the thing they cannot, which is that this patch of the map is one *place* with an extent and an
 * edge, that its neighbours are other such places, and that it is being shoved about by them as
 * it grows. Tectonic plates, in other words, and a plate is a polygon with an interior.
 *
 * So: **the convex hull of the region's words, pushed outward.** Its vertices are the outermost
 * words themselves, which is what makes the shape the region's own rather than a circle's — a
 * region laid out in an L comes out as an L-ish wedge, one laid out in a chain as a long sliver
 * — and its interior is ground the region holds whether or not a word happens to sit on that
 * spot. Ground with no words on it yet is the point: it is where the next word goes.
 *
 * **Convex, deliberately.** A concave outline would trace the crowd more closely and cost the
 * plate the one property that makes a map of sixty of them legible: two convex plates whose
 * words are held apart by `atlasLayout`'s region collider cannot interpenetrate, so the map
 * reads as a tiling rather than as sixty overlapping washes. It also means the shape a player
 * learns changes only at its rim as words arrive, instead of growing a new bay every guess.
 *
 * Pure, and tested in node. Cheap — a sort and two passes over the words, against a grid per
 * region before — so nothing here needs memoising for cost.
 */

import type { Point } from './types';

/** A word, where it is and how much room it takes. */
export interface Blob {
  x: number;
  y: number;
  r: number;
}

/**
 * How far the plate's rim stands off the outermost word's ink.
 *
 * The one number that decides whether the map reads as plates in contact or as islands in a sea.
 * Joined territories rest `REGION_GAP` apart (70) beyond their own radii, so a margin much past
 * half of that has neighbours overlapping, and much below a quarter of it leaves channels of
 * bare ground wider than the words.
 */
const PLATE_MARGIN = 28;

/**
 * How far a plate reaches, given how far the furthest *ink* in the crowd reaches.
 *
 * **The layout has to leave room for the ground, the same way it leaves room for a label.** A
 * territory's radius is what holds two of them apart, and measured from the words alone it is
 * short of the plate drawn over them — so two regions settled a comfortable gap apart had their
 * plates overlapping, which says they are one place. The two ends of that arithmetic are here
 * and in `arrange`, and this is the seam between them.
 *
 * The argument is `max(|word − middle| + its mark)` and not the furthest word plus the biggest
 * mark: those are usually two different words, and multiplying them together is what made a
 * plate four times the ground its words stood on. See `outline`.
 */
export function plateReach(ink: number): number {
  return ink + PLATE_MARGIN;
}

/**
 * How far a corner is cut.
 *
 * A plate is a polygon and should read as one, so this is a chamfer and not the wholesale
 * rounding a contour wants: enough that the rim is not a set of spikes where three words nearly
 * line up, not so much that a five-sided plate comes out as a blob. Capped at half of each
 * incident edge, so a short edge between two corners is not asked to give up more than it has.
 */
const CORNER = 26;

/** How far a sharp corner may be mitred out before it is cut off square instead. */
const MITER = 2.6;

/** Directions the degenerate case is measured in. See `supportRing`. */
const FACETS = 8;

function hypot(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

/**
 * The convex hull of a set of points, as a ring wound so the shoelace area is positive.
 *
 * Andrew's monotone chain: sort, then sweep the lower and upper boundaries. Collinear points are
 * dropped, so three words in a row give a two-point "hull" — which is what `supportRing` is for.
 */
export function hullOf(points: readonly Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  // Duplicates are common — two words can settle on the same spot — and a repeated point makes
  // the cross product zero and the sweep ambiguous.
  const distinct = sorted.filter(
    (at, i) => i === 0 || at.x !== sorted[i - 1]!.x || at.y !== sorted[i - 1]!.y,
  );
  if (distinct.length < 3) return distinct;

  const cross = (o: Point, a: Point, b: Point) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const half = (order: readonly Point[]): Point[] => {
    const out: Point[] = [];
    for (const at of order) {
      while (out.length >= 2 && cross(out[out.length - 2]!, out[out.length - 1]!, at) <= 0) {
        out.pop();
      }
      out.push(at);
    }
    return out;
  };

  const lower = half(distinct);
  const upper = half([...distinct].reverse());
  // Each half ends where the other begins, so both ends are dropped once. A row of words in a
  // line leaves the two extremes and nothing else, which the caller reads as "too flat to be a
  // polygon" — see `supportRing`.
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Twice the signed area, which is what says which way a ring is wound. */
function winding(ring: readonly Point[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum;
}

/**
 * A ring round a crowd too flat to have a hull: a point, a pair, or a row of words in a line.
 *
 * The plate is the crowd's own shape grown by `away` in every direction, which for a flat crowd
 * is a stadium rather than a polygon. Sampled as the furthest word in each of `FACETS`
 * directions, pushed out along that direction — the Minkowski sum of the crowd with a disc, at
 * eight facets — which comes out convex and in angle order by construction.
 */
function supportRing(points: readonly Point[], away: number): Point[] {
  const ring: Point[] = [];
  for (let facet = 0; facet < FACETS; facet++) {
    const angle = (facet / FACETS) * Math.PI * 2;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    let furthest = points[0]!;
    let reach = -Infinity;
    for (const at of points) {
      const along = at.x * dx + at.y * dy;
      if (along > reach) {
        reach = along;
        furthest = at;
      }
    }
    const to = { x: furthest.x + dx * away, y: furthest.y + dy * away };
    const last = ring[ring.length - 1];
    if (!last || hypot(to.x - last.x, to.y - last.y) > 1e-6) ring.push(to);
  }
  return ring;
}

/**
 * How far out a line has to be pushed, facing this way, to clear every mark in the crowd.
 *
 * `c` in `{ p : p · normal = c }`. Exactly the furthest any word's *ink* reaches in this
 * direction, plus the margin — which is the whole of what makes a plate the size of its own
 * ground and no larger.
 */
function faceOf(normal: Point, blobs: readonly Blob[]): { n: Point; c: number } {
  let reach = -Infinity;
  for (const blob of blobs) {
    reach = Math.max(reach, blob.x * normal.x + blob.y * normal.y + blob.r);
  }
  return { n: normal, c: reach + PLATE_MARGIN };
}

/** The outward unit normal of the edge from one point to the next, in a positively wound ring. */
function normalOf(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = hypot(dx, dy) || 1;
  return { x: dy / length, y: -dx / length };
}

/** Where two offset lines cross. */
function meet(a: { n: Point; c: number }, b: { n: Point; c: number }): Point | null {
  const det = a.n.x * b.n.y - a.n.y * b.n.x;
  if (Math.abs(det) < 1e-9) return null;
  return {
    x: (a.c * b.n.y - a.n.y * b.c) / det,
    y: (a.n.x * b.c - a.c * b.n.x) / det,
  };
}

/**
 * The plate a crowd of words sits on, as one closed ring of points in drawing order.
 *
 * **One ring, always.** A region can be in pieces — a word joined to its territory only through
 * another territory sits apart from it — and one plate over both is the right answer here: the
 * region holds that ground, there is simply nothing on it yet, and two shapes for one place
 * would be two landmarks where the player has learnt one.
 *
 * **Every edge is pushed out by what is actually behind it**, which is the whole of this
 * function and was got wrong once in a way worth writing down. The offset was *uniform*, at the
 * biggest mark anywhere in the crowd plus the margin, because that made containment free: every
 * word is inside the hull of the words, so a hull pushed out past the largest mark holds every
 * mark. What it also does is make the plate a function of the biggest hub rather than of the
 * ground the words stand on — reveal `over` in a region and a hundred-unit mark pushes *all six*
 * of its edges out by a hundred units, so a crowd three hundred across got a plate six hundred
 * across and four times the area, and the plate grew with the number of words in the region
 * instead of with where they reached.
 *
 * So each hull edge carries its own offset: the furthest any word's ink reaches *in that edge's
 * direction*, and the corners are where consecutive offset lines cross. That is exact — the
 * plate is the intersection of half-planes each of which every disc is strictly inside — and it
 * is tight, since each half-plane is touched by whichever word is furthest out that way.
 */
export function outline(blobs: readonly Blob[]): Point[] {
  if (blobs.length === 0) return [];

  const words = blobs.map((blob) => ({ x: blob.x, y: blob.y }));
  const hull = hullOf(words);
  if (hull.length < 3) {
    let widest = 0;
    for (const blob of blobs) widest = Math.max(widest, blob.r);
    return supportRing(words, widest + PLATE_MARGIN);
  }

  // Wound so that the outward normal of the edge from `at` to the next one is (dy, -dx).
  const ring = winding(hull) > 0 ? hull : [...hull].reverse();
  const faces = ring.map((at, i) => faceOf(normalOf(at, ring[(i + 1) % ring.length]!), blobs));

  /*
    A corner is where its two edges' offset lines cross — a mitre, and on a convex ring always a
    finite one. A *sharp* corner, which a sliver of a region has, sends that crossing a long way
    out; there the corner is bevelled instead, by cutting it with a third line facing along the
    bisector and offset by the same rule as the edges. A bevel is another half-plane, so the
    plate stays convex and still holds every mark — which a mitre clamped to a nearer point
    would not.
  */
  const out: Point[] = [];
  for (let i = 0; i < ring.length; i++) {
    const at = ring[i]!;
    const before = faces[(i - 1 + ring.length) % ring.length]!;
    const after = faces[i]!;
    const corner = meet(before, after);
    const clear = Math.max(
      before.c - (at.x * before.n.x + at.y * before.n.y),
      after.c - (at.x * after.n.x + at.y * after.n.y),
    );
    if (corner && hypot(corner.x - at.x, corner.y - at.y) <= MITER * clear) {
      out.push(corner);
      continue;
    }
    const bx = before.n.x + after.n.x;
    const by = before.n.y + after.n.y;
    const length = hypot(bx, by) || 1;
    const across = faceOf({ x: bx / length, y: by / length }, blobs);
    const one = meet(before, across);
    const two = meet(across, after);
    if (one) out.push(one);
    if (two) out.push(two);
    if (!one && !two && corner) out.push(corner);
  }
  return out;
}

/** How far along the edge from `at` toward `to` a corner's cut begins. */
function cutBack(at: Point, to: Point): Point {
  const dx = to.x - at.x;
  const dy = to.y - at.y;
  const length = hypot(dx, dy) || 1;
  const back = Math.min(CORNER, length / 2);
  return { x: at.x + (dx / length) * back, y: at.y + (dy / length) * back };
}

/**
 * A ring as an SVG path, with its corners chamfered.
 *
 * Each corner is cut back along both of its edges and the cut bridged by a quadratic through the
 * corner itself, which needs no control points of its own. **The straights stay straight** — the
 * whole reason this is not the midpoint-to-midpoint rounding a contour wants, which turns every
 * polygon into a blob and would undo the thing the plate is for.
 */
export function ringPath(ring: readonly Point[]): string {
  if (ring.length < 3) return '';
  const round1 = (value: number) => Math.round(value * 10) / 10;
  const to = (at: Point) => `${round1(at.x)} ${round1(at.y)}`;

  let path = '';
  for (let i = 0; i < ring.length; i++) {
    const at = ring[i]!;
    const before = ring[(i - 1 + ring.length) % ring.length]!;
    const after = ring[(i + 1) % ring.length]!;
    const from = cutBack(at, before);
    const onward = cutBack(at, after);
    path += i === 0 ? `M${to(from)}` : `L${to(from)}`;
    path += `Q${to(at)} ${to(onward)}`;
  }
  return `${path}Z`;
}

/** A crowd's plate, as one path. */
export function outlinePath(blobs: readonly Blob[]): string {
  return ringPath(outline(blobs));
}
