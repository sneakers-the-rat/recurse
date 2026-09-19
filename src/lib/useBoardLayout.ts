/**
 * A live, growing layout for the board.
 *
 * Three rules, and nothing else decides where a word goes:
 *
 *  1. **The answer is the spine.** Source at the top, target at the bottom, and the
 *     waypoints between them evenly spaced down the centre line. These are pinned.
 *  2. **Everything else is force directed.** Three forces and no more: links, charge, and a
 *     corridor keeping the spine clear. No word is given a position; it finds one by being
 *     pulled toward what it is joined to and pushed away from what it is not.
 *  3. **A new word sprouts from the word it was reached from** and nudges its neighbours
 *     aside to make room. The rest of the board stays where the player left it.
 *
 * A force is a rule about the graph, so the forces are **built once** and read the board
 * through refs. Only the node and link *sets* change as words arrive. Rebuilding a force to
 * let it see new state is the trap: `forceLink` recomputes its degree bias in its own
 * `initialize`, so a fresh instance handed a partial link list lays the board out by
 * different arithmetic than the one before it.
 *
 * Nothing anywhere assigns a coordinate by anything other than the graph. Words were once
 * given *lanes* by their distance off the answer and a side within the lane by their spelling,
 * which put a word joined to two others across the board from both; and a frame with walls
 * stacked whatever reached it into horizontal lines. A force layout only works if the forces
 * are the ones the graph implies.
 *
 * What is kept is about *motion*, not position:
 *
 * - A board is settled before it is first shown — stepped to rest with the tick event
 *   suppressed, so not one frame reaches the screen. A first draw has no information in its
 *   movement; animating it opens the game by flinging thirty words out of a point.
 * - The simulation persists and the node set only ever grows, so a word that comes back
 *   comes back where it was and the figure never restarts under the player.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { forceLink, forceManyBody, forceSimulation, type Simulation } from 'd3-force';
import type { Box } from './camera';
import {
  forceSpineCorridor,
  linkDistance as lengthOf,
  settle as toRest,
  widestOf,
  LINK_DISTANCE,
  SETTLE_LIMIT,
  type Corridor,
  type SimLink,
  type SimNode,
} from './forces';
import type { PlateEdge } from './plate';
import type { Point } from './types';

/**
 * Vertical distance between consecutive moves along the spine.
 *
 * A move is always this far, so the figure's height is the length of the answer and nothing
 * else — which makes this number, and not the camera, what decides how big a word is drawn.
 * The play view fits the spine, so `par * ROW_HEIGHT + 104` graph units are shown in about 620
 * pixels of phone: 80 draws a par-5 answer's words at 15px and a par-10 answer's at 9px. It is
 * the one lever on that, since the camera no longer trades the answer's own ends away to keep
 * the words large (see GENEROUS_SCALE) — a bank of longer pars is a bank of smaller words until
 * this number changes.
 */
const ROW_HEIGHT = 80;

/**
 * How firmly a move holds. Its *length* is `linkDistance` in forces.ts, which both figures
 * share; how hard the spring pulls is this figure's own decision.
 *
 * Flat, because d3's default is `1 / min(degree)`, which makes a hub's bonds
 * the weakest on the board — the opposite of what is wanted here, since the short hub links
 * are the whole mechanism by which a cluster forms.
 *
 * But it is a spring and not a rod. At 1 a link is a hard constraint, and a hard constraint is
 * the one thing repulsion cannot argue with: a hub's crowd was drawn as a knot of dots 13 to
 * 25 units apart, and raising the charge from -70 to -320 barely moved them — it inflated the
 * rest of the figure instead, which is the same mistake as the -320 charge that was once doing
 * a collider's job. Halved, the springs give where two words are on top of each other and hold
 * everywhere else, which is what lets the charge do the job it is there for.
 */
const LINK_STRENGTH = 0.5;

/**
 * Repulsion, which is what holds one cluster off another.
 *
 * Scaled by degree rather than flat: a word with forty moves has forty satellites to find room
 * for, and a flat charge makes it claim exactly as much space as a word with one. Every word
 * pushing equally hard is a statement that every word is equally important, which is the
 * opposite of what a hub is — so hubs clear a space the size of their own crowd, and leaves
 * nestle inside it.
 *
 * The base is what opposes the springs' contraction, and it only does that with `LINK_STRENGTH`
 * off 1 — the two numbers are one decision and neither works alone.
 *
 * **The field has a range, and it is the range that makes the strength affordable.** An
 * inverse-square repulsion with no bound is still pushing at two hundred units, where nothing is
 * being crowded and nothing needs to move: raising the base without one tripled the largest
 * boards, flung every loosely joined word off toward the margins, and left the crowds it was
 * raised for barely better than before. Past `CHARGE_REACH` the field is simply off, so a strong
 * base is spent entirely on words that are actually in each other's way and a word joined by one
 * link sits where its link wants it. Measured over five boards, the closest pair on each went
 * from 14, 25, 20, 13 and 16 units to 29, 39, 50, 25 and 28, the number of pairs drawn inside
 * each other's room roughly halved, and the figures came out the size they were before.
 */
const CHARGE_BASE = -220;
const CHARGE_PER_MOVE = -14;
/**
 * How far the charge reaches, in graph units: about two moves at full link length.
 *
 * Far enough to hold one cluster off the next, near enough that the far side of the board is
 * not an influence on this side of it.
 */
const CHARGE_REACH = 160;

/**
 * How firmly a word already overlapping the answer is moved off it. See `forceSpineCorridor`.
 *
 * Well under 1, and scaled by alpha, so this nudges rather than places. A word is pushed out
 * over several ticks while the links and the charge are still deciding where it belongs, and it
 * comes to rest wherever *they* balance — not at the corridor's edge.
 */
const CORRIDOR_PUSH = 0.3;

/**
 * How hard the simulation is reheated when a word arrives, and how fast that run cools.
 *
 * `alpha * (1 - decay)^n < alphaMin` gives the length of a run: at 0.2 this is about 24
 * ticks, or four tenths of a second. Long enough to read as the new word settling in, short
 * enough that tapping a word is not aiming at a moving target — and every one of those
 * ticks is a full redraw of the plate, so it is a cost as well as a duration.
 */
const REHEAT = 0.4;
const REHEAT_DECAY = 0.2;

/**
 * How hot each layer of a growing board runs, and for how long.
 *
 * Enough for a layer to find its own places against the settled ones beneath it, not enough
 * to disturb them: the whole point of growing in layers is that what is already arranged
 * stays arranged. See `growInLayers`.
 */
const LAYER_ALPHA = 0.6;
const LAYER_TICKS = 40;
/**
 * How long each layer is given when the growth is watched rather than blocked.
 *
 * Four or five layers at this pace is a little over a second, which is about the length of
 * the title card the board grows underneath.
 */
const LAYER_MS = 260;

export interface BoardSpec {
  source: string;
  target: string;
  par: number;
  nodes: readonly string[];
  edges: readonly PlateEdge[];
  /** Moves from the source, which is what fixes a waypoint's height on the spine. */
  distFromSource: ReadonlyMap<string, number>;
  routeNodes: ReadonlySet<string>;
  /** Where each newly seen word was reached from, so it can sprout there. */
  parentOf: ReadonlyMap<string, string>;
  /** Words the player has named, which have first claim on the centre line. */
  named: ReadonlySet<string>;
  /**
   * Words currently showing their whole spelling, and so claiming a label's worth of room
   * rather than a mark's. Named words, the two the puzzle is about, anything hinted far
   * enough to be spelling itself out, and anything dev mode has read aloud.
   */
  labelled: ReadonlySet<string>;
}

export interface BoardLayout {
  /** Positions for every word ever placed, so returning words do not jump. */
  positions: ReadonlyMap<string, Point>;
  /** Source to target, in graph units: what the play view is framed on. */
  spineHeight: number;
  /** Bounds of what is drawn, for the opening view and for keeping a pan in reach. */
  figure: Box;
  /** The words to draw right now: those on a live route, plus what was found. */
  drawn: readonly string[];
  edges: readonly PlateEdge[];
}

export function useBoardLayout(spec: BoardSpec | null): BoardLayout | null {
  const simRef = useRef<Simulation<SimNode, undefined> | null>(null);
  const nodesRef = useRef(new Map<string, SimNode>());
  const linksRef = useRef(new Map<string, SimLink>());
  /**
   * What the forces read, and the link force itself.
   *
   * The forces are built once; these are how they see a board that has changed since. The
   * alternative — rebuilding a force so it can close over the new state — is what made the
   * layout inconsistent from one layer to the next.
   */
  const linkForceRef = useRef<ReturnType<typeof forceLink<SimNode, SimLink>> | null>(null);
  const degreeRef = useRef<ReadonlyMap<string, number>>(new Map());
  const corridorRef = useRef<Corridor>({
    onRoute: new Set(),
    labelled: new Set(),
    spineHalfWidth: widestOf([], new Set()),
    spineHeight: 0,
  });
  /** The timer walking a growing board through its layers, if one is running. */
  const growTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * While a board is assembling on screen, the words that have arrived so far; null once it
   * is whole, which is also what it is for every board that was not watched.
   *
   * Without this the growth is invisible: every word is rendered from the first frame and
   * only its *position* changes, so the board appears complete and then shuffles. Growing
   * the drawn set with the layers is what makes it read as a figure being built out of the
   * answer.
   */
  const admitted = useRef<Set<string> | null>(null);
  // The tick *value* must be read, not just the setter: the memo below depends on it, and
  // depending on the setter meant positions were computed once and never again.
  const [tick, setTick] = useState(0);

  // A new puzzle is a genuinely new board, so everything resets.
  const puzzleKey = spec ? `${spec.source}->${spec.target}` : null;
  const previousKey = useRef<string | null>(null);
  if (puzzleKey !== previousKey.current) {
    previousKey.current = puzzleKey;
    simRef.current?.stop();
    simRef.current = null;
    if (growTimer.current !== null) clearTimeout(growTimer.current);
    growTimer.current = null;
    admitted.current = null;
    nodesRef.current = new Map();
    linksRef.current = new Map();
  }

  const spineHeight = Math.max(spec?.par ?? 1, 1) * ROW_HEIGHT;

  useEffect(() => {
    if (!spec) return;

    const nodes = nodesRef.current;
    const links = linksRef.current;

    /**
     * Which words hold the centre line, one per step down the spine.
     *
     * Pinning every word on *some* shortest path there was a real glitch: the graph offers
     * several equally short answers, so two or three words share a depth and every one of
     * them was pinned to the same point, drawn exactly on top of each other.
     *
     * A depth with only one route word through it is a genuine waypoint and holds the
     * centre. Where there is a choice, the word the player actually named takes it, so the
     * route they walked straightens onto the spine as they walk it and the roads not taken
     * fall to either side. Where they have not chosen yet, nobody is pinned.
     */
    const centred = new Set<string>();
    const byDepth = new Map<number, string[]>();
    for (const word of spec.routeNodes) {
      const ds = spec.distFromSource.get(word);
      if (ds === undefined) continue;
      const at = byDepth.get(ds);
      if (at) at.push(word);
      else byDepth.set(ds, [word]);
    }
    for (const [, words] of byDepth) {
      if (words.length === 1) {
        centred.add(words[0]!);
        continue;
      }
      const walked = words.filter((word) => spec.named.has(word));
      if (walked.length === 1) centred.add(walked[0]!);
    }

    /** Rule 1: the answer is the spine, and the spine does not move. */
    const pinSpine = (node: SimNode) => {
      const ds = spec.distFromSource.get(node.id);
      const depth = ds === undefined ? undefined : (ds / Math.max(spec.par, 1)) * spineHeight;
      if (node.id === spec.source) {
        node.fx = 0;
        node.fy = 0;
      } else if (node.id === spec.target) {
        node.fx = 0;
        node.fy = spineHeight;
      } else if (centred.has(node.id) && depth !== undefined) {
        node.fx = 0;
        node.fy = depth;
      } else if (spec.routeNodes.has(node.id) && depth !== undefined) {
        // On a shortest route, but sharing its depth with another answer. Its height is
        // still the truth; which side of the centre line it takes is the layout's business.
        node.fx = undefined;
        node.fy = depth;
      } else {
        node.fx = undefined;
        node.fy = undefined;
      }
    };

    /**
     * Rule 3: a word starts where it was reached from.
     *
     * Which matters more than it sounds, because a force layout settles into whichever
     * arrangement is nearest to where it started. Every word used to begin on the centre
     * line, eighteen units to the left or right by whether its position in the alphabet was
     * odd or even, and no amount of annealing undoes a start like that — the figure that
     * came out was the one that explosion happened to leave behind.
     *
     * So: the word the player just moved to starts on the word they moved from. Anything
     * else arriving with it starts on a neighbour that already has a place. And on a first
     * draw, where nothing has a place yet, the spine does — so the board grows outward from
     * the answer, each word set off from its parent by roughly one move's length, with
     * siblings spread around it so they do not begin life on top of each other.
     */
    const placeNewcomers = () => {
      const near = new Map<string, string[]>();
      for (const { a, b } of spec.edges) {
        (near.get(a) ?? near.set(a, []).get(a)!).push(b);
        (near.get(b) ?? near.set(b, []).get(b)!).push(a);
      }

      const arrived = spec.nodes.filter((id) => !nodes.has(id));
      const layers: string[][] = [];
      if (arrived.length === 0) return { arrived, layers, near };

      const waiting = new Set(arrived);
      const at = new Map<string, Point>();
      for (const [id, node] of nodes) at.set(id, { x: node.x ?? 0, y: node.y ?? 0 });

      // The move the player just made comes first: that word sprouts from the word they
      // moved from, whatever else it is joined to.
      for (const id of arrived) {
        const from = spec.parentOf.get(id);
        const anchor = from ? at.get(from) : undefined;
        if (!anchor) continue;
        at.set(id, { x: anchor.x, y: anchor.y + LINK_DISTANCE * 0.5 });
        waiting.delete(id);
      }

      // A first draw has nothing placed at all. The spine is where a board grows from.
      if (at.size === 0) {
        at.set(spec.source, { x: 0, y: 0 });
        waiting.delete(spec.source);
        for (const word of centred) {
          const ds = spec.distFromSource.get(word) ?? 0;
          at.set(word, { x: 0, y: (ds / Math.max(spec.par, 1)) * spineHeight });
          waiting.delete(word);
        }
        at.set(spec.target, { x: 0, y: spineHeight });
        waiting.delete(spec.target);
      }

      // Outward from there, breadth first, each word set off from whoever reached it.
      let frontier = [...at.keys()];
      while (frontier.length > 0 && waiting.size > 0) {
        const next: string[] = [];
        for (const parent of frontier) {
          const kids = (near.get(parent) ?? []).filter((k) => waiting.has(k)).sort();
          const from = at.get(parent)!;
          kids.forEach((kid, i) => {
            // Spread around the parent rather than stacked on it, so the first tick has
            // something to work with, and siblings do not begin life at one point.
            const angle = ((i + 0.5) / kids.length) * Math.PI * 2;
            at.set(kid, {
              x: from.x + Math.cos(angle) * LINK_DISTANCE,
              y: from.y + Math.sin(angle) * LINK_DISTANCE,
            });
            waiting.delete(kid);
            next.push(kid);
          });
        }
        if (next.length > 0) layers.push(next);
        frontier = next;
      }

      for (const id of arrived) {
        const start = at.get(id) ?? { x: 0, y: spineHeight / 2 };
        const node: SimNode = { id, x: start.x, y: start.y };
        pinSpine(node);
        nodes.set(id, node);
      }
      return { arrived, layers, near };
    };

    for (const id of spec.nodes) {
      const existing = nodes.get(id);
      // Already placed. Only its pinning can change, when a word turns out to sit on the
      // best route after all.
      if (existing) pinSpine(existing);
    }
    const { arrived, layers, near } = placeNewcomers();

    let newLinks = 0;
    for (const edge of spec.edges) {
      const key = `${edge.a}|${edge.b}`;
      if (links.has(key)) continue;
      if (!nodes.has(edge.a) || !nodes.has(edge.b)) continue;
      links.set(key, { source: edge.a, target: edge.b });
      newLinks += 1;
    }

    const nodeList = [...nodes.values()];
    const linkList = [...links.values()];

    /**
     * How many drawn moves each word has, which is what makes a hub a hub.
     *
     * Over `spec.edges` rather than the graph: a word with fifty moves in the dictionary and
     * three on the board is a three-move word as far as the figure is concerned.
     */
    const degree = new Map<string, number>();
    for (const { a, b } of spec.edges) {
      degree.set(a, (degree.get(a) ?? 0) + 1);
      degree.set(b, (degree.get(b) ?? 0) + 1);
    }

    /**
     * A move's length: full for a quiet pair, contracting toward `LINK_MIN_DISTANCE` as the
     * busier end gets busier.
     *
     * The busier end and not the mean, because it is the hub that has to hold its satellites
     * close; a hub's link being long is what stood its whole neighbourhood off in a ring at
     * one radius, which is the same lattice from a different direction.
     */
    const endOfLink = (end: string | SimNode) => (typeof end === 'string' ? end : end.id);
    const linkDistance = (link: SimLink) =>
      lengthOf(
        Math.max(
          degree.get(endOfLink(link.source)) ?? 1,
          degree.get(endOfLink(link.target)) ?? 1,
        ),
      );

    /** A word clears room in proportion to the crowd it has to hold. */
    const charge = (node: SimNode) =>
      CHARGE_BASE + CHARGE_PER_MOVE * (degreeRef.current.get(node.id) ?? 0);

    /**
     * How wide the answer's own words are, which is how wide a berth they need.
     *
     * Measured rather than assumed: the two words the puzzle is about always show their names,
     * so a par-4 board whose target is `landsliding` needs a corridor twice the width of one
     * whose words are all four letters. Taking a constant here would either crowd the long
     * boards or waste the short ones.
     */
    const spineHalfWidth = widestOf(spec.routeNodes, spec.labelled);

    // What the forces read. Kept in a ref rather than closed over, because the forces are
    // built once and this changes on every guess.
    degreeRef.current = degree;
    corridorRef.current = {
      onRoute: spec.routeNodes,
      labelled: spec.labelled,
      spineHalfWidth,
      spineHeight,
    };

    /**
     * The forces are built **once**, and only the node and link *sets* change after that.
     *
     * Rebuilding them per render looks harmless and is not. `forceLink` recomputes its degree
     * bias inside its own `initialize`, so handing it a fresh instance mid-growth recalculated
     * every bond from whichever subset of links it happened to be given — the board was laid
     * out by a different force each layer. A force is a rule about the graph; the graph gains
     * words, the rule does not change.
     */
    let simulation = simRef.current;
    const created = simulation === null;
    if (!simulation) {
      const link = forceLink<SimNode, SimLink>(linkList)
        .id((n) => n.id)
        .distance(linkDistance)
        .strength(LINK_STRENGTH);
      linkForceRef.current = link;
      simulation = forceSimulation<SimNode>(nodeList)
        .alphaDecay(REHEAT_DECAY)
        .force('charge', forceManyBody<SimNode>().strength(charge).distanceMax(CHARGE_REACH))
        .force('corridor', forceSpineCorridor(CORRIDOR_PUSH, () => corridorRef.current))
        .force('link', link)
        .on('tick', () => setTick((n) => n + 1))
        // Nothing is drawn until it has been settled below, so the internal timer must not
        // start on its own and animate the way there.
        .stop();
      simRef.current = simulation;
    } else {
      simulation.nodes(nodeList);
      linkForceRef.current?.links(linkList);
    }

    const run = (alpha: number, ticks: number) => toRest(simulation, alpha, ticks);

    const settle = () => {
      run(1, SETTLE_LIMIT);
      // The layout moved without saying so, so ask for the one render that shows it.
      setTick((n) => n + 1);
    };

    /**
     * Grow the board a layer at a time rather than dropping all of it in at once.
     *
     * Placing every word and then annealing is the usual way and it is the wrong way here:
     * a force layout settles into whichever arrangement is nearest where it began, so the
     * whole outer graph is committed to a shape decided by nothing but its seed. A word
     * three moves out was seeded from a parent that had not itself found a place yet, and
     * once it was on the wrong side of the figure, the links were far too weak to walk it
     * back around everything in between.
     *
     * So each layer is placed on the *settled* positions of the one before, at the mean of
     * whichever of its neighbours already have places — which is where the links want it
     * anyway — and given a few dozen ticks to find its own before the next layer arrives.
     * Every word therefore starts near its final answer, and the closing settle is a
     * refinement rather than an untangling.
     */
    const growInLayers = (animate: boolean) => {
      // Which words the board is *showing* so far. Every word is in the simulation from the
      // first tick — the forces cover the whole board — so a layer is a seeding step and a
      // reveal, never a change to what is being simulated.
      const has = new Set<string>();
      for (const node of nodeList) {
        if (!layers.some((layer) => layer.includes(node.id))) has.add(node.id);
      }

      /** Bring one layer in: place each word on the mean of whatever it is already joined to. */
      const admit = (layer: readonly string[]) => {
        for (const id of layer) {
          const node = nodes.get(id);
          if (!node) continue;
          // On the mean of the neighbours that already have a place. A word with none —
          // which happens only where the drawn set is not connected — keeps its seed.
          const anchors = (near.get(id) ?? []).filter((n) => has.has(n)).map((n) => nodes.get(n)!);
          if (anchors.length > 0) {
            node.x = anchors.reduce((sum, n) => sum + (n.x ?? 0), 0) / anchors.length;
            node.y = anchors.reduce((sum, n) => sum + (n.y ?? 0), 0) / anchors.length;
            // Off the mean by a hair, deterministically, or a word joined to exactly one
            // placed neighbour lands on top of it and has no direction to leave in.
            const away = (id.charCodeAt(0) + id.length) % 8;
            node.x += Math.cos((away / 8) * Math.PI * 2) * LINK_DISTANCE * 0.5;
            node.y += Math.sin((away / 8) * Math.PI * 2) * LINK_DISTANCE * 0.5;
          }
          pinSpine(node);
          has.add(id);
        }
        if (admitted.current) {
          admitted.current = new Set(has);
          setTick((n) => n + 1);
        }
      };

      /** Every word shown, nothing left behind. */
      const whole = () => {
        for (const node of nodeList) has.add(node.id);
      };

      if (!animate) {
        // Off-screen, all at once: the same growth with the frames thrown away.
        run(LAYER_ALPHA, LAYER_TICKS);
        for (const layer of layers) {
          admit(layer);
          run(LAYER_ALPHA, LAYER_TICKS);
        }
        whole();
        settle();
        return;
      }

      /**
       * The same growth, watched.
       *
       * A board took a fifth of a second of blocked main thread to arrange before anything
       * could be drawn, and blocked main thread reads as a slow page rather than as care.
       * Since the arrangement happens in layers anyway, letting it happen *on screen* costs
       * nothing and shows the figure assembling out of the answer while the title card is
       * still up — which is about the same length, and is the one moment the shape of the
       * whole thing is worth watching.
       */
      admitted.current = new Set(has);
      simulation.alpha(LAYER_ALPHA).restart();
      setTick((n) => n + 1);
      let next = 0;
      const step = () => {
        if (next < layers.length) {
          admit(layers[next]!);
          next += 1;
          simulation.alpha(LAYER_ALPHA).restart();
          growTimer.current = setTimeout(step, LAYER_MS);
          return;
        }
        whole();
        admitted.current = null;
        simulation.alpha(LAYER_ALPHA).restart();
        setTick((n) => n + 1);
        growTimer.current = null;
      };
      growTimer.current = setTimeout(step, LAYER_MS);
    };

    if (created) {
      // The board assembles itself out of the answer, on screen, under the title card —
      // unless stillness was asked for, in which case it is arranged before it is shown.
      const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      growInLayers(!still);
    } else if (arrived.length > 0 || newLinks > 0) {
      // A word arriving is the one thing worth animating: it is the player's move landing,
      // and it should ease in from where they made it.
      simulation.alpha(REHEAT).restart();
    }
    // An ordinary re-render must leave a settled board exactly as it is.
  }, [spec, spineHeight]);

  useEffect(
    () => () => {
      simRef.current?.stop();
      if (growTimer.current !== null) clearTimeout(growTimer.current);
    },
    [],
  );

  return useMemo(() => {
    if (!spec) return null;
    const positions = new Map<string, Point>();
    for (const [id, node] of nodesRef.current) {
      positions.set(id, { x: node.x ?? 0, y: node.y ?? 0 });
    }

    // Bounds of what is drawn, from the drawn words only: positions are remembered for
    // every word ever placed, and letting a word the board has moved on from stretch the
    // bounds would leave the opening view framed on nothing.
    const figure: Box = { minX: 0, maxX: 0, minY: 0, maxY: spineHeight };
    for (const word of spec.nodes) {
      const at = positions.get(word);
      if (!at) continue;
      figure.minX = Math.min(figure.minX, at.x);
      figure.maxX = Math.max(figure.maxX, at.x);
      figure.minY = Math.min(figure.minY, at.y);
      figure.maxY = Math.max(figure.maxY, at.y);
    }

    // While the board is assembling, only what has arrived is drawn — and only the moves
    // between two words that have both arrived.
    const arrivedSoFar = admitted.current;
    const drawn = arrivedSoFar ? spec.nodes.filter((w) => arrivedSoFar.has(w)) : spec.nodes;
    const edges = arrivedSoFar
      ? spec.edges.filter((e) => arrivedSoFar.has(e.a) && arrivedSoFar.has(e.b))
      : spec.edges;

    return { positions, spineHeight, figure, drawn, edges };
    // Recomputed on every tick, which is the point.
  }, [spec, spineHeight, tick]);
}
