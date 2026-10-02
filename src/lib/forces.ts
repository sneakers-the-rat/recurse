/**
 * Force-layout pieces shared by the daily board (useBoardLayout.ts) and the map (atlasLayout.ts).
 *
 * Move lengths, how much room a word takes, and the colliders that keep words apart. Which forces
 * act and what is pinned belongs to each layout.
 */

import type { Simulation, SimulationNodeDatum } from 'd3-force';
import { plateGap } from './hull';
import type { Point } from './types';
import {
  insideLabel,
  LABEL_ASCENT,
  LABEL_CHAR_W,
  LABEL_CLEAR,
  markRadius,
  NODE_R,
} from './sizes';

export interface SimNode extends SimulationNodeDatum {
  id: string;
  fx?: number | undefined;
  fy?: number | undefined;
}

export interface SimLink {
  source: string | SimNode;
  target: string | SimNode;
}

/**
 * The gap a move is drawn with: `LINK_DISTANCE` between two quiet words, shrinking toward
 * `LINK_MIN_DISTANCE` as the busier end gains moves, so a hub holds its neighbours close.
 *
 * The daily board uses it as the centre-to-centre length. The map, whose marks vary in size,
 * uses it as the clear space between two words' rooms and adds `reachOf` for each end.
 */
export const LINK_DISTANCE = 74;
export const LINK_MIN_DISTANCE = 30;

/** The gap for a move whose busier end has `busiest` moves. See `LINK_DISTANCE`. */
export function linkDistance(busiest: number): number {
  return (
    LINK_MIN_DISTANCE + (LINK_DISTANCE - LINK_MIN_DISTANCE) / Math.sqrt(Math.max(busiest, 1))
  );
}

/** Room an unlabelled word claims: more than its mark, so two dots never sit touching. */
const ROOM = 27;
/** Space either side of a label. */
const LABEL_GAP = 9;

/**
 * The space a word occupies, which the colliders keep apart: half-extents, and how far above the
 * node its middle sits. A bare mark is a disc (`round`); a mark with its name beside it is a box.
 */
export interface Room {
  w: number;
  h: number;
  cy: number;
  /** A disc of radius `w`. Then `h` equals `w` and `cy` is 0. */
  round: boolean;
}

/**
 * The room a word takes: its label's box if `labelled`, otherwise just its mark. Only a word
 * actually showing its name claims the space for it.
 */
export function boxOf(
  word: string,
  labelled: boolean,
  /** How many moves the word has, for a board that draws degree. See `markRadius`. */
  degree = 1,
): Room {
  const radius = markRadius(degree);
  const mark = Math.max(ROOM, radius + ROOM - NODE_R);
  // A name that fits inside its mark needs no room beside it.
  if (!labelled || insideLabel(word.length, radius) !== null) {
    return { w: mark, h: mark, cy: 0, round: true };
  }
  // The name stands above the mark, so the box runs from the label's ascender to the bottom of
  // the mark and its middle is above the node.
  const top = -(radius + LABEL_CLEAR + LABEL_ASCENT);
  return {
    w: Math.max(mark, (word.length * LABEL_CHAR_W) / 2 + LABEL_GAP),
    h: (radius - top) / 2 + 3,
    cy: (top + radius) / 2,
    round: false,
  };
}

/** The radius of a circle about the node that holds all of its room. */
export function reachOf(room: Room): number {
  return Math.max(room.w, room.h + Math.abs(room.cy));
}

/** The widest half-width any of these words claims. */
export function widestOf(words: Iterable<string>, labelled: ReadonlySet<string>): number {
  let widest = ROOM;
  for (const word of words) widest = Math.max(widest, boxOf(word, labelled.has(word)).w);
  return widest;
}

/** Decay and step cap for an unwatched run. d3's default decay: about 300 ticks to rest. */
const SETTLE_DECAY = 0.0228;
export const SETTLE_LIMIT = 500;

/**
 * Run a simulation to rest synchronously, without dispatching tick events, so nothing renders
 * meanwhile. The caller's decay is restored afterwards.
 */
export function settle<N extends SimNode>(
  simulation: Simulation<N, undefined>,
  alpha: number,
  ticks: number = SETTLE_LIMIT,
): void {
  const animated = simulation.alphaDecay();
  simulation.stop().alpha(alpha).alphaDecay(SETTLE_DECAY);
  let steps = 0;
  while (simulation.alpha() > simulation.alphaMin() && steps < ticks) {
    simulation.tick();
    steps += 1;
  }
  simulation.alphaDecay(animated);
}

export interface Boxes {
  strength?: number;
  /**
   * Passes per tick. One pass under-resolves a dense crowd, since separating one pair moves words
   * that are in other pairs too.
   */
  iterations?: number;
  /**
   * How readily each word gives way, from 0 (immovable) to 1; equal by default. Each overlap is
   * split in proportion, so a big word lying over many small ones is not shoved out by the sum
   * of their pushes.
   */
  give?: (id: string) => number;
  /**
   * A word not yet out takes no part: it pushes nothing and is not pushed. Pinning it instead
   * would make it a fixed obstacle that shoves everything born under it away.
   */
  asleep?: (id: string) => boolean;
  /**
   * How far past contact two rooms still repel, and how hard: linearly from nothing at `halo` to
   * `soft` at contact, scaled by alpha. Spreads a crowd evenly rather than leaving it where shoved.
   */
  halo?: number;
  soft?: number;
  /**
   * The most one pair is pushed apart per pass. Set to the speed limit (`forceSpeed`), or a word
   * buried deep in a hub pushes it hard every tick it spends crawling out.
   */
  most?: () => number;
  /**
   * Words still coming out of the word they were born under, mapped to it. Such a pair pushes only
   * the newcomer, so a parent is not shoved aside by its own children. An entry is removed once the
   * pair no longer overlaps.
   */
  emerging?: Map<string, string>;
}

/**
 * A collider over each word's `Room` (from `boxOf`), so labels are kept apart as well as marks.
 * Each overlapping pair is pushed apart by the least displacement that separates it (`apart`),
 * found by sweep and prune on x. A pinned word takes none of the push. Not scaled by alpha,
 * like `forceCollide`: a constraint must hold as the run cools. `halo` is the exception.
 */
export function forceBoxes(room: (id: string) => Room, opts: Boxes = {}) {
  const {
    strength = 1,
    iterations = 1,
    give = () => 1,
    asleep,
    halo = 0,
    soft = 0,
    most = () => Infinity,
    emerging,
  } = opts;
  let nodes: SimNode[] = [];
  let gives: number[] = [];

  const bearing = (child: SimNode, parent: SimNode) => emerging?.get(child.id) === parent.id;

  /** Push a pair apart by `push`, split by how readily each gives way. */
  const shove = (i: number, j: number, ux: number, uy: number, push: number) => {
    const one = nodes[i]!;
    const two = nodes[j]!;
    // A pinned word gives nothing, nor does a parent to its emerging child.
    const giveOne = one.fx !== undefined || bearing(two, one) ? 0 : gives[i]!;
    const giveTwo = two.fx !== undefined || bearing(one, two) ? 0 : gives[j]!;
    const between = giveOne + giveTwo;
    if (between <= 0) return;
    two.vx = (two.vx ?? 0) + ux * push * (giveTwo / between);
    two.vy = (two.vy ?? 0) + uy * push * (giveTwo / between);
    one.vx = (one.vx ?? 0) - ux * push * (giveOne / between);
    one.vy = (one.vy ?? 0) - uy * push * (giveOne / between);
  };

  const force = (alpha: number) => {
    // Every tick, since a growing word's room changes.
    const rooms = nodes.map((node) => room(node.id));
    const cap = most();
    if (halo > 0 && soft > 0) {
      for (const { i, j, ux, uy, over } of overlaps(nodes, rooms, CLEARANCE + halo, asleep)) {
        shove(i, j, ux, uy, Math.min(over, halo) * (soft / halo) * alpha);
      }
    }
    const inside = new Set<string>();
    for (let pass = 0; pass < iterations; pass++) {
      const last = pass === iterations - 1;
      for (const { i, j, ux, uy, over } of overlaps(nodes, rooms, CLEARANCE, asleep)) {
        if (last && emerging) {
          if (bearing(nodes[i]!, nodes[j]!)) inside.add(nodes[i]!.id);
          if (bearing(nodes[j]!, nodes[i]!)) inside.add(nodes[j]!.id);
        }
        shove(i, j, ux, uy, Math.min(over * strength, cap));
      }
    }
    if (emerging) {
      for (const child of emerging.keys()) {
        if (!inside.has(child) && !asleep?.(child)) emerging.delete(child);
      }
    }
  };

  force.initialize = (given: SimNode[]) => {
    nodes = given;
    gives = given.map((node) => Math.max(give(node.id), 0));
  };
  return force;
}

export interface Plates {
  /** This territory's convex hull, relative to its node's position. */
  ring(index: number): readonly Point[];
  /** How far that ring reaches from the node; pairs further apart are skipped. */
  span(index: number): number;
}

/**
 * `forceBoxes` for territories: keeps their convex hulls `gap` apart, using `plateGap` in hull.ts
 * for the exact separation. Pairs are checked all against all, after a circle test on `span`.
 */
export function forcePlates(
  plates: Plates,
  gap: number,
  opts: { strength?: number; iterations?: number; give?: (index: number) => number } = {},
) {
  const { strength = 1, iterations = 1, give = () => 1 } = opts;
  let nodes: SimNode[] = [];
  // Reused across pairs to avoid an allocation per comparison.
  const here = { x: 0, y: 0 };
  const there = { x: 0, y: 0 };

  const force = () => {
    for (let pass = 0; pass < iterations; pass++) {
      for (let i = 0; i < nodes.length; i++) {
        const one = nodes[i]!;
        here.x = (one.x ?? 0) + (one.vx ?? 0);
        here.y = (one.y ?? 0) + (one.vy ?? 0);
        const reach = plates.span(i);
        for (let j = i + 1; j < nodes.length; j++) {
          const two = nodes[j]!;
          there.x = (two.x ?? 0) + (two.vx ?? 0);
          there.y = (two.y ?? 0) + (two.vy ?? 0);
          const away = Math.hypot(there.x - here.x, there.y - here.y);
          if (away > reach + plates.span(j) + gap) continue;

          const giveOne = one.fx !== undefined ? 0 : Math.max(give(i), 0);
          const giveTwo = two.fx !== undefined ? 0 : Math.max(give(j), 0);
          const between = giveOne + giveTwo;
          if (between <= 0) continue;
          const push = plateGap(plates.ring(i), here, plates.ring(j), there, gap);
          if (!push) continue;

          // Split by `give`, as in `forceBoxes`.
          const apart = push.over * strength;
          two.vx = (two.vx ?? 0) + push.x * apart * (giveTwo / between);
          two.vy = (two.vy ?? 0) + push.y * apart * (giveTwo / between);
          one.vx = (one.vx ?? 0) - push.x * apart * (giveOne / between);
          one.vy = (one.vy ?? 0) - push.y * apart * (giveOne / between);
        }
      }
    }
  };

  force.initialize = (given: SimNode[]) => {
    nodes = given;
  };
  return force;
}

/**
 * The furthest each node may move in one tick, whatever the forces want. Added last, so it caps
 * their sum. `decay` is the simulation's `velocityDecay`, which d3 applies before the step.
 */
export function forceSpeed(most: (node: SimNode) => number, decay: number) {
  let nodes: SimNode[] = [];
  const force = () => {
    for (const node of nodes) {
      const top = most(node) / (1 - decay);
      if (top === Infinity) continue;
      const speed = Math.hypot(node.vx ?? 0, node.vy ?? 0);
      if (speed <= top) continue;
      node.vx = ((node.vx ?? 0) * top) / speed;
      node.vy = ((node.vy ?? 0) * top) / speed;
    }
  };
  force.initialize = (given: SimNode[]) => {
    nodes = given;
  };
  return force;
}

/**
 * Air the collider keeps between two rooms. Pushing only to contact leaves springs holding pairs
 * a hair inside each other at rest; separating to this margin leaves them clear.
 */
const CLEARANCE = 4;

/**
 * The middle of a word's room at its position plus velocity, as d3's colliders do, so each pass
 * in a tick sees what the previous one did.
 */
function middle(node: SimNode, room: Room): Point {
  return { x: (node.x ?? 0) + (node.vx ?? 0), y: (node.y ?? 0) + (node.vy ?? 0) + room.cy };
}

/**
 * The least displacement that takes `two` to `margin` clear of `one`, as a direction and a depth,
 * or null. `tie` is the direction for two words on the same spot, keeping the layout
 * deterministic.
 */
function apart(
  one: SimNode,
  roomOne: Room,
  two: SimNode,
  roomTwo: Room,
  tie: number,
  margin: number,
): { ux: number; uy: number; over: number } | null {
  const a = middle(one, roomOne);
  const b = middle(two, roomTwo);

  // Two discs: push along the line between them.
  if (roomOne.round && roomTwo.round) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const away = Math.hypot(dx, dy);
    const over = roomOne.w + roomTwo.w + margin - away;
    if (over <= 0) return null;
    if (away < 1e-9) return { ux: tie, uy: 0, over };
    return { ux: dx / away, uy: dy / away, over };
  }

  // A disc against a rectangle: push from the rectangle's nearest point to the disc's middle.
  // A disc whose middle is inside the rectangle falls through to the box case.
  const round = roomOne.round ? { at: a, r: roomOne.w, way: -1 } : roomTwo.round ? { at: b, r: roomTwo.w, way: 1 } : null;
  if (round) {
    const box = round.way === 1 ? { at: a, room: roomOne } : { at: b, room: roomTwo };
    const near = {
      x: Math.max(box.at.x - box.room.w, Math.min(round.at.x, box.at.x + box.room.w)),
      y: Math.max(box.at.y - box.room.h, Math.min(round.at.y, box.at.y + box.room.h)),
    };
    const dx = round.at.x - near.x;
    const dy = round.at.y - near.y;
    const away = Math.hypot(dx, dy);
    if (away > 1e-9) {
      const over = round.r + margin - away;
      if (over <= 0) return null;
      // `way` turns "push the disc out" into "push `two`".
      return { ux: (dx / away) * round.way, uy: (dy / away) * round.way, over };
    }
  }

  // Two rectangles, or a buried disc: along the axis of least overlap.
  const overX = roomOne.w + roomTwo.w + margin - Math.abs(b.x - a.x);
  const overY = roomOne.h + roomTwo.h + margin - Math.abs(b.y - a.y);
  if (overX <= 0 || overY <= 0) return null;
  if (overX < overY) {
    const dx = b.x - a.x;
    return { ux: dx === 0 ? tie : Math.sign(dx), uy: 0, over: overX };
  }
  const dy = b.y - a.y;
  return { ux: 0, uy: dy === 0 ? tie : Math.sign(dy), over: overY };
}

/**
 * Every pair of nodes whose rooms come within `margin` of each other, with how to separate them.
 * Sweep and prune: sort by left edge, and walk forward only while the next one starts before this
 * one ends.
 */
function overlaps(
  nodes: readonly SimNode[],
  rooms: readonly Room[],
  margin: number,
  /** See `Boxes`. */
  asleep?: (id: string) => boolean,
): { i: number; j: number; ux: number; uy: number; over: number }[] {
  const order = nodes
    .map((_unused, index) => index)
    .filter((index) => !asleep?.(nodes[index]!.id));
  const left = (index: number) =>
    (nodes[index]!.x ?? 0) + (nodes[index]!.vx ?? 0) - rooms[index]!.w;
  order.sort((one, two) => left(one) - left(two) || one - two);

  const found: { i: number; j: number; ux: number; uy: number; over: number }[] = [];
  for (let a = 0; a < order.length; a++) {
    const i = order[a]!;
    const right = (nodes[i]!.x ?? 0) + (nodes[i]!.vx ?? 0) + rooms[i]!.w;
    for (let b = a + 1; b < order.length; b++) {
      const j = order[b]!;
      if (left(j) >= right + margin) break;
      const push = apart(nodes[i]!, rooms[i]!, nodes[j]!, rooms[j]!, i < j ? 1 : -1, margin);
      if (push) found.push({ i, j, ...push });
    }
  }
  return found;
}

/** The ids of every node whose room overlaps another's. */
export function crowded(nodes: readonly SimNode[], room: (id: string) => Room): Set<string> {
  const rooms = nodes.map((node) => room(node.id));
  const out = new Set<string>();
  for (const { i, j } of overlaps(nodes, rooms, 0)) {
    out.add(nodes[i]!.id);
    out.add(nodes[j]!.id);
  }
  return out;
}

/** Space kept clear of words either side of the daily answer. Edges may still cross it. */
const CORRIDOR_GAP = 16;

export interface Corridor {
  onRoute: ReadonlySet<string>;
  labelled: ReadonlySet<string>;
  spineHalfWidth: number;
  spineHeight: number;
}

/**
 * Push words that are not on the daily answer sideways out of the corridor along it.
 *
 * Charge from the pinned route words is weakest halfway between two of them, so without this a
 * word can come to rest on the line. The push is proportional to how far a word's box reaches
 * into the corridor and is zero once it is clear, so words do not pile up at the edge. Sideways
 * only, since a word's height is set by the links. Reads `current` each tick because the route
 * and the labelled words change as the board is played.
 */
export function forceSpineCorridor(push: number, current: () => Corridor) {
  let nodes: SimNode[] = [];

  const force = (alpha: number) => {
    const { onRoute, labelled, spineHalfWidth, spineHeight } = current();
    for (const node of nodes) {
      if (node.fx !== undefined || onRoute.has(node.id)) continue;
      const y = node.y ?? 0;
      // Only alongside the answer, not past either end.
      if (y < 0 || y > spineHeight) continue;

      // How far this word's box reaches into the corridor.
      const x = node.x ?? 0;
      const clear = spineHalfWidth + CORRIDOR_GAP + boxOf(node.id, labelled.has(node.id)).w;
      const inside = clear - Math.abs(x);
      if (inside <= 0) continue;
      // Out the side it is already on; a word exactly on the line goes right.
      const side = x === 0 ? 1 : Math.sign(x);
      node.vx = (node.vx ?? 0) + inside * side * push * alpha;
    }
  };

  force.initialize = (given: SimNode[]) => {
    nodes = given;
  };
  return force;
}
