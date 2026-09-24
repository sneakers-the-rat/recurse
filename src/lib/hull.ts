/**
 * The shape a map territory is drawn as (its "plate"): the convex hull of its words, each edge
 * pushed out to clear every word's room, with chamfered corners.
 *
 * Convex so that `plateGap` can give the exact separation between two territories, which
 * `forcePlates` in forces.ts uses to keep them from overlapping.
 */

import type { Point } from './types';

/** A word's position and the radius of its room. */
export interface Blob {
  x: number;
  y: number;
  r: number;
}

/** How far the rim stands off the outermost word's room. */
const PLATE_MARGIN = 28;

/** How far back along each edge a corner is chamfered; at most half the edge. */
const CORNER = 26;

/**
 * How far a corner may be mitred out, as a multiple of its clearance, before it is bevelled
 * instead.
 */
const MITER = 2.6;

/** Directions sampled for a crowd too flat to have a hull. See `supportRing`. */
const FACETS = 8;

/** Overlap below this counts as none, so an exact separation reads as clear. */
const TOUCHING = 1e-6;

function hypot(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

/**
 * The convex hull of a set of points, by Andrew's monotone chain. Collinear points are dropped,
 * so points in a line give a two-point "hull"; see `supportRing`.
 */
export function hullOf(points: readonly Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  // Two words can sit on the same spot, and a repeated point makes the sweep ambiguous.
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
  // Each half ends where the other begins, so both ends are dropped once.
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Twice the signed area: positive or negative by winding. */
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
 * A ring round a crowd too flat to have a hull (a point, a pair, or a line): the furthest word in
 * each of `FACETS` directions, pushed `away` along it. Convex and in angle order.
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
 * The line `{ p : p · normal = c }` facing `normal` that clears every word's room by
 * `PLATE_MARGIN`.
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
 * A territory's plate, as one closed ring, even when its words are in separate pieces.
 *
 * Each hull edge is offset by the furthest any word's room reaches in that edge's direction, not
 * by one uniform amount, so a single large word only pushes out the edges it is behind. Corners
 * are where consecutive offset lines cross.
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

  // A sharp corner's mitre reaches far out, so past `MITER` it is bevelled with a third line
  // along the bisector, offset by the same rule. That keeps the plate convex and containing.
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
 * A ring as an SVG path. Each corner is cut back `CORNER` along both edges and bridged by a
 * quadratic with the corner as its control point; the edges stay straight.
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

/**
 * Which way, and how far, `two` must move to be `gap` clear of `one`, or null if it already is.
 *
 * Separating axis test over two convex rings: they overlap unless some edge normal separates
 * their projections, and the smallest overlap among the normals is the shortest way out. Each
 * ring is relative to its own `at`, which is added to the projection rather than to every
 * corner. A ring of fewer than three points never overlaps.
 */
export function plateGap(
  one: readonly Point[],
  atOne: Point,
  two: readonly Point[],
  atTwo: Point,
  gap = 0,
): { x: number; y: number; over: number } | null {
  if (one.length < 3 || two.length < 3) return null;
  let least = Infinity;
  let awayX = 0;
  let awayY = 0;
  for (const ring of [one, two]) {
    for (let i = 0; i < ring.length; i++) {
      const from = ring[i]!;
      const to = ring[(i + 1) % ring.length]!;
      const nx = -(to.y - from.y);
      const ny = to.x - from.x;
      const len = hypot(nx, ny);
      if (len < 1e-9) continue;
      const ux = nx / len;
      const uy = ny / len;
      let loOne = Infinity;
      let hiOne = -Infinity;
      for (const at of one) {
        const along = at.x * ux + at.y * uy;
        if (along < loOne) loOne = along;
        if (along > hiOne) hiOne = along;
      }
      let loTwo = Infinity;
      let hiTwo = -Infinity;
      for (const at of two) {
        const along = at.x * ux + at.y * uy;
        if (along < loTwo) loTwo = along;
        if (along > hiTwo) hiTwo = along;
      }
      const shiftOne = atOne.x * ux + atOne.y * uy;
      const shiftTwo = atTwo.x * ux + atTwo.y * uy;
      loOne += shiftOne;
      hiOne += shiftOne;
      loTwo += shiftTwo;
      hiTwo += shiftTwo;

      // One separating axis means the plates are clear.
      const over = Math.min(hiOne, hiTwo) - Math.max(loOne, loTwo) + gap;
      if (over <= TOUCHING) return null;
      if (over >= least) continue;
      least = over;
      // Point away from `one`.
      const facing = (loTwo + hiTwo) / 2 >= (loOne + hiOne) / 2 ? 1 : -1;
      awayX = ux * facing;
      awayY = uy * facing;
    }
  }
  return least === Infinity ? null : { x: awayX, y: awayY, over: least };
}
