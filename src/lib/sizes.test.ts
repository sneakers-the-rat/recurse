/**
 * A board that does not draw degree (the daily one) must get exactly `NODE_R` and never a name
 * inside its mark; the map's marks must grow with degree within bounds.
 */

import { describe, expect, it } from 'vitest';
import { insideLabel, LABEL_CHAR_W, LABEL_SIZE, markRadius, NODE_R } from './sizes';

describe('the mark', () => {
  it('is exactly what it always was for a board that does not draw degree', () => {
    expect(markRadius(1)).toBe(NODE_R);
    expect(markRadius(0)).toBe(NODE_R);
  });

  it('grows with the moves, in order and by a wide margin', () => {
    expect(markRadius(4)).toBeGreaterThan(markRadius(1));
    expect(markRadius(181)).toBeGreaterThan(markRadius(60));
    // Bounds on `CROWD` rather than its value: the busiest word is clearly bigger than a leaf,
    // and smaller than radius proportional to degree.
    expect(markRadius(181) / NODE_R).toBeGreaterThan(3);
    expect(markRadius(181)).toBeLessThan(NODE_R * 181);
  });
});

describe('a name inside its own mark', () => {
  it('never happens at the ordinary mark, however short the word', () => {
    for (const letters of [1, 2, 3, 4, 8]) {
      expect(insideLabel(letters, NODE_R)).toBeNull();
    }
  });

  it('happens once the mark has grown enough to hold the word', () => {
    expect(insideLabel(4, markRadius(120))).not.toBeNull();
    // A radius rather than a degree, so this does not move with `CROWD`: the same disc holds a
    // four-letter name and not a ten-letter one.
    const some = 30;
    expect(insideLabel(4, some)).not.toBeNull();
    expect(insideLabel(10, some)).toBeNull();
  });

  it('fills the mark it is in, and never runs out of it', () => {
    const r = 400;
    const ratio = LABEL_CHAR_W / LABEL_SIZE;
    const width = (letters: number) => insideLabel(letters, r)! * letters * ratio;

    // A long word is limited by width.
    expect(width(6)).toBeLessThan(2 * r * 0.85);
    expect(width(6)).toBeGreaterThan(2 * r * 0.7);
    // A short one is limited by height.
    expect(insideLabel(2, r)!).toBeLessThan(r);
    expect(width(2)).toBeLessThan(2 * r);

    // Type scales with the mark without a ceiling.
    expect(insideLabel(6, 2 * r)!).toBeCloseTo(2 * insideLabel(6, r)!, 6);
    expect(insideLabel(6, 40 * r)!).toBeCloseTo(40 * insideLabel(6, r)!, 6);
  });
});
