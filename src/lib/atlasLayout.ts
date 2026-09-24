/**
 * Where the words of an open map go.
 *
 * Two scales of force simulation. Each region simulates its own words, in coordinates about the
 * region's centre: moves pull and `forceBoxes` keeps words from overlapping, nothing else. The
 * map simulates the regions, each a convex plate (see hull.ts): borders pull by how many moves
 * cross them (`regionPull`) and `forcePlates` keeps plates apart. A word's position is its
 * region's position plus its offset, so moving a region moves its words rigidly.
 *
 * Each region has its own alpha and is ticked only while hot and still moving (`STILL`), so a
 * guess costs the region it lands in. The map is reheated when a plate changes shape
 * (`GROUND_MOVED`).
 *
 * Pure. `useAtlasLayout` drives the ticking.
 */

import { forceSimulation, type Simulation } from 'd3-force';
import type { Box } from './camera';
import {
  boxOf,
  forceBoxes,
  forcePlates,
  linkDistance,
  reachOf,
  type Room,
  type SimNode,
} from './forces';
import { outline, type Blob } from './hull';
import type { Cluster, ClusterGraph } from './regions';
import { DOT_R } from '../components/plate/sizes';
import { NODE_R } from './sizes';
import { dice, GROW_MS, NO_ENTRANCE, type Entrances } from './sprout';
import type { Point } from './types';

// --- how big a word is, which the arrangement has to agree with ------------------

/** How big the plate draws each word, which the layout must match. */
export interface Sizes {
  /** In graph units. See `markRadius` in sizes.ts. */
  radius(word: string): number;
  degree(word: string): number;
  /** Whether it has been reached, and so shows a name. */
  revealed(word: string): boolean;
}

/** Every word the same size, as on the daily board. */
export const EVEN: Sizes = {
  radius: () => NODE_R,
  degree: () => 1,
  revealed: () => true,
};

/** Clearance round a rim dot, beyond its radius. */
const RIM_AIR = 9;

/**
 * The box each word claims, which nothing else may enter. A found word gets `boxOf` (forces.ts);
 * a rim dot has no name, so it gets a small disc.
 */
export function roomFor(sizes: Sizes): (word: string) => Room {
  return (word) =>
    sizes.revealed(word)
      ? boxOf(word, true, sizes.degree(word))
      : { w: DOT_R + RIM_AIR, h: DOT_R + RIM_AIR, cy: 0, round: true };
}

// --- the numbers -----------------------------------------------------------------

/** Spring strength of a move. The same as `LINK_STRENGTH` in useBoardLayout.ts. */
const LINK_STRENGTH = 0.5;

/**
 * How readily a word gives way in a collision, by its drawn radius: 1 for a rim dot, falling as
 * the square root of its area for bigger marks, so a crowd mostly moves the newcomer. Only the
 * collider reads it; moves weigh their ends by degree instead (`Move.bias`).
 */
const MOBILITY = 0.5;

/** Collider passes per tick, for words and for plates. Tuned on the real map. */
const ROOM_PASSES = 4;
/** The word collider never sees another region, so this is all that keeps regions apart. */
const PLATE_PASSES = 4;

function mobility(radius: number): number {
  return Math.min(1, (DOT_R / Math.max(radius, DOT_R)) ** (2 * MOBILITY));
}

/** The furthest any node moved on the last tick, read off the velocities d3 leaves behind. */
function travelled(nodes: readonly SimNode[]): number {
  let most = 0;
  for (const node of nodes) {
    const step = Math.hypot(node.vx ?? 0, node.vy ?? 0);
    if (step > most) most = step;
  }
  return most;
}

/**
 * Whether a hull has moved more than `GROUND_MOVED`. Compared corner for corner, which relies on
 * `outline` starting from the same extreme point; when it doesn't, this says "changed".
 */
function reshaped(was: readonly Point[], now: readonly Point[]): boolean {
  if (was.length !== now.length) return true;
  for (let i = 0; i < now.length; i++) {
    const before = was[i]!;
    const after = now[i]!;
    if (Math.abs(after.x - before.x) > GROUND_MOVED) return true;
    if (Math.abs(after.y - before.y) > GROUND_MOVED) return true;
  }
  return false;
}

/** Gap left between two plates. */
const REGION_GAP = 70;

/** Border spring strength per crossing move, capped. */
const BORDER_PER_MOVE = 0.06;
const BORDER_MOST = 0.9;

export function regionPull(crossings: number): number {
  return Math.min(BORDER_MOST, Math.max(crossings, 0) * BORDER_PER_MOVE);
}

/**
 * Plates up to this span move freely; larger ones give way in inverse proportion to their span,
 * so a guess shifts a neighbourhood rather than the whole map. Read by both plate forces.
 */
const REGION_NIMBLE = 140;

function regionMobility(span: number): number {
  return Math.min(1, REGION_NIMBLE / Math.max(span, REGION_NIMBLE));
}

/** Plate velocity decay; d3's default is 0.4. Makes the map drift rather than snap. */
const REGION_DRAG = 0.67;

/**
 * Alpha the map is reheated to when a plate changes shape: enough to make room, not enough to
 * rearrange a map the player has learnt.
 */
const REGION_NUDGE = 0.12;

/** Alpha a region is reheated to when its words change. */
const PLACE_NUDGE = 0.6;

/**
 * A simulation whose fastest node moves less than this per tick is stopped, whatever its alpha.
 * With the damping here, such a node can travel only a fraction of a unit more.
 * `atlasLayout.test.ts` checks this leaves no overlaps on the real map.
 */
const STILL = 0.05;

/**
 * How far a hull must move, against the one the map last saw, before the map is reheated. Smaller
 * changes would keep the map simulation warm for as long as any region is.
 */
const GROUND_MOVED = 2;

/** A backstop on `settle`, for a board that does not converge. */
const SETTLE_STEPS = 900;

/** The seed spiral's step angle, as d3 uses for unplaced nodes. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** Spacing of the seed spiral for words within a region. */
const WORD_STEP = 30;

/**
 * About the area fraction a golden-angle spiral of discs covers; used to size the disc a set of
 * plates or words will need. Borders rest at contact, so plates seeded too close together have
 * nothing but the collider to push them out.
 */
const SPIRAL_DENSITY = 0.7;

/** How far a newcomer is seeded from the word it was reached from, to break symmetry. */
const BIRTH_JITTER = 12;

/**
 * Speed a word is released with, scaled by its scheduled growth (sprout.ts) so that the node and
 * its CSS animation move together.
 */
const RELEASE = 7;

// --- what comes out ---------------------------------------------------------------

/** A region: its words, its plate, and where it sits. */
export interface Territory {
  /** Its index in `Regions`, or negative for an island (see `clusterGraph`). */
  region: number;
  /** Its index in the layout's list, stable while the map is open. */
  slot: number;
  name: string;
  words: readonly string[];
  /**
   * Bumped whenever its words may have moved within it. When it is unchanged, only the region's
   * transform needs redrawing.
   */
  shape: number;
  at: Point;
  /** Its plate, relative to `at`. */
  ring: readonly Point[];
  /** The furthest the ring reaches from `at`. */
  span: number;
}

/** Saved state for resuming a map. Offsets survive their region being moved. */
export interface Remembered {
  /** Each word's offset within its region. */
  offsets: ReadonlyMap<string, Point>;
  /** Each region's position, by index in `Regions`. Islands are not kept. */
  places: ReadonlyMap<number, Point>;
}

export const NOTHING: Remembered = { offsets: new Map(), places: new Map() };

// --- the layout -------------------------------------------------------------------

/** One territory: its own simulation, and its plate. */
interface Place {
  cluster: Cluster;
  /**
   * Its index in `places` and its node's id. Cluster indices can renumber on any guess, so
   * borders address places by slot.
   */
  slot: number;
  /** The region's node in the map simulation. */
  node: SimNode;
  /** Its words, relative to `node`. */
  nodes: SimNode[];
  at: Map<string, SimNode>;
  sim: Simulation<SimNode, undefined>;
  /** Each word's moves within this region. */
  degree: Map<string, number>;
  moves: Move[];
  /** Words not yet released: when each is due, and the word it comes out of. See `release`. */
  holding: Map<string, { at: number; from: string }>;
  /** Its plate relative to `node`, and how far that reaches. Recomputed by `reshape`. */
  ring: Point[];
  span: number;
  stale: boolean;
  /** See `Territory.shape`. */
  shape: number;
  /** Whether it has been positioned; unseated places are left out of `middle` and `seatOf`. */
  seated: boolean;
}

/**
 * One move, as a spring. Hand-written rather than `forceLink`, which reads distances and
 * strengths only once, at initialisation.
 */
interface Move {
  a: SimNode;
  b: SimNode;
  /** When it starts pulling: once it has been drawn, so a word is not snapped into place early. */
  liveAt: number;
  /** The `b` end's share of the pull, as in d3's link bias: the busier end moves less. */
  bias: number;
}

export interface AtlasLayout {
  /**
   * Step whatever is still moving; answers whether anything did. `at` is milliseconds into the
   * current arrival; omitted, everything is out and every move pulls.
   */
  tick(at?: number): boolean;
  moving(): boolean;
  /** Tick until nothing moves, or the backstop. */
  settle(limit?: number): void;
  place(word: string): Point | undefined;
  /** A word's position within its region. */
  offset(word: string): Point | undefined;
  /** The `Territory.slot` a word is drawn in, or -1. */
  homeOf(word: string): number;
  positions(): Map<string, Point>;
  territories(): readonly Territory[];
  /** The whole map, plates included. */
  bounds(): Box;
  remember(): Remembered;
  /** Take a new board. Only regions whose words changed are reheated. */
  update(clusters: ClusterGraph, sizes: Sizes, arrivals?: Entrances): void;
}

/** Lay a map out. With `settled`, it resumes where that left off. */
export function atlasLayout(
  clusters: ClusterGraph,
  sizes: Sizes = EVEN,
  settled: Remembered = NOTHING,
): AtlasLayout {
  let marks = sizes;
  let room = roomFor(sizes);
  const places: Place[] = [];
  const regionNodes: SimNode[] = [];
  /** Which place a word lives in. Also how an island is found again, having no stable key. */
  const where = new Map<string, Place>();
  /** Whether each word was revealed last pass, so a mark growing reheats its region. */
  const shown = new Map<string, boolean>();
  /** How many words have been seeded on each word. See `birth`. */
  const children = new Map<string, number>();
  /**
   * Milliseconds into the current arrival, as given to `tick`. `Infinity` means nothing is
   * pending: every word is out and every move pulls.
   */
  let elapsed = Infinity;
  /** Words not yet released, in every place. The collider and springs skip them. */
  const resting = new Set<string>();
  let schedule: Entrances = NO_ENTRANCE;
  /** Borders by slot, with how many moves cross each. */
  let borders: { a: number; b: number; crossings: number }[] = [];

  /** Raise a place's alpha. Never lowers it. */
  function heat(place: Place, alpha: number) {
    if (place.sim.alpha() < alpha) place.sim.alpha(alpha);
  }

  const reachOfWord = (word: string) => reachOf(room(word));

  // --- one place ------------------------------------------------------------------

  function neighboursIn(cluster: Cluster): Map<string, string[]> {
    const near = new Map<string, string[]>();
    for (const { a, b } of cluster.inside) {
      (near.get(a) ?? near.set(a, []).get(a)!).push(b);
      (near.get(b) ?? near.set(b, []).get(b)!).push(a);
    }
    return near;
  }

  function countDegrees(place: Place) {
    place.degree = new Map();
    for (const { a, b } of place.cluster.inside) {
      place.degree.set(a, (place.degree.get(a) ?? 0) + 1);
      place.degree.set(b, (place.degree.get(b) ?? 0) + 1);
    }
  }

  /**
   * Where a new word is seeded: on the first placed neighbour, `BIRTH_JITTER` out, and the
   * collider pushes it out. Each of a parent's children is a golden angle round from the last, so
   * a crowd starts evenly around its parent. With no placed neighbour, on a spiral about the
   * region's centre.
   */
  function birth(
    place: Place,
    word: string,
    near: ReadonlyMap<string, string[]>,
    rank: number,
  ): { at: Point; from: string | null } {
    for (const other of near.get(word) ?? []) {
      const at = place.at.get(other);
      if (at === undefined) continue;
      const nth = children.get(other) ?? 0;
      children.set(other, nth + 1);
      const way = dice(other, 1) * Math.PI * 2 + nth * GOLDEN_ANGLE;
      const out = BIRTH_JITTER * (0.4 + dice(word, 2) * 0.6);
      return {
        at: { x: (at.x ?? 0) + Math.cos(way) * out, y: (at.y ?? 0) + Math.sin(way) * out },
        from: other,
      };
    }
    const away = WORD_STEP * Math.sqrt(rank + 1);
    return {
      at: { x: Math.cos(rank * GOLDEN_ANGLE) * away, y: Math.sin(rank * GOLDEN_ANGLE) * away },
      from: null,
    };
  }

  function admit(place: Place, word: string, near: ReadonlyMap<string, string[]>, rank: number) {
    const one: SimNode = { id: word, x: 0, y: 0 };
    // Registered before it is positioned, so a later sibling can be seeded beside it.
    place.nodes.push(one);
    place.at.set(word, one);
    where.set(word, place);
    const kept = settled.offsets.get(word);
    const born = birth(place, word, near, rank);
    const at = kept ?? born.at;
    one.x = at.x;
    one.y = at.y;

    // A scheduled word waits on the word it came from until its turn; others are placed at once.
    const coming = kept ? undefined : schedule.nodes.get(word);
    if (coming && born.from !== null) {
      place.holding.set(word, { at: coming.delay, from: born.from });
      resting.add(word);
    }
  }

  /**
   * Build a place's forces from its current words and moves. Only moves with both ends held here
   * count: a word stays in the place it was first drawn in even if `clusterGraph` would now
   * adopt it elsewhere.
   */
  function wire(place: Place) {
    const counts = new Map<string, number>();
    const pairs: { a: SimNode; b: SimNode; key: string }[] = [];
    for (const { a, b } of place.cluster.inside) {
      const one = place.at.get(a);
      const two = place.at.get(b);
      if (!one || !two) continue;
      counts.set(a, (counts.get(a) ?? 0) + 1);
      counts.set(b, (counts.get(b) ?? 0) + 1);
      pairs.push({ a: one, b: two, key: `${a} ${b}` });
    }
    place.moves = pairs.map(({ a, b, key }) => {
      const drawn = schedule.edges.get(key) ?? schedule.edges.get(`${b.id} ${a.id}`);
      return {
        a,
        b,
        liveAt: drawn ? drawn.delay + drawn.duration : 0,
        bias: (counts.get(a.id) ?? 1) / ((counts.get(a.id) ?? 1) + (counts.get(b.id) ?? 1)),
      };
    });

    place.sim
      .nodes(place.nodes)
      .force('move', forceMoves(place))
      .force(
        'room',
        forceBoxes(room, {
          iterations: ROOM_PASSES,
          give: (id) => mobility(marks.radius(id)),
          asleep: (id) => resting.has(id),
        }),
      );
    // No centering or charge: a region's shape comes from its moves and the room its words take.
  }

  /**
   * A place's moves as springs, with d3's link arithmetic. The rest length is the gap
   * `linkDistance` wants between the two words' edges plus each word's reach, so it changes as
   * words grow; measuring centre to centre would ask for less than the collider allows.
   *
   * Springs only pull. Keeping words apart is the collider's job; a spring pushing a word born
   * under its parent outward along a near-zero vector sends the whole crowd off to one side.
   */
  function forceMoves(place: Place) {
    return (alpha: number) => {
      for (const move of place.moves) {
        if (elapsed < move.liveAt) continue;
        const { a, b } = move;
        if (resting.has(a.id) || resting.has(b.id)) continue;
        let x = (b.x ?? 0) + (b.vx ?? 0) - (a.x ?? 0) - (a.vx ?? 0);
        let y = (b.y ?? 0) + (b.vy ?? 0) - (a.y ?? 0) - (a.vy ?? 0);
        const away = Math.hypot(x, y);
        if (away < 1e-9) continue;
        const rest =
          reachOfWord(a.id) +
          reachOfWord(b.id) +
          linkDistance(Math.max(place.degree.get(a.id) ?? 1, place.degree.get(b.id) ?? 1));
        if (away <= rest) continue;
        const pull = ((away - rest) / away) * alpha * LINK_STRENGTH;
        x *= pull;
        y *= pull;
        b.vx = (b.vx ?? 0) - x * move.bias;
        b.vy = (b.vy ?? 0) - y * move.bias;
        a.vx = (a.vx ?? 0) + x * (1 - move.bias);
        a.vy = (a.vy ?? 0) + y * (1 - move.bias);
      }
    };
  }

  /**
   * The radius a place will need, from its words' sizes rather than their positions, for seeding
   * before it has settled. Never less than its current span.
   */
  function wants(place: Place): number {
    let ink = 0;
    for (const node of place.nodes) {
      const reach = reachOfWord(node.id);
      ink += reach * reach;
    }
    return Math.max(Math.sqrt(ink / SPIRAL_DENSITY), place.span);
  }

  /**
   * Bump `shape` and recompute the plate over each word's `reachOf`, so names beside marks are
   * covered. Answers whether the plate moved by more than `GROUND_MOVED`; if not, the old ring is
   * kept.
   */
  function reshape(place: Place): boolean {
    place.shape += 1;
    const ground: Blob[] = place.nodes.map((node) => ({
      x: node.x ?? 0,
      y: node.y ?? 0,
      r: reachOfWord(node.id),
    }));
    const ring = outline(ground);
    if (!reshaped(place.ring, ring)) return false;
    place.ring = ring;
    let span = 0;
    for (const at of ring) span = Math.max(span, Math.hypot(at.x, at.y));
    place.span = span;
    return true;
  }

  function join(cluster: Cluster): Place {
    const slot = places.length;
    const place: Place = {
      cluster,
      slot,
      node: { id: String(slot), x: 0, y: 0 },
      nodes: [],
      at: new Map(),
      sim: forceSimulation<SimNode>([]).stop(),
      degree: new Map(),
      moves: [],
      holding: new Map(),
      ring: [],
      span: 0,
      stale: false,
      shape: 0,
      seated: false,
    };
    countDegrees(place);
    const near = neighboursIn(cluster);
    cluster.words.forEach((word, rank) => {
      if (where.has(word)) return;
      admit(place, word, near, rank);
    });
    wire(place);
    // Cold if every word came from a saved map. Set, not `heat`, which only raises.
    place.sim.alpha(place.nodes.every((node) => settled.offsets.has(node.id)) ? 0 : 1);
    reshape(place);
    places.push(place);
    regionNodes.push(place.node);
    return place;
  }

  /**
   * The place already holding a cluster. Found by any of its words, since island keys renumber.
   */
  function findPlace(cluster: Cluster): Place | undefined {
    for (const word of cluster.words) {
      const home = where.get(word);
      if (home) return home;
    }
    return undefined;
  }

  // --- the map scale ----------------------------------------------------------------

  /**
   * Border springs, pulling two plates toward their spans plus `REGION_GAP` apart. Pull only, as
   * `forceMoves` is: spans are circles, and `forcePlates` separates the real shapes. Hand-written
   * for the reason `Move` is: spans change as regions grow.
   */
  function forceBorders() {
    let nodes: SimNode[] = [];
    const force = (alpha: number) => {
      for (const border of borders) {
        const one = nodes[border.a];
        const two = nodes[border.b];
        if (!one || !two) continue;
        const dx = (two.x ?? 0) - (one.x ?? 0);
        const dy = (two.y ?? 0) - (one.y ?? 0);
        const away = Math.hypot(dx, dy);
        if (away < 1e-9) continue;
        const rest = (places[border.a]?.span ?? 0) + (places[border.b]?.span ?? 0) + REGION_GAP;
        if (away <= rest) continue;
        const pull = ((away - rest) / away) * regionPull(border.crossings) * alpha;
        // Shared as the plate collider shares it, so a small place moves toward a large one.
        const giveOne = regionMobility(places[border.a]?.span ?? 0);
        const giveTwo = regionMobility(places[border.b]?.span ?? 0);
        const between = giveOne + giveTwo;
        if (between <= 0) continue;
        one.vx = (one.vx ?? 0) + dx * pull * (giveOne / between);
        one.vy = (one.vy ?? 0) + dy * pull * (giveOne / between);
        two.vx = (two.vx ?? 0) - dx * pull * (giveTwo / between);
        two.vy = (two.vy ?? 0) - dy * pull * (giveTwo / between);
      }
    };
    force.initialize = (given: SimNode[]) => {
      nodes = given;
    };
    return force;
  }

  const map = forceSimulation<SimNode>([])
    .velocityDecay(REGION_DRAG)
    .force('border', forceBorders())
    // Plates collide on their hulls, not their centres, which are hundreds of units apart.
    .force(
      'plates',
      forcePlates(
        {
          ring: (slot) => places[slot]?.ring ?? [],
          span: (slot) => places[slot]?.span ?? 0,
        },
        REGION_GAP,
        {
          iterations: PLATE_PASSES,
          give: (slot) => regionMobility(places[slot]?.span ?? 0),
        },
      ),
    )
    .stop();

  /**
   * Where a region appearing mid-play is seeded: outside its seated neighbours, along the heading
   * from the map's middle through their mean, far enough to clear the widest. At the mean itself
   * it would overlap them. With no seated neighbour, on the golden-angle spiral.
   */
  function seatOf(slot: number): Point {
    let x = 0;
    let y = 0;
    let seen = 0;
    let widest = 0;
    for (const border of borders) {
      const other = border.a === slot ? border.b : border.b === slot ? border.a : -1;
      const beside = places[other];
      if (other < 0 || !beside || !beside.seated) continue;
      x += beside.node.x ?? 0;
      y += beside.node.y ?? 0;
      widest = Math.max(widest, wants(beside));
      seen += 1;
    }
    const here = places[slot];
    const mine = here ? wants(here) : 0;
    if (seen === 0) {
      const away = Math.sqrt(slot + 1) * Math.max(mine, 1) * 2;
      return { x: Math.cos(slot * GOLDEN_ANGLE) * away, y: Math.sin(slot * GOLDEN_ANGLE) * away };
    }

    const mean = { x: x / seen, y: y / seen };
    // Neighbours centred on the middle give no heading; fall back to the golden angle.
    let outX = mean.x - middle().x;
    let outY = mean.y - middle().y;
    const along = Math.hypot(outX, outY);
    if (along < 1e-6) {
      outX = Math.cos(slot * GOLDEN_ANGLE);
      outY = Math.sin(slot * GOLDEN_ANGLE);
    } else {
      outX /= along;
      outY /= along;
    }
    const clear = widest + mine + REGION_GAP;
    return { x: mean.x + outX * clear, y: mean.y + outY * clear };
  }

  /** The mean of the seated places. */
  function middle(): Point {
    let x = 0;
    let y = 0;
    let seen = 0;
    for (const one of places) {
      if (!one.seated) continue;
      x += one.node.x ?? 0;
      y += one.node.y ?? 0;
      seen += 1;
    }
    return seen === 0 ? { x: 0, y: 0 } : { x: x / seen, y: y / seen };
  }

  function seat(one: Place, at: Point) {
    one.node.x = at.x;
    one.node.y = at.y;
    one.seated = true;
  }

  /** Seed every plate on a spiral, biggest first, sized by `SPIRAL_DENSITY`. */
  function spiral() {
    const room = new Map(places.map((one) => [one, wants(one)]));
    const area = places.reduce((sum, one) => sum + room.get(one)! ** 2, 0) / SPIRAL_DENSITY;
    const step = Math.sqrt(area) / Math.sqrt(Math.max(places.length, 1));
    [...places]
      .sort((one, two) => room.get(two)! - room.get(one)!)
      .forEach((one, rank) => {
        const away = step * Math.sqrt(rank);
        seat(one, {
          x: Math.cos(rank * GOLDEN_ANGLE) * away,
          y: Math.sin(rank * GOLDEN_ANGLE) * away,
        });
      });
  }

  /** Rebuild `borders` from the graph's links, as slots. */
  function retie(graph: ClusterGraph) {
    const slotOf = (index: number): number => {
      const cluster = graph.clusters[index];
      const home = cluster ? findPlace(cluster) : undefined;
      return home?.slot ?? -1;
    };
    borders = [];
    for (const link of graph.links) {
      const a = slotOf(link.a);
      const b = slotOf(link.b);
      if (a < 0 || b < 0 || a === b) continue;
      borders.push({ a, b, crossings: link.weight });
    }
  }

  function nudgeMap() {
    if (map.alpha() < REGION_NUDGE) map.alpha(REGION_NUDGE);
  }

  // --- opening it -------------------------------------------------------------------

  for (const cluster of clusters.clusters) join(cluster);
  retie(clusters);
  if (settled.places.size === 0) {
    spiral();
  } else {
    // Remembered places first, so new ones are seated against them.
    for (const one of places) {
      const kept = one.cluster.region >= 0 ? settled.places.get(one.cluster.region) : undefined;
      if (kept) seat(one, kept);
    }
    for (const one of places) if (!one.seated) seat(one, seatOf(one.slot));
  }
  map.nodes(regionNodes);
  for (const one of places) for (const node of one.nodes) shown.set(node.id, sizes.revealed(node.id));
  // Cold unless some place is hot.
  map.alpha(places.every((one) => one.sim.alpha() <= one.sim.alphaMin()) ? 0 : 1);

  // --- the loop ---------------------------------------------------------------------

  const hot = (sim: Simulation<SimNode, undefined>) => sim.alpha() > sim.alphaMin();

  /**
   * Release every held word whose turn has come, pushing it away from the word it came out of at
   * `RELEASE`. Until then it is in `resting`, and nothing collides with it or pulls it.
   */
  function release() {
    for (const one of places) {
      if (one.holding.size === 0) continue;
      for (const [word, due] of [...one.holding]) {
        if (elapsed < due.at) continue;
        one.holding.delete(word);
        resting.delete(word);
        const node = one.at.get(word);
        const from = one.at.get(due.from);
        if (!node) continue;
        // Along its seeding jitter, slower for a word scheduled to grow in more slowly.
        const dx = (node.x ?? 0) - (from?.x ?? node.x ?? 0);
        const dy = (node.y ?? 0) - (from?.y ?? node.y ?? 0);
        const away = Math.hypot(dx, dy) || 1;
        const pace = GROW_MS / Math.max(schedule.nodes.get(word)?.duration ?? GROW_MS, 1);
        node.vx = (dx / away) * RELEASE * pace;
        node.vy = (dy / away) * RELEASE * pace;
        one.stale = true;
        heat(one, PLACE_NUDGE);
      }
    }
  }

  function tick(at: number = Infinity): boolean {
    elapsed = at;
    release();
    let moved = false;
    for (const one of places) {
      if (!hot(one.sim)) continue;
      one.sim.tick();
      if (travelled(one.nodes) < STILL) one.sim.alpha(0);
      one.stale = true;
      moved = true;
    }
    let ground = false;
    for (const one of places) {
      if (!one.stale) continue;
      one.stale = false;
      if (reshape(one)) ground = true;
    }
    if (ground) nudgeMap();
    if (hot(map)) {
      map.tick();
      if (travelled(regionNodes) < STILL) map.alpha(0);
      moved = true;
    }
    return moved;
  }

  function moving(): boolean {
    if (places.some((one) => one.holding.size > 0)) return true;
    return hot(map) || places.some((one) => hot(one.sim));
  }

  return {
    tick,
    moving,

    settle(limit = SETTLE_STEPS) {
      for (let step = 0; step < limit; step++) if (!tick()) return;
    },

    place(word) {
      const home = where.get(word);
      const at = home?.at.get(word);
      if (!home || !at) return undefined;
      return { x: (home.node.x ?? 0) + (at.x ?? 0), y: (home.node.y ?? 0) + (at.y ?? 0) };
    },

    offset(word) {
      const at = where.get(word)?.at.get(word);
      return at ? { x: at.x ?? 0, y: at.y ?? 0 } : undefined;
    },

    homeOf(word) {
      return where.get(word)?.slot ?? -1;
    },

    positions() {
      const out = new Map<string, Point>();
      for (const home of places) {
        const ox = home.node.x ?? 0;
        const oy = home.node.y ?? 0;
        for (const node of home.nodes) {
          out.set(node.id, { x: ox + (node.x ?? 0), y: oy + (node.y ?? 0) });
        }
      }
      return out;
    },

    territories() {
      return places.map((one) => ({
        region: one.cluster.region,
        slot: one.slot,
        shape: one.shape,
        name: one.cluster.name,
        // The words this place holds, which can differ from the cluster's. See `wire`.
        words: one.nodes.map((node) => node.id),
        at: { x: one.node.x ?? 0, y: one.node.y ?? 0 },
        ring: one.ring,
        span: one.span,
      }));
    },

    bounds() {
      // From the plates' spans, so the plates' edges are in shot.
      const box: Box = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
      let first = true;
      for (const one of places) {
        const x = one.node.x ?? 0;
        const y = one.node.y ?? 0;
        const reach = Math.max(one.span, 1);
        if (first) {
          box.minX = x - reach;
          box.maxX = x + reach;
          box.minY = y - reach;
          box.maxY = y + reach;
          first = false;
          continue;
        }
        box.minX = Math.min(box.minX, x - reach);
        box.maxX = Math.max(box.maxX, x + reach);
        box.minY = Math.min(box.minY, y - reach);
        box.maxY = Math.max(box.maxY, y + reach);
      }
      return box;
    },

    remember() {
      const offsets = new Map<string, Point>();
      const seats = new Map<number, Point>();
      for (const one of places) {
        for (const node of one.nodes) offsets.set(node.id, { x: node.x ?? 0, y: node.y ?? 0 });
        // Island keys do not survive a reload.
        if (one.cluster.region >= 0) {
          seats.set(one.cluster.region, { x: one.node.x ?? 0, y: one.node.y ?? 0 });
        }
      }
      return { offsets, places: seats };
    },

    update(next, given, arrivals = NO_ENTRANCE) {
      marks = given;
      room = roomFor(given);
      // A new arrival replaces the old; anything still held from it is released where it is.
      for (const one of places) one.holding.clear();
      resting.clear();
      schedule = arrivals;
      if (arrivals !== NO_ENTRANCE) elapsed = 0;
      const fresh: Place[] = [];

      for (const cluster of next.clusters) {
        const home = findPlace(cluster);
        if (!home) {
          fresh.push(join(cluster));
          continue;
        }
        // Reheated only if a word arrived or a word's revealed state changed (its mark grew).
        home.cluster = cluster;
        countDegrees(home);
        const near = neighboursIn(cluster);
        let disturbed = false;
        cluster.words.forEach((word, rank) => {
          if (where.has(word)) return;
          admit(home, word, near, rank);
          disturbed = true;
        });
        if (!disturbed) {
          for (const node of home.nodes) {
            if (given.revealed(node.id) === shown.get(node.id)) continue;
            disturbed = true;
            break;
          }
        }
        wire(home);
        if (disturbed) heat(home, PLACE_NUDGE);
      }

      for (const one of places) for (const node of one.nodes) shown.set(node.id, given.revealed(node.id));
      retie(next);
      // Seat new regions one at a time, most-connected first, so each sees those before it.
      fresh
        .map((one) => ({
          one,
          ties: borders.filter((b) => b.a === one.slot || b.b === one.slot).length,
        }))
        .sort((a, b) => b.ties - a.ties)
        .forEach(({ one }) => {
          seat(one, seatOf(one.slot));
          reshape(one);
        });
      map.nodes(regionNodes);
      if (fresh.length > 0) nudgeMap();
    },
  };
}
