/**
 * The camera. Pure arithmetic, and the part of the plate with the sign errors in it —
 * every one of these is a thing that was wrong on screen first.
 */

import { describe, expect, it } from 'vitest';
import {
  GENEROUS_SCALE,
  MAX_SCALE,
  MIN_SCALE,
  between,
  clampCamera,
  fitCamera,
  openingCamera,
  panBy,
  playCamera,
  viewOf,
  zoomAround,
} from './camera';

const phone = { width: 412, height: 640 };
const desktop = { width: 1280, height: 700 };

describe('playCamera', () => {
  it('frames the answer: the spine, centred, filling the plate', () => {
    const camera = playCamera(390, desktop);
    const view = viewOf(camera, desktop);
    expect(camera.cy).toBe(195);
    expect(camera.cx).toBe(0);
    // Source and target both in shot, with air around them.
    expect(view.y).toBeLessThan(0);
    expect(view.y + view.height).toBeGreaterThan(390);
  });

  it('draws a word the same size however much else there is to draw', () => {
    // The whole point: scale comes from the spine, and nothing about the number of
    // words on the board is in it.
    expect(playCamera(390, phone).scale).toBe(playCamera(390, phone).scale);
    expect(playCamera(390, phone).scale).not.toBe(playCamera(650, phone).scale);
  });

  it('draws the words small rather than framing a long answer from the middle', () => {
    // par 10 on a phone, the worst case the bank offers. There used to be a floor of fifteen
    // pixels here — a scale of 1.2 — and legibility won, which from par 7 up meant opening
    // inside the spine with both of the puzzle's own words off the ends of the plate.
    const spine = 10 * 80;
    const camera = playCamera(spine, phone);
    expect(camera.scale).toBeLessThan(15 / 12.5);
    expect(camera.scale).toBeGreaterThan(MIN_SCALE);
    const view = viewOf(camera, phone);
    expect(view.y).toBeLessThan(0);
    expect(view.y + view.height).toBeGreaterThan(spine);
  });

  it('holds the whole answer for every par the bank offers', () => {
    // The bank runs par 3 to par 10 (see .env) and the spine is `par * ROW_HEIGHT`, so this
    // is the promise across all of it: source at the top and target at the bottom, both on
    // screen, on the smallest plate the game is played on.
    const rowHeight = 80;
    for (const par of [3, 4, 5, 7, 10]) {
      for (const plate of [phone, desktop, { width: 412, height: 620 }]) {
        const spine = par * rowHeight;
        const view = viewOf(playCamera(spine, plate), plate);
        expect(view.y).toBeLessThan(0);
        expect(view.y + view.height).toBeGreaterThan(spine);
      }
    }
  });

  it('will not zoom in further than a word wants, however short the answer', () => {
    // Fitting the spine of a par-3 answer would draw its words half again as large as a
    // par-5 one's, which makes the board's apparent size a fact about par.
    expect(playCamera(60, desktop).scale).toBe(GENEROUS_SCALE);
    expect(playCamera(240, phone).scale).toBe(GENEROUS_SCALE);
  });
});

describe('fitCamera', () => {
  it('shows all of something, with air around it', () => {
    const box = { minX: -300, maxX: 300, minY: 0, maxY: 400 };
    const camera = fitCamera(box, desktop);
    const view = viewOf(camera, desktop);
    expect(view.x).toBeLessThanOrEqual(-300);
    expect(view.x + view.width).toBeGreaterThanOrEqual(300);
    expect(view.y).toBeLessThanOrEqual(0);
    expect(view.y + view.height).toBeGreaterThanOrEqual(400);
  });

  it('never zooms past the stops, however small or large the thing is', () => {
    expect(fitCamera({ minX: -1e5, maxX: 1e5, minY: 0, maxY: 1e5 }, phone).scale).toBe(MIN_SCALE);
    expect(fitCamera({ minX: 0, maxX: 1, minY: 0, maxY: 1 }, phone).scale).toBe(MAX_SCALE);
  });
});

describe('openingCamera', () => {
  it('is never nearer than the playing view, even on a board that would fit', () => {
    // A compact figure fits inside the playing view already, and fitting it zoomed
    // *in* — so the opening closed on nothing at all.
    const tight = { minX: -80, maxX: 80, minY: 0, maxY: 300 };
    const opening = openingCamera(tight, 390, desktop);
    expect(opening.scale).toBeLessThan(playCamera(390, desktop).scale);
  });

  it('shows the whole board when the board is wider than the view', () => {
    const sprawl = { minX: -900, maxX: 900, minY: 0, maxY: 390 };
    const opening = openingCamera(sprawl, 390, phone);
    const view = viewOf(opening, phone);
    expect(view.x).toBeLessThanOrEqual(-900);
    expect(view.x + view.width).toBeGreaterThanOrEqual(900);
  });
});

describe('zoomAround', () => {
  it('keeps the point under the pointer where it is', () => {
    const camera = { cx: 0, cy: 200, scale: 1 };
    const at = { x: 100, y: 80 };
    const before = viewOf(camera, desktop);
    const graph = { x: before.x + at.x / camera.scale, y: before.y + at.y / camera.scale };

    const zoomed = zoomAround(camera, desktop, 2, at);
    const after = viewOf(zoomed, desktop);
    expect(after.x + at.x / zoomed.scale).toBeCloseTo(graph.x, 6);
    expect(after.y + at.y / zoomed.scale).toBeCloseTo(graph.y, 6);
  });

  it('stops at the zoom limits rather than running away', () => {
    const at = { x: 0, y: 0 };
    expect(zoomAround({ cx: 0, cy: 0, scale: MAX_SCALE }, desktop, 4, at).scale).toBe(MAX_SCALE);
    expect(zoomAround({ cx: 0, cy: 0, scale: MIN_SCALE }, desktop, 0.1, at).scale).toBe(MIN_SCALE);
  });
});

describe('panBy', () => {
  it('moves the board with the finger, not against it', () => {
    // Dragging right shows what was to the left, so the centre goes left.
    const moved = panBy({ cx: 0, cy: 0, scale: 2 }, 100, 40);
    expect(moved.cx).toBe(-50);
    expect(moved.cy).toBe(-20);
  });
});

describe('clampCamera', () => {
  const box = { minX: -200, maxX: 200, minY: 0, maxY: 400 };

  it('lets any part of the board be brought to the middle of the plate', () => {
    const camera = clampCamera({ cx: 200, cy: 400, scale: 1 }, box, desktop);
    expect(camera.cx).toBe(200);
    expect(camera.cy).toBe(400);
  });

  it('will not let the board be lost altogether', () => {
    const far = clampCamera({ cx: 99_999, cy: 99_999, scale: 1 }, box, desktop);
    const view = viewOf(far, desktop);
    // Something is still in shot: the view's near edge has not passed the figure.
    expect(view.x).toBeLessThan(box.maxX);
    expect(view.y).toBeLessThan(box.maxY);
  });
});

describe('between', () => {
  it('ends where it is told', () => {
    const from = { cx: 0, cy: 0, scale: 0.5 };
    const to = { cx: 100, cy: 200, scale: 2 };
    expect(between(from, to, 0)).toEqual(from);
    expect(between(from, to, 1)).toEqual(to);
  });

  it('moves scale geometrically, so a zoom does not lurch at one end', () => {
    // Halfway between 1× and 4× is 2×, not 2.5×.
    expect(between({ cx: 0, cy: 0, scale: 1 }, { cx: 0, cy: 0, scale: 4 }, 0.5).scale).toBeCloseTo(
      2,
      6,
    );
  });
});
