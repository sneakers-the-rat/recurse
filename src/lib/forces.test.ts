/**
 * How much room the layout thinks a word takes, pinned.
 *
 * **This is a test about two files agreeing, and it is the only kind of check there can be.**
 * The layout has to know how big a word will be drawn *before* anything is drawn, so `boxOf`
 * models what the plate does rather than measuring it. Nothing at runtime notices when the two
 * part company: the layout goes on arranging boxes that are not the size of the words in them,
 * and the symptom is labels lying across each other on a board the overlap tests call fine.
 *
 * `sizes.ts` is what removed most of that hazard — the mark's radius and the type it is set in
 * are written down once and both sides read them. What is left is the arithmetic here, and
 * these are the numbers it has to keep coming to.
 */

import { describe, expect, it } from 'vitest';
import { forceSimulation } from 'd3-force';
import {
  boxOf,
  crowded,
  forceBoxes,
  linkDistance,
  relax,
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
    // A berth rather than the ink: two dots that close read as one thing.
    expect(dot.w).toBeGreaterThan(NODE_R);
  });

  /**
   * And its label when it is, which is not centred on the node: the name stands *above* the
   * mark, so the ink runs from the top of the label to the bottom of the circle and the box's
   * middle is above the word. Modelling it as symmetric left a gap exactly where the name is,
   * and a dot could come to rest just above a word and be struck through by it.
   */
  it('is its label when it is, reaching further up than down', () => {
    const named = boxOf('landsliding', true);
    expect(named.w).toBeCloseTo(('landsliding'.length * LABEL_CHAR_W) / 2 + 9, 6);
    expect(named.cy).toBeLessThan(0);

    // The box spans from the label's ascender to the bottom of the mark, plus a little air.
    const top = -(NODE_R + LABEL_CLEAR + LABEL_ASCENT);
    expect(named.cy).toBeCloseTo((top + NODE_R) / 2, 6);
    expect(named.h).toBeCloseTo((NODE_R - top) / 2 + 3, 6);
  });

  /**
   * The numbers themselves, which is the point of the file: a face swapped in or a mark
   * resized moves these, and this is what says so out loud rather than letting the layout
   * quietly arrange the wrong shapes.
   */
  it('comes to the figures the layout has been tuned against', () => {
    // A bare mark is a disc, and a mark with its name beside it is the rectangle round the two.
    expect(boxOf('x', false)).toEqual({ w: 27, h: 27, cy: 0, round: true });
    expect(boxOf('landsliding', true)).toEqual({ w: 51.9, h: 25.5, cy: -8.5, round: false });
    // A short name claims no less than a mark: the berth is a floor, not a measurement.
    expect(boxOf('ox', true).w).toBe(27);
  });

  it('is measured over a whole run of words by the widest of them', () => {
    expect(widestOf([], new Set())).toBe(27);
    expect(widestOf(['ox', 'landsliding'], new Set(['landsliding']))).toBe(51.9);
    // Only the ones actually showing a name claim one.
    expect(widestOf(['ox', 'landsliding'], new Set())).toBe(27);
  });

  /**
   * And it has to be at least as wide as the plate will draw, or the layout is arranging
   * boxes the words overflow. The plate sets a name in mono at `LABEL_SIZE`, centred, so it
   * reaches `length * LABEL_CHAR_W / 2` either side of the node.
   */
  it('is never narrower than the name the plate will draw', () => {
    for (const word of ['ox', 'carts', 'landsliding', 'counterrevolutionaries']) {
      const drawn = (word.length * LABEL_CHAR_W) / 2;
      expect(boxOf(word, true).w, word).toBeGreaterThanOrEqual(drawn);
    }
    // The metric is of the face the plate actually uses, at the size it uses.
    expect(LABEL_SIZE).toBeGreaterThan(LABEL_CHAR_W);
  });
});

/**
 * **The promise is absolute: nothing drawn lies over anything else drawn, names included.**
 *
 * Which is why there are two things here and not one. `forceBoxes` is the *tendency* — it shapes
 * the arrangement while the simulation is finding it, and like every force it settles at a
 * balance with whatever is pulling the other way. `relax` is the *promise*, applied to the
 * arrangement afterwards, and what it has to be is total.
 */
describe('keeping words off each other', () => {
  const room = (id: string): Room => boxOf(id, true);
  /**
   * Anything lying over anything, asked of `crowded` rather than modelled here.
   *
   * Which is the point of `crowded` being exported: three things need to agree about whether two
   * words are overlapping — the force, the pass that separates them, and the layout deciding
   * what to free — and a fourth opinion written in a test file is one that can be right about
   * nothing.
   */
  const clashes = (nodes: readonly SimNode[]) => [...crowded(nodes, room)].sort();

  /** A crowd of long names all on one spot: the worst case, and the one that has to come out. */
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

  it('pulls every overlap out of a settled crowd', () => {
    const nodes = heap();
    expect(clashes(nodes).length).toBeGreaterThan(0);
    expect(relax(nodes, room)).toBe(0);
    expect(clashes(nodes)).toEqual([]);
  });

  /**
   * **A label is what collides, not a mark.** Two five-letter words held apart by their
   * fourteen-unit discs are two names written across each other, which is what a circular
   * collider at the mark's radius left everywhere on a map.
   */
  it('keeps names apart and not merely marks', () => {
    const nodes: SimNode[] = [
      { id: 'landsliding', x: 0, y: 0 },
      // Clear of the other's *mark* by a good margin, and straight through its name.
      { id: 'colorations', x: 40, y: 0 },
    ];
    expect(40).toBeGreaterThan(2 * markRadius(1));
    expect(clashes(nodes)).toEqual(['colorations', 'landsliding']);
    relax(nodes, room);
    expect(clashes(nodes)).toEqual([]);
    /*
      And it separated them **vertically**, which is the point of pushing along the axis of least
      penetration: two names side by side overlap by more across than down, so the cheap way out
      is one line up and one line down rather than shoving one of them half an alphabet sideways.
    */
    expect(Math.abs((nodes[1]!.y ?? 0) - (nodes[0]!.y ?? 0))).toBeGreaterThan(40);
    expect(Math.abs((nodes[1]!.x ?? 0) - (nodes[0]!.x ?? 0))).toBeCloseTo(40, 6);
  });

  /** A pinned word is a wall: it does not move, and its partner takes the whole displacement. */
  it('moves the word that can move when the other is pinned', () => {
    const nodes: SimNode[] = [
      { id: 'landsliding', x: 0, y: 0, fx: 0, fy: 0 },
      { id: 'colorations', x: 10, y: 0 },
    ];
    relax(nodes, room);
    expect(nodes[0]!.x).toBe(0);
    expect(clashes(nodes)).toEqual([]);
  });

  /** And the same crowd comes out the same way twice, ties and all. */
  it('says the same thing every time', () => {
    const one = heap();
    const two = heap();
    relax(one, room);
    relax(two, room);
    expect(one.map((node) => [node.x, node.y])).toEqual(two.map((node) => [node.x, node.y]));
  });

  it('is what the simulation is pushing toward while it runs', () => {
    const nodes = heap();
    const simulation = forceSimulation(nodes).force('room', forceBoxes(room)).stop();
    settle(simulation, 1, 300);
    // Not a guarantee — that is `relax`'s job — but it has to do most of the work, or the
    // arrangement handed over is one the relax pass has to invent rather than tidy.
    expect(clashes(nodes).length).toBeLessThan(clashes(heap()).length);
  });
});

describe('how far apart a move is drawn', () => {
  it('is full length between two quiet words and contracts as the busier end gets busier', () => {
    expect(linkDistance(1)).toBeCloseTo(LINK_DISTANCE, 6);
    expect(linkDistance(4)).toBeLessThan(linkDistance(1));
    expect(linkDistance(100)).toBeLessThan(linkDistance(4));
    // Toward the floor, never past it — a hub holds its crowd close, it does not stack it.
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

  /** And puts back whatever decay it was handed, so it can be used mid-animation. */
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
    // Three ticks of the default decay leaves plenty of heat: it stopped because it was told.
    expect(simulation.alpha()).toBeGreaterThan(simulation.alphaMin());
  });
});
