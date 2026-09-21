/**
 * What culling has to be true of.
 *
 * Two promises and they pull against each other, which is why they are both written down: a
 * word in shot is always drawn, and a move with one end in shot is drawn *whole* — running off
 * the edge rather than stopping at it, because a map that appeared to end at the viewport
 * would be saying something false about the graph.
 */

import { describe, expect, it } from 'vitest';
import { boundsOf, visible, type Patch } from './detail';
import type { Figure } from './plate';
import type { Point } from './types';

/** A row of words a hundred units apart, each joined to the next. */
function row(count: number): { figure: Figure; positions: Map<string, Point> } {
  const nodes = [...Array(count).keys()].map((i) => `w${String(i).padStart(2, '0')}`);
  const positions = new Map(nodes.map((word, i) => [word, { x: i * 100, y: 0 }]));
  const edges = nodes.slice(1).map((word, i) => ({ a: nodes[i]!, b: word }));
  return { figure: { nodes, edges }, positions };
}

/** One patch per word, so the coarse pass refuses nothing the fine pass would have kept. */
function each(positions: ReadonlyMap<string, Point>): Patch[] {
  return [...positions].map(([word, at]) => ({ words: [word], at, radius: 0 }));
}

describe('visible', () => {
  it('hands the figure straight back when all of it is in shot', () => {
    const { figure, positions } = row(5);
    const all = { x: -500, y: -500, width: 2000, height: 1000 };
    expect(visible(figure, positions, each(positions), all, 0)).toBe(figure);
  });

  it('keeps what is in the view and drops what is not', () => {
    const { figure, positions } = row(20);
    // Words 5 to 9, and nothing else.
    const shot = { x: 500, y: -50, width: 400, height: 100 };
    const drawn = visible(figure, positions, each(positions), shot, 0);

    expect(drawn.nodes).toEqual(['w05', 'w06', 'w07', 'w08', 'w09']);
  });

  it('keeps a move with one end in shot, so the map does not look like it stops', () => {
    const { figure, positions } = row(20);
    const shot = { x: 500, y: -50, width: 400, height: 100 };
    const drawn = visible(figure, positions, each(positions), shot, 0);

    // The moves into and out of the visible run are drawn, even though their far ends are not.
    expect(drawn.edges).toContainEqual({ a: 'w04', b: 'w05' });
    expect(drawn.edges).toContainEqual({ a: 'w09', b: 'w10' });
    expect(drawn.edges).not.toContainEqual({ a: 'w01', b: 'w02' });
  });

  it('keeps a margin, so a name hanging over the edge is not cut off', () => {
    const { figure, positions } = row(20);
    const shot = { x: 500, y: -50, width: 400, height: 100 };
    const tight = visible(figure, positions, each(positions), shot, 0);
    const loose = visible(figure, positions, each(positions), shot, 150);

    expect(loose.nodes.length).toBeGreaterThan(tight.nodes.length);
    expect(loose.nodes).toContain('w04');
    expect(loose.nodes).toContain('w10');
  });

  /**
   * The coarse pass is the point of the patches: a territory's disc stands for a couple of
   * hundred words, so most of a map is refused in tens of comparisons rather than thousands.
   */
  it('refuses a whole territory without looking at its words', () => {
    const { figure, positions } = row(20);
    const near: Patch = { words: figure.nodes.slice(0, 10), at: { x: 450, y: 0 }, radius: 500 };
    const far: Patch = { words: figure.nodes.slice(10), at: { x: 9000, y: 0 }, radius: 100 };
    const shot = { x: 0, y: -50, width: 1000, height: 100 };
    const drawn = visible(figure, positions, [near, far], shot, 0);

    expect(drawn.nodes.every((word) => word < 'w10')).toBe(true);
  });

  it('does not lose a word whose territory is only half in shot', () => {
    const { figure, positions } = row(20);
    const whole: Patch = { words: figure.nodes, at: { x: 950, y: 0 }, radius: 1000 };
    // Words at 0, 100, 200, 300 and 400: the last one is exactly on the edge, which is in.
    const shot = { x: 0, y: -50, width: 400, height: 100 };
    const drawn = visible(figure, positions, [whole], shot, 0);

    expect(drawn.nodes).toEqual(['w00', 'w01', 'w02', 'w03', 'w04']);
  });
});

describe('boundsOf', () => {
  it('measures what is there', () => {
    const box = boundsOf([
      { x: -10, y: 5 },
      { x: 30, y: -7 },
      { x: 12, y: 40 },
    ]);
    expect(box).toEqual({ minX: -10, maxX: 30, minY: -7, maxY: 40 });
  });

  it('pads, and answers a point for nothing at all', () => {
    expect(boundsOf([{ x: 4, y: 4 }], 6)).toEqual({ minX: -2, maxX: 10, minY: -2, maxY: 10 });
    expect(boundsOf([])).toEqual({ minX: 0, maxX: 0, minY: 0, maxY: 0 });
  });
});
