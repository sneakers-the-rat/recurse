/**
 * `boxOf` predicts how big the plate will draw a word without measuring it, so these tests pin
 * its numbers: nothing at runtime notices if the two disagree.
 */

import { describe, expect, it } from 'vitest';
import { forceSimulation } from 'd3-force';
import {
  boxOf,
  crowded,
  forceBoxes,
  linkDistance,
  settle,
  widestOf,
  LINK_DISTANCE,
  LINK_MIN_DISTANCE,
} from './forces';
import { LABEL_ASCENT, LABEL_CHAR_W, LABEL_CLEAR, LABEL_SIZE, NODE_R, markRadius } from './sizes';
import type { Room, SimNode } from './forces';

describe('the room a word claims', () => {
  it('is its mark when it is not showing a name', () => {
    const dot = boxOf('landsliding', false);
    expect(dot).toEqual(boxOf('ox', false));
    expect(dot.cy).toBe(0);
    expect(dot.w).toBeGreaterThan(NODE_R);
  });

  it('is its label when it is, reaching further up than down', () => {
    const named = boxOf('landsliding', true);
    expect(named.w).toBeCloseTo(('landsliding'.length * LABEL_CHAR_W) / 2 + 9, 6);
    expect(named.cy).toBeLessThan(0);

    // From the label's ascender to the bottom of the mark, plus 3.
    const top = -(NODE_R + LABEL_CLEAR + LABEL_ASCENT);
    expect(named.cy).toBeCloseTo((top + NODE_R) / 2, 6);
    expect(named.h).toBeCloseTo((NODE_R - top) / 2 + 3, 6);
  });

  // A new face or mark size moves these.
  it('comes to the figures the layout has been tuned against', () => {
    expect(boxOf('x', false)).toEqual({ w: 27, h: 27, cy: 0, round: true });
    expect(boxOf('landsliding', true)).toEqual({ w: 51.9, h: 25.5, cy: -8.5, round: false });
    // A short name claims no less than a bare mark.
    expect(boxOf('ox', true).w).toBe(27);
  });

  it('is measured over a whole run of words by the widest of them', () => {
    expect(widestOf([], new Set())).toBe(27);
    expect(widestOf(['ox', 'landsliding'], new Set(['landsliding']))).toBe(51.9);
    expect(widestOf(['ox', 'landsliding'], new Set())).toBe(27);
  });

  // A centred mono name reaches `length * LABEL_CHAR_W / 2` either side of the node.
  it('is never narrower than the name the plate will draw', () => {
    for (const word of ['ox', 'carts', 'landsliding', 'counterrevolutionaries']) {
      const drawn = (word.length * LABEL_CHAR_W) / 2;
      expect(boxOf(word, true).w, word).toBeGreaterThanOrEqual(drawn);
    }
    expect(LABEL_SIZE).toBeGreaterThan(LABEL_CHAR_W);
  });
});

describe('keeping words off each other', () => {
  const room = (id: string): Room => boxOf(id, true);
  const clashes = (nodes: readonly SimNode[]) => [...crowded(nodes, room)].sort();

  /** Long names all on nearly one spot. */
  const heap = (): SimNode[] =>
    ['landsliding', 'colorations', 'heartens', 'sparring', 'baseball', 'courage', 'cages'].map(
      (id, at) => ({ id, x: at * 0.5, y: at * 0.25 }),
    );

  it('finds what is lying over what', () => {
    expect(crowded(heap(), room).size).toBe(7);
    expect(
      crowded(
        [
          { id: 'ox', x: 0, y: 0 },
          { id: 'ax', x: 400, y: 0 },
        ],
        room,
      ).size,
    ).toBe(0);
  });

  /** Settle with the collider as the only force. */
  const untangle = (nodes: SimNode[], ticks = 400) => {
    settle(forceSimulation(nodes).force('room', forceBoxes(room)).stop(), 1, ticks);
    return nodes;
  };

  it('pulls a heap apart with nothing but the collider', () => {
    const nodes = heap();
    expect(clashes(nodes).length).toBeGreaterThan(0);
    expect(clashes(untangle(nodes))).toEqual([]);
  });

  it('keeps names apart and not merely marks', () => {
    const nodes: SimNode[] = [
      { id: 'landsliding', x: 0, y: 0 },
      // Clear of the other's mark, but through its name.
      { id: 'colorations', x: 40, y: 0 },
    ];
    expect(40).toBeGreaterThan(2 * markRadius(1));
    expect(clashes(nodes)).toEqual(['colorations', 'landsliding']);
    untangle(nodes);
    expect(clashes(nodes)).toEqual([]);
    // Side by side they overlap less vertically, so that is the axis they part along.
    expect(Math.abs((nodes[1]!.y ?? 0) - (nodes[0]!.y ?? 0))).toBeGreaterThan(40);
    expect(Math.abs((nodes[1]!.x ?? 0) - (nodes[0]!.x ?? 0))).toBeCloseTo(40, 6);
  });

  it('moves the word that can move when the other is pinned', () => {
    const nodes: SimNode[] = [
      { id: 'landsliding', x: 0, y: 0, fx: 0, fy: 0 },
      { id: 'colorations', x: 10, y: 0 },
    ];
    untangle(nodes);
    expect(nodes[0]!.x).toBe(0);
    expect(clashes(nodes)).toEqual([]);
  });

  it('says the same thing every time', () => {
    const one = untangle(heap());
    const two = untangle(heap());
    expect(one.map((node) => [node.x, node.y])).toEqual(two.map((node) => [node.x, node.y]));
  });
});

describe('how far apart a move is drawn', () => {
  it('is full length between two quiet words and contracts as the busier end gets busier', () => {
    expect(linkDistance(1)).toBeCloseTo(LINK_DISTANCE, 6);
    expect(linkDistance(4)).toBeLessThan(linkDistance(1));
    expect(linkDistance(100)).toBeLessThan(linkDistance(4));
    expect(linkDistance(10_000)).toBeGreaterThan(LINK_MIN_DISTANCE);
    expect(linkDistance(0)).toBeCloseTo(LINK_DISTANCE, 6);
  });
});

describe('settling', () => {
  it('runs the layout to rest without dispatching a single tick', () => {
    const nodes: SimNode[] = [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 1, y: 0 },
    ];
    let ticks = 0;
    const simulation = forceSimulation(nodes)
      .on('tick', () => (ticks += 1))
      .stop();

    settle(simulation, 1, 50);
    expect(ticks).toBe(0);
  });

  it('leaves the caller’s own cooling rate alone', () => {
    const simulation = forceSimulation<SimNode>([{ id: 'a' }])
      .alphaDecay(0.2)
      .stop();
    settle(simulation, 1, 10);
    expect(simulation.alphaDecay()).toBeCloseTo(0.2, 6);
  });

  it('stops at the tick limit rather than running to rest at any cost', () => {
    const nodes: SimNode[] = [{ id: 'a', x: 0, y: 0 }];
    const simulation = forceSimulation(nodes).stop();
    settle(simulation, 1, 3);
    // Three ticks leave alpha well above the minimum.
    expect(simulation.alpha()).toBeGreaterThan(simulation.alphaMin());
  });
});
