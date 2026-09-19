/**
 * What a territory's plate has to be true of.
 *
 * It is a drawn shape and most of what matters about it is taste, which the contact sheet is
 * for. What can be asserted is the four things the plate exists to promise: it **holds every
 * word** it is about, it **stands off** the outermost of them rather than tracing it, it is
 * **one piece with no gaps in it**, and it is **convex** — which is what stops sixty of them
 * interpenetrating on a map, and so is the load-bearing one.
 */

import { describe, expect, it } from 'vitest';
import { hullOf, outline, outlinePath, ringPath, type Blob } from './hull';
import type { Point } from './types';

/** Is this point inside the ring? Ray casting, which is the honest way to ask. */
function inside(ring: readonly Point[], at: Point): boolean {
  let within = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    const straddles = a.y > at.y !== b.y > at.y;
    if (straddles && at.x < ((b.x - a.x) * (at.y - a.y)) / (b.y - a.y) + a.x) within = !within;
  }
  return within;
}

/** Every turn the same way round, which is what convex means and what the map relies on. */
function convex(ring: readonly Point[]): boolean {
  let sign = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const c = ring[(i + 2) % ring.length]!;
    const turn = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    // A straight run is neither turn and says nothing either way.
    if (Math.abs(turn) < 1e-6) continue;
    if (sign === 0) sign = Math.sign(turn);
    else if (Math.sign(turn) !== sign) return false;
  }
  return true;
}

const somewhere = (x: number, y: number, r = 14): Blob => ({ x, y, r });

describe('outline', () => {
  it('has nothing to say about nothing', () => {
    expect(outline([])).toEqual([]);
    expect(outlinePath([])).toBe('');
  });

  it('goes round a single word, standing off it', () => {
    const ring = outline([somewhere(0, 0)]);
    expect(inside(ring, { x: 0, y: 0 })).toBe(true);
    // The rim is clear of the mark rather than tracing it.
    expect(inside(ring, { x: 30, y: 0 })).toBe(true);
    expect(inside(ring, { x: 400, y: 0 })).toBe(false);
  });

  it('holds every word it is about, and their marks with them', () => {
    const words = [
      somewhere(0, 0),
      somewhere(120, 40, 60),
      somewhere(60, -90),
      somewhere(-140, 30),
      somewhere(20, 150),
    ];
    const ring = outline(words);
    for (const word of words) {
      expect(inside(ring, word), `(${word.x}, ${word.y}) is outside its own territory`).toBe(true);
      // And not merely the point: the whole disc the plate is under.
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const edge = { x: word.x + dx * word.r, y: word.y + dy * word.r };
        expect(inside(ring, edge), `the rim of (${word.x}, ${word.y}) breaks out`).toBe(true);
      }
    }
  });

  /**
   * The whole reason it is a hull and not a contour. Two plates whose words are held apart
   * cannot overlap, which is what makes a map of sixty of them read as a tiling; a shape with a
   * bay in it has no such guarantee.
   */
  it('is convex, whatever shape the crowd is in', () => {
    const arm: Blob[] = [];
    for (let i = 0; i <= 8; i++) arm.push(somewhere(-300 + i * 75, -300));
    for (let i = 1; i <= 8; i++) arm.push(somewhere(-300, -300 + i * 75));
    expect(convex(outline(arm))).toBe(true);

    const ring: Blob[] = [];
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      ring.push(somewhere(Math.cos(angle) * 220, Math.sin(angle) * 220));
    }
    expect(convex(outline(ring))).toBe(true);
  });

  /**
   * **One plate and no holes.** A region in two pieces, and a ring of words round an empty
   * middle, are both one place with ground nobody has stood on yet — and that ground is where
   * the next word goes. Two shapes for one region would be two landmarks where the player has
   * learnt one.
   */
  it('is one piece, over the ground between the words as much as over the words', () => {
    const apart = outline([somewhere(0, 0), somewhere(40, 0), somewhere(900, 0)]);
    expect(inside(apart, { x: 450, y: 0 })).toBe(true);

    const round: Blob[] = [];
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      round.push(somewhere(Math.cos(angle) * 220, Math.sin(angle) * 220));
    }
    expect(inside(outline(round), { x: 0, y: 0 })).toBe(true);
  });

  /** A row of words in a line has no hull, and still has an extent. */
  it('gives a flat crowd a shape rather than nothing', () => {
    const line = [somewhere(0, 0), somewhere(80, 0), somewhere(160, 0)];
    const ring = outline(line);
    expect(ring.length).toBeGreaterThanOrEqual(3);
    for (const word of line) expect(inside(ring, word)).toBe(true);
    expect(inside(ring, { x: 80, y: 500 })).toBe(false);
  });

  it('grows with the marks it is about', () => {
    const reach = (blobs: Blob[]) =>
      Math.max(...outline(blobs).map((at) => Math.hypot(at.x, at.y)));
    expect(reach([somewhere(0, 0, 60)])).toBeGreaterThan(reach([somewhere(0, 0, 14)]) + 40);
  });

  /**
   * **The plate is the size of the ground its words stand on, and a big mark in the middle of it
   * is not ground.**
   *
   * The offset was uniform, at the biggest mark anywhere in the crowd, which made containment
   * free and made the plate a function of the busiest word rather than of where the words reach:
   * revealing one hub pushed every edge out by its whole radius, so a crowd three hundred across
   * drew a plate six hundred across — four times the area, and growing with the number of words
   * in the region instead of with its outer boundary.
   */
  it('is the size of the ground, not of the biggest mark in it', () => {
    const ring: Blob[] = [];
    for (let i = 0; i < 10; i++) {
      const angle = (i / 10) * Math.PI * 2;
      ring.push(somewhere(Math.cos(angle) * 150, Math.sin(angle) * 150, 14));
    }
    const area = (blobs: Blob[]) => {
      const at = outline(blobs);
      let twice = 0;
      for (let i = 0; i < at.length; i++) {
        const a = at[i]!;
        const b = at[(i + 1) % at.length]!;
        twice += a.x * b.y - b.x * a.y;
      }
      return Math.abs(twice) / 2;
    };

    // One enormous mark dropped in the middle: it is inside the ring already, so the ground the
    // region holds has not changed and neither should its plate, by more than a little.
    const withHub = [...ring, somewhere(0, 0, 110)];
    expect(area(withHub)).toBeLessThan(area(ring) * 1.2);
    // And it is still held, mark and all — which is what the uniform offset was buying.
    const plate = outline(withHub);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      expect(inside(plate, { x: dx * 110, y: dy * 110 })).toBe(true);
    }
  });

  /** An edge is pushed out by what is behind *it*, so a lopsided crowd gets a lopsided plate. */
  it('pushes each edge out by the ink behind that edge', () => {
    const blobs = [
      somewhere(-200, 0, 14),
      somewhere(200, 0, 90),
      somewhere(0, -160, 14),
      somewhere(0, 160, 14),
    ];
    const plate = outline(blobs);
    const right = Math.max(...plate.map((at) => at.x));
    const left = -Math.min(...plate.map((at) => at.x));
    // The big mark is on the right, so that is the side the plate reaches out on. Under a
    // uniform offset both sides would have been pushed out by the same ninety units and the
    // plate would have come out symmetric about a crowd that is not.
    expect(right).toBeGreaterThan(left + 60);
    expect(inside(plate, { x: 290, y: 0 })).toBe(true);
    expect(inside(plate, { x: -290, y: 0 })).toBe(false);
  });

  it('says the same thing every time', () => {
    const words = [somewhere(0, 0), somewhere(130, 20), somewhere(-40, 110)];
    expect(outlinePath(words)).toBe(outlinePath(words));
  });
});

describe('hullOf', () => {
  it('keeps the corners and drops the middle', () => {
    const hull = hullOf([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 5, y: 5 },
    ]);
    expect(hull).toHaveLength(4);
    expect(hull).not.toContainEqual({ x: 5, y: 5 });
  });

  it('leaves a row of points too flat to be a polygon', () => {
    expect(
      hullOf([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
      ]).length,
    ).toBeLessThan(3);
  });
});

describe('ringPath', () => {
  it('draws a closed outline, chamfered at every corner', () => {
    const path = ringPath([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ]);
    expect(path.startsWith('M')).toBe(true);
    expect(path.endsWith('Z')).toBe(true);
    // One curve per corner, and a straight between each pair — which is what says it is still a
    // polygon rather than a blob.
    expect(path.match(/Q/g)).toHaveLength(4);
    expect(path.match(/L/g)).toHaveLength(3);
    expect(ringPath([{ x: 0, y: 0 }])).toBe('');
  });
});
