/**
 * A plate holds every word's room, stands off the outermost, is one piece, and is convex.
 */

import { describe, expect, it } from 'vitest';
import { hullOf, outline, plateGap, ringPath, type Blob } from './hull';
import type { Point } from './types';

/** Point in polygon, by ray casting. */
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

/** Every turn the same way round. */
function convex(ring: readonly Point[]): boolean {
  let sign = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const c = ring[(i + 2) % ring.length]!;
    const turn = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
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
    expect(ringPath(outline([]))).toBe('');
  });

  it('goes round a single word, standing off it', () => {
    const ring = outline([somewhere(0, 0)]);
    expect(inside(ring, { x: 0, y: 0 })).toBe(true);
    // The rim is past the mark's radius of 14.
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

    // A big mark in the middle, already inside the ring, barely changes the plate.
    const withHub = [...ring, somewhere(0, 0, 110)];
    expect(area(withHub)).toBeLessThan(area(ring) * 1.2);
    // And its whole disc is still inside.
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
    // The big mark is on the right, so only that side reaches further out.
    expect(right).toBeGreaterThan(left + 60);
    expect(inside(plate, { x: 290, y: 0 })).toBe(true);
    expect(inside(plate, { x: -290, y: 0 })).toBe(false);
  });

  it('says the same thing every time', () => {
    const words = [somewhere(0, 0), somewhere(130, 20), somewhere(-40, 110)];
    expect(ringPath(outline(words))).toBe(ringPath(outline(words)));
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

describe('plateGap', () => {
  const square = (x: number, y: number, r: number): Point[] => [
    { x: x - r, y: y - r },
    { x: x + r, y: y - r },
    { x: x + r, y: y + r },
    { x: x - r, y: y + r },
  ];
  /** The displacement for `two`, with both rings at the origin. */
  const origin = { x: 0, y: 0 };
  const shoveApart = (one: Point[], two: Point[], gap = 0): Point | null => {
    const found = plateGap(one, origin, two, origin, gap);
    return found ? { x: found.x * found.over, y: found.y * found.over } : null;
  };

  it('says nothing about two shapes that are already clear', () => {
    expect(shoveApart(square(0, 0, 10), square(100, 0, 10))).toBeNull();
  });

  it('counts the air asked for as part of the overlap', () => {
    // Edges twenty apart: clear, but not by thirty.
    expect(shoveApart(square(0, 0, 10), square(40, 0, 10))).toBeNull();
    expect(shoveApart(square(0, 0, 10), square(40, 0, 10), 30)).not.toBeNull();
  });

  it('gives the shortest way out, pointing away from the first', () => {
    // Overlapping by four across and by sixteen up: out is across.
    const by = shoveApart(square(0, 0, 10), square(16, 4, 10))!;
    expect(by.x).toBeCloseTo(4, 6);
    expect(by.y).toBeCloseTo(0, 6);
  });

  it('points the other way when the second shape is the other side', () => {
    const by = shoveApart(square(0, 0, 10), square(-16, 0, 10))!;
    expect(by.x).toBeCloseTo(-4, 6);
  });

  it('separates a pair in a single move, gap included', () => {
    const one = square(0, 0, 10);
    const by = shoveApart(one, square(7, 3, 10), 6)!;
    const moved = square(7, 3, 10).map((at) => ({ x: at.x + by.x, y: at.y + by.y }));
    expect(shoveApart(one, moved, 6)).toBeNull();
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
    // One curve per corner, with straight edges between.
    expect(path.match(/Q/g)).toHaveLength(4);
    expect(path.match(/L/g)).toHaveLength(3);
    expect(ringPath([{ x: 0, y: 0 }])).toBe('');
  });
});
