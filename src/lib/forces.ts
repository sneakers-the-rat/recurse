/**
 * The pieces a force layout of this board is built out of.
 *
 * There is more than one figure now — the daily board hangs off a pinned answer route, and the
 * explore mode's atlas has no route to hang off and lays its words out inside regions — and
 * they are different geometries rather than one geometry with a flag. What they cannot differ
 * about is what they are arranging: a move is drawn the same length on either, a word takes up
 * the same room on either, and neither may show a frame of a board still finding its shape.
 *
 * So what is here is the *units*, not the arrangement. Which forces act, what is pinned and
 * what is reheated when belongs to whichever layout is doing the arranging.
 */

import type { Simulation, SimulationNodeDatum } from 'd3-force';
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
 * How far apart a move is drawn.
 *
 * The *length* is what carries the clustering, and it is per edge: full length between two
 * quiet words, contracting toward `LINK_MIN_DISTANCE` as the busier end gets busier. A hub
 * therefore holds its crowd in close while a plain chain of words stays near full length and
 * reads as a path. One length for every edge is a lattice — a link is a spring to a fixed
 * distance, so it pushes two words apart exactly as hard as it pulls them together, and if
 * that distance is the same everywhere the only arrangement satisfying it is an even mesh.
 *
 * Shared between the figures because a move that reads as one length on the daily board and
 * another on the atlas is two different games' worth of visual grammar for one thing.
 */
export const LINK_DISTANCE = 74;
export const LINK_MIN_DISTANCE = 30;

/** A move's length, given how busy its busier end is. See `LINK_DISTANCE`. */
export function linkDistance(busiest: number): number {
  return (
    LINK_MIN_DISTANCE + (LINK_DISTANCE - LINK_MIN_DISTANCE) / Math.sqrt(Math.max(busiest, 1))
  );
}

/**
 * How much room an unlabelled word claims, which is more than its mark.
 *
 * A dot is four units across and two dots that close read as one thing; this is the berth one
 * asks for rather than the ink it puts down.
 */
const ROOM = 27;
/** Clear air either side of a label, so two on one line read as two words. */
const LABEL_GAP = 9;

/**
 * How much room something takes: half-extents, and how far above the node its middle sits.
 *
 * **`round` is not decoration.** A mark with no name beside it is a disc, and squaring it claims
 * the four corners it does not occupy — on a board where a mark can be two hundred units across
 * that is half again as much room in the diagonals as the ink needs, which is a great deal of
 * pressure on a crowd that has to pack around it. A name standing *beside* a mark makes the pair
 * a rectangle and there is nothing to be done about that.
 */
export interface Room {
  w: number;
  h: number;
  cy: number;
  /** A disc of radius `w`, rather than a box. Then `h` equals `w` and `cy` is nothing. */
  round: boolean;
}

/**
 * How much room a word takes, which is a word that is *showing its name* and a dot
 * otherwise.
 *
 * Every word used to claim its label's room from the start, whether or not it was showing
 * one, so that naming or hinting a word could never move the board. That was the wrong
 * trade, and it was expensive: `landsliding` reserved ninety units of width to draw a
 * four-unit dot, and thirty words reserving room they were not using came to 112,000 square
 * units of demand inside a figure of 84,000 — a third more than fits. Boards were being laid
 * out for a state only dev mode's `name all` ever reaches, and paid for it in every state a
 * player actually sees.
 *
 * So the box is what is drawn. A word that is named, hinted far enough to be spelling itself
 * out, or one of the two the puzzle is about, claims its label; everything else claims its
 * mark. Discovering a word grows its box and shoulders its neighbours aside, which is a
 * small local motion and reads as the word making room for itself.
 */
export function boxOf(
  word: string,
  labelled: boolean,
  /**
   * How many moves the word has, where the board draws that as size — see `markRadius`.
   *
   * One is the mark every word had before degree was drawn at all, so a layout that does not
   * pass it reserves exactly the room it always did.
   */
  degree = 1,
): Room {
  const radius = markRadius(degree);
  const mark = Math.max(ROOM, radius + ROOM - NODE_R);
  // A name big enough to sit inside its own mark asks for no room beside it — so what is left
  // is the mark, and a mark is a disc.
  if (!labelled || insideLabel(word.length, radius) !== null) {
    return { w: mark, h: mark, cy: 0, round: true };
  }
  /*
    A labelled word is not centred on its own mark: the name stands above it, so the ink runs
    from the label's ascender down to the bottom of the circle, and the box's middle is above
    the node. Modelling it as symmetric left a gap exactly where the name is, and a dot could
    come to rest just above a word and be struck through by it.

    **Off the mark's own radius and not off `NODE_R`.** A board that draws degree can put a name
    above a disc seventy units across, and measured from the constant the box stopped at the top
    of a fourteen-unit one — so the label was floating in room the layout had reserved for
    nothing and something else was entitled to sit in it. `NODE_R` is what `markRadius` returns
    for a board that passes no degree, so the daily figure's box is the number it always was.
  */
  const top = -(radius + LABEL_CLEAR + LABEL_ASCENT);
  return {
    w: Math.max(mark, (word.length * LABEL_CHAR_W) / 2 + LABEL_GAP),
    h: (radius - top) / 2 + 3,
    cy: (top + radius) / 2,
    round: false,
  };
}

/**
 * How far a word's room reaches from the node itself, in any direction.
 *
 * A disc round the whole of it, which is coarser than the room is — a labelled word's box is
 * wide and shallow — and is what something that has to hold the *lot* wants: a territory's
 * radius, and the ground drawn under it. Those two and the collider then all read the same
 * `Room`, which is the only way they can agree about how much of the map a word takes.
 */
export function reachOf(room: Room): number {
  return Math.max(room.w, room.h + Math.abs(room.cy));
}

/** The widest box any of these words claims: how wide a berth a run of them needs. */
export function widestOf(words: Iterable<string>, labelled: ReadonlySet<string>): number {
  let widest = ROOM;
  for (const word of words) widest = Math.max(widest, boxOf(word, labelled.has(word)).w);
  return widest;
}

/**
 * The decay a run that nobody watches is stepped at, and the most steps it may take.
 *
 * d3's own default decay, which is chosen to converge in about three hundred ticks. Cheap
 * when it draws nothing: a thirty-word board costs a few tens of milliseconds of blocked main
 * thread, once, before the first frame. A layout that arranges thousands of words has to keep
 * its runs *small* rather than raising this — see atlasLayout.ts, which settles one region at
 * a time for exactly that reason.
 */
const SETTLE_DECAY = 0.0228;
export const SETTLE_LIMIT = 500;

/**
 * Run a simulation to rest without drawing a frame of it.
 *
 * `simulation.tick()` steps the layout without dispatching the tick event, so nothing
 * re-renders while this runs. Synchronous, and therefore paid for in blocked main thread.
 *
 * A board is settled before it is first shown for the same reason a page is laid out before
 * it is painted: a first draw has no information in its movement, and animating it opens the
 * game by flinging thirty words out of a point. Whatever decay the caller was animating at is
 * put back afterwards, so this can be used in the middle of a live simulation.
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

/**
 * How readily a word is pushed around: heavy things move less than light ones.
 *
 * d3 has no notion of mass — every node takes the whole of whatever force lands on it — which
 * on a board where words are different sizes is exactly wrong. A move between a hub and a leaf
 * should mostly move the leaf; a crowd making room for a newcomer should mostly move the
 * newcomer. Without this, a guess shoved a two-hundred-move word across its territory to make
 * space for a dot, and everything joined to it followed.
 *
 * So the last thing each tick does is scale every node's velocity by its own mobility, after
 * every force has had its say. Mass is *area*, because that is what the board draws — and the
 * damping is a root of it rather than the whole, so a word ten times the ink is three times as
 * hard to move rather than ten. Past that the hubs stop finding their own places at all and the
 * arrangement is decided entirely by the leaves.
 */
export function forceMass(mobility: (id: string) => number) {
  let nodes: SimNode[] = [];
  const force = () => {
    for (const node of nodes) {
      const slow = mobility(node.id);
      if (slow >= 1) continue;
      node.vx = (node.vx ?? 0) * slow;
      node.vy = (node.vy ?? 0) * slow;
    }
  };
  force.initialize = (given: SimNode[]) => {
    nodes = given;
  };
  return force;
}

/**
 * Nothing drawn may lie over anything else drawn — **marks and names alike.**
 *
 * `forceCollide` is a disc against a disc, and a word is not a disc: it is a mark with a name
 * standing over it, and on a map of thousands the names are what collide. Sizing a *circular*
 * collider to hold a label is the trade this replaces, and it is a bad one either way round — at
 * the mark's radius the names lie across each other, and at the label's half-diagonal a word
 * that is mostly air claims a disc the width of its longest dimension in every direction, which
 * on a board where a mark can be a hundred units across empties the map and still leaves the
 * labels touching, because the discs were nowhere near each other and the *names* were what
 * overlapped.
 *
 * So the thing kept apart is the room the word actually occupies — `boxOf`, the same arithmetic
 * the region radius and the figure's bounds are measured with, which is a disc for a bare mark
 * and a rectangle for a mark with its name standing beside it. Two of them are pushed apart by
 * the *least* displacement that separates them, which is what a solver does and what makes a
 * crowd settle rather than shear: a name lying just under another's descender moves down a few
 * units instead of sideways past half the alphabet. See `apart`.
 *
 * **Sweep and prune on x**, rather than the quadtree `forceCollide` uses, because a quadtree
 * holds points and these are shapes of wildly different sizes — a hub's is fifty times a rim
 * dot's. Sorting by left edge and walking forward while the spans still overlap is O(n log n)
 * and needs nothing this project does not already have.
 *
 * Velocities and not positions, the way every d3 force works, so `forceMass` still gets the last
 * word about which of two words actually moves. **A pinned word takes none of the push and its
 * partner takes all of it** — half a correction applied to a wall is half a correction lost, and
 * that showed up as the arrival never quite clearing the crowd it arrived in.
 *
 * **Not scaled by the simulation's heat**, which is the one thing here that is not the ordinary
 * pattern, and `forceCollide` does not scale by it either for the same reason: this is a
 * *constraint* rather than a tendency, and a constraint that fades as the run cools is one that
 * stops being enforced exactly when the arrangement is being decided. Left on alpha, two hundred
 * ticks of pushing came to almost nothing and every overlap on the board was left for the pass
 * below to invent room for.
 */
export function forceBoxes(room: (id: string) => Room, strength = 1) {
  let nodes: SimNode[] = [];
  let rooms: Room[] = [];

  const force = () => {
    for (const { i, j, ux, uy, over } of overlaps(nodes, rooms)) {
      const one = nodes[i]!;
      const two = nodes[j]!;
      const pinnedOne = one.fx !== undefined;
      const pinnedTwo = two.fx !== undefined;
      if (pinnedOne && pinnedTwo) continue;
      // All of it to whichever can move, half each when both can.
      const share = (pinnedOne || pinnedTwo ? 1 : 0.5) * over * strength;
      if (!pinnedTwo) {
        two.vx = (two.vx ?? 0) + ux * share;
        two.vy = (two.vy ?? 0) + uy * share;
      }
      if (!pinnedOne) {
        one.vx = (one.vx ?? 0) - ux * share;
        one.vy = (one.vy ?? 0) - uy * share;
      }
    }
  };

  force.initialize = (given: SimNode[]) => {
    nodes = given;
    rooms = given.map((node) => room(node.id));
  };
  return force;
}

/**
 * How much two words may share before it counts as sharing any.
 *
 * **Not fussiness — without it the separation below never terminates.** Resolving one pair nudges
 * whatever else that word is beside, so a crowd ends up ping-ponging at the last decimal place:
 * pass after pass found the same dozen pairs overlapping by a ten-thousandth of a unit and moved
 * them by a ten-thousandth of a unit. Half a unit is a fraction of a pixel at any scale the map
 * is read at, so it is invisible, and it is what lets the pass finish.
 */
const TOUCHING = 0.5;

/** Where a word's room actually sits: its middle, which for a labelled one is above the node. */
function middle(node: SimNode, room: Room): Point {
  return { x: node.x ?? 0, y: (node.y ?? 0) + room.cy };
}

/**
 * The least displacement that takes `two` clear of `one`, as a direction and a depth.
 *
 * **One geometry, three cases, and both of its callers use it** — the force that shapes the
 * arrangement and the pass that makes the promise true — because two implementations of "are
 * these overlapping" is two answers, and the one that draws the board would have been neither.
 *
 * `tie` decides which way two words sitting on exactly the same spot leave in: a coin flip here
 * would make two runs of the same board different arrangements.
 */
function apart(
  one: SimNode,
  roomOne: Room,
  two: SimNode,
  roomTwo: Room,
  tie: number,
): { ux: number; uy: number; over: number } | null {
  const a = middle(one, roomOne);
  const b = middle(two, roomTwo);

  // Two discs: the plain distance test, and the push is along the line between them.
  if (roomOne.round && roomTwo.round) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const away = Math.hypot(dx, dy);
    const over = roomOne.w + roomTwo.w - away;
    if (over <= TOUCHING) return null;
    if (away < 1e-9) return { ux: tie, uy: 0, over };
    return { ux: dx / away, uy: dy / away, over };
  }

  // A disc against a rectangle: from the nearest point of the rectangle to the disc's middle.
  // A disc whose middle is *inside* the rectangle has no such direction, and falls through to
  // the box case on its own bounding square — which is the right answer there anyway, the disc
  // being buried.
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
      const over = round.r - away;
      if (over <= TOUCHING) return null;
      // `way` turns "push the disc out" into "push `two`".
      return { ux: (dx / away) * round.way, uy: (dy / away) * round.way, over };
    }
  }

  // Two rectangles, or a buried disc: apart along whichever axis they share the least.
  const overX = roomOne.w + roomTwo.w - Math.abs(b.x - a.x);
  const overY = roomOne.h + roomTwo.h - Math.abs(b.y - a.y);
  if (overX <= TOUCHING || overY <= TOUCHING) return null;
  if (overX < overY) {
    const dx = b.x - a.x;
    return { ux: dx === 0 ? tie : Math.sign(dx), uy: 0, over: overX };
  }
  const dy = b.y - a.y;
  return { ux: 0, uy: dy === 0 ? tie : Math.sign(dy), over: overY };
}

/**
 * Every pair of nodes whose rooms lie over each other, with how to separate them.
 *
 * Sweep and prune on the left edge: sort by it, and for each word walk forward only while the
 * next one still starts before this one ends. The x-span of a disc is the same as its bounding
 * square's, so one broad phase covers both shapes.
 */
function overlaps(
  nodes: readonly SimNode[],
  rooms: readonly Room[],
): { i: number; j: number; ux: number; uy: number; over: number }[] {
  const order = nodes.map((_unused, index) => index);
  const left = (index: number) => (nodes[index]!.x ?? 0) - rooms[index]!.w;
  order.sort((one, two) => left(one) - left(two) || one - two);

  const found: { i: number; j: number; ux: number; uy: number; over: number }[] = [];
  for (let a = 0; a < order.length; a++) {
    const i = order[a]!;
    const right = (nodes[i]!.x ?? 0) + rooms[i]!.w;
    for (let b = a + 1; b < order.length; b++) {
      const j = order[b]!;
      if (left(j) >= right) break;
      const push = apart(nodes[i]!, rooms[i]!, nodes[j]!, rooms[j]!, i < j ? 1 : -1);
      if (push) found.push({ i, j, ...push });
    }
  }
  return found;
}

/** Which of these are lying over one another, by name. What a layout has to free to fix it. */
export function crowded(nodes: readonly SimNode[], room: (id: string) => Room): Set<string> {
  const rooms = nodes.map((node) => room(node.id));
  const out = new Set<string>();
  for (const { i, j } of overlaps(nodes, rooms)) {
    out.add(nodes[i]!.id);
    out.add(nodes[j]!.id);
  }
  return out;
}

/**
 * How many passes of hard separation a settled crowd is given, and how long they may take.
 *
 * **A force is a tendency and the promise is absolute**, so the simulation is not the last word
 * on it: a spring pulling two words together and a box force pushing them apart reach a balance,
 * and where the spring is strong enough that balance is a small overlap. A settle also stops on
 * a tick budget rather than at rest, so whatever it had not got round to is simply left.
 *
 * So after the arrangement is found, overlaps are resolved *directly* — positions, not
 * velocities, nothing else acting — until a pass finds none left. That is a much easier problem
 * than the layout: it is local, it has a solution, and every pass strictly reduces the overlap.
 * The cap is a backstop against a crowd with genuinely nowhere to go, and it is the one case
 * where a word may still be touching another.
 */
const RELAX_PASSES = 400;

/**
 * Pull every overlap out of a settled crowd.
 *
 * Moves each pair apart along the axis they overlap least, by a hair more than the overlap so
 * that floating point cannot leave them exactly touching and the next pass find it again.
 * A pinned word does not move and its partner takes the whole displacement.
 *
 * Answers how much overlap was left, which is zero unless the cap was reached.
 */
export function relax(nodes: readonly SimNode[], room: (id: string) => Room): number {
  const rooms = nodes.map((node) => room(node.id));
  let worst = 0;
  for (let pass = 0; pass < RELAX_PASSES; pass++) {
    const found = overlaps(nodes, rooms);
    if (found.length === 0) return 0;
    worst = 0;
    for (const { i, j, ux, uy, over } of found) {
      const one = nodes[i]!;
      const two = nodes[j]!;
      worst = Math.max(worst, over);
      const pinnedOne = one.fx !== undefined;
      const pinnedTwo = two.fx !== undefined;
      if (pinnedOne && pinnedTwo) continue;
      // Half each, or the whole of it to whichever can move. A hair past the overlap, so that
      // floating point cannot leave them exactly touching for the next pass to find again.
      const share = (pinnedOne || pinnedTwo ? 1 : 0.5) * (over + TOUCHING);
      if (!pinnedTwo) {
        two.x = (two.x ?? 0) + ux * share;
        two.y = (two.y ?? 0) + uy * share;
      }
      if (!pinnedOne) {
        one.x = (one.x ?? 0) - ux * share;
        one.y = (one.y ?? 0) - uy * share;
      }
    }
  }
  return worst;
}

/**
 * Clear air either side of the answer.
 *
 * The spine is the daily figure's subject and the one thing a player reads first, so nothing
 * that is not part of it may sit on it. Edges may still cross the corridor; a move between one
 * side and the other is a real move and hiding it would be a lie about the graph. Only *nodes*
 * are kept out.
 */
const CORRIDOR_GAP = 16;

/** What the corridor force needs to know about the board it is keeping clear. */
export interface Corridor {
  onRoute: ReadonlySet<string>;
  labelled: ReadonlySet<string>;
  spineHalfWidth: number;
  spineHeight: number;
}

/**
 * Repel everything that is not the answer away from the answer.
 *
 * The spine is a *segment*, not a row of points, and that is the whole reason this exists.
 * Charge treats the pinned words as point sources, so the repulsion along the centre line
 * dips to its weakest exactly halfway between two of them — a hole in the middle of the
 * figure's subject, and where a word with nowhere else to go comes to rest. So this is the
 * same inverse-square repulsion charge uses, from the nearest point on the line rather than
 * from the words strung along it.
 *
 * **A repulsion and not a clamp**, which is the difference between a figure and a diagram.
 * Pushing each word out to a fixed clearance is not a force, it is a wall, and a wall gives
 * every word it touches the same coordinate: the board comes out as two hard vertical ranks
 * of tightly packed dots at exactly the corridor's edge, which is what the frame walls used
 * to do horizontally. Falling off with distance means a word close in is shoved hard, a word
 * already clear is barely touched, and nothing has a preferred place to pile up.
 *
 * Sideways only. A word's height is either the truth about its distance from the source or
 * the business of the links, and shifting it vertically to get it off the line would say
 * something false about the graph to fix something cosmetic.
 *
 * **Reads its parameters through `current` rather than taking them as values**, because the
 * force is built once and the board is not: which words are on the route and which are
 * showing their names both change as it is played. That is the pattern any force here has to
 * follow — a force closing over the state it was built with lays out each layer of a growing
 * board by different arithmetic than the one before it.
 */
export function forceSpineCorridor(push: number, current: () => Corridor) {
  let nodes: SimNode[] = [];

  const force = (alpha: number) => {
    const { onRoute, labelled, spineHalfWidth, spineHeight } = current();
    for (const node of nodes) {
      if (node.fx !== undefined || onRoute.has(node.id)) continue;
      const y = node.y ?? 0;
      // Only alongside the answer. Past either end there is no line to sit on, and the centre
      // is the natural place for a word hanging off the source or the target.
      if (y < 0 || y > spineHeight) continue;

      // How far *into* the answer's ink this word reaches. Its own half-width counts, because
      // a long name centred well clear of the line still crosses it — `landsliding` is 48
      // units wide either way, so clearing its centre clears nothing.
      const x = node.x ?? 0;
      const clear = spineHalfWidth + CORRIDOR_GAP + boxOf(node.id, labelled.has(node.id)).w;
      const inside = clear - Math.abs(x);
      // Already clear: **nothing at all**. This is the whole difference between a figure and a
      // diagram. A force that keeps pushing at every distance drives every word outward until
      // it balances against its links, and since the links are all much the same length every
      // word balances at the same place — two hard vertical ranks of dots at the corridor's
      // edge, which is the frame walls again turned on their side. Acting only on overlap
      // leaves the links and the charge to decide where a word actually sits.
      if (inside <= 0) continue;
      // Whichever side it is already on, so a crowd splits rather than all leaving one way.
      // A word exactly on the line goes right, deterministically — a coin flip here would
      // make two runs of the same board different figures.
      const side = x === 0 ? 1 : Math.sign(x);
      node.vx = (node.vx ?? 0) + inside * side * push * alpha;
    }
  };

  force.initialize = (given: SimNode[]) => {
    nodes = given;
  };
  return force;
}
