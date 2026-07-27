/**
 * A live, growing layout for the board.
 *
 * The board must never be rebuilt from scratch. Recomputing a settled layout on
 * every guess threw away the whole figure and replaced it with a different one —
 * so naming an unexpected word looked like the game had lost your place, when in
 * fact you had just discovered something.
 *
 * So the simulation persists and the node set only ever grows. Every word that
 * has appeared stays, at the position it already occupied; new words are seeded
 * next to whatever they were reached from, the simulation is gently reheated, and
 * it settles the new arrival into place over a few hundred milliseconds. That is
 * what d3-force is for, and it is why the layout is animated rather than static.
 *
 * Motion is spent only on that. A board is *settled before it is first shown* —
 * stepped to rest with the tick event suppressed, so not one frame of it reaches
 * the screen — because a first draw has no information in its movement: every
 * node begins somewhere arbitrary, and animating from there opened the game by
 * flinging thirty words out of a single point and hauling them back. The rule is
 * that the figure only ever moves in response to the player. A new word eases in;
 * a resized frame is re-settled at once rather than wobbling into shape.
 *
 * The frame is fixed, not fitted. The figure is confined to a box the shape of
 * the plate on screen, and that box *is* the viewBox — so the scale from graph
 * units to pixels is known in advance and never changes. Fitting the view to the
 * figure instead was the bug that made the board a distant speck: the extent was
 * grown to whatever the widest node had ever reached, one node flung out during
 * the first few ticks set it to five times the figure's real width, and it could
 * never shrink back. A fixed frame cannot do that, and it also means a node can
 * never drift off screen — it is held inside the frame by the same box.
 *
 * The spine stays fixed throughout: source at the top, target at the bottom, best
 * route down the centre line.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationNodeDatum,
} from 'd3-force';
import type { PlateEdge } from './plate';
import type { Point } from './types';

/** Vertical distance between consecutive moves along the spine. */
const ROW_HEIGHT = 130;
const COLLIDE_R = 27;
/** Graph units of margin between the figure and the edge of the frame. */
const PADDING = 42;
/** How hard the simulation is reheated when something new arrives. */
const REHEAT = 0.55;
/**
 * Nothing but the source may come this close to the top of the frame, so the
 * source always has clear air in front of it.
 */
const TOP_MARGIN = COLLIDE_R * 1.5;
/** Ticks a settle may take before it gives up and draws what it has. */
const SETTLE_LIMIT = 500;
/**
 * How fast an off-screen settle cools, against 0.035 for an animated one.
 *
 * Nobody watches this one, so there is no reason to anneal at a pace chosen to
 * look good: the same figure is reached in a third of the steps. The pace matters
 * because the settle is synchronous. At the animated rate a full board took the
 * best part of 200ms of blocked main thread, and blocked main thread on a phone is
 * a stall before the game appears; at this rate a thirty-word board settles in
 * around 15ms, which is lost in the noise of parsing the word list.
 */
const SETTLE_DECAY = 0.1;
/**
 * How hard a re-settle runs when only the frame changed shape. Lower than a
 * first draw: the figure should adapt to its new box, not be rebuilt in it.
 */
const RESHAPE_ALPHA = 0.35;
/** Fallback plate shape, for the first render and for tests without a DOM box. */
const DEFAULT_ASPECT = 0.75;

interface SimNode extends SimulationNodeDatum {
  id: string;
  fx?: number | undefined;
  fy?: number | undefined;
}

interface SimLink {
  source: string | SimNode;
  target: string | SimNode;
}

export interface BoardSpec {
  source: string;
  target: string;
  par: number;
  nodes: readonly string[];
  edges: readonly PlateEdge[];
  distToTarget: ReadonlyMap<string, number>;
  distFromSource: ReadonlyMap<string, number>;
  routeNodes: ReadonlySet<string>;
  /** Where each newly seen word was reached from, so it can start there. */
  parentOf: ReadonlyMap<string, string>;
  /** Words the player has named, which have first claim on the centre line. */
  named: ReadonlySet<string>;
  /** Plate shape in pixels; the frame takes the same proportions. */
  aspect?: number | undefined;
}

export interface BoardLayout {
  /** Positions for every word ever placed, so returning words do not jump. */
  positions: ReadonlyMap<string, Point>;
  extent: { x: number; y: number; width: number; height: number };
  /** The words to draw right now: those on a live route, plus what was found. */
  drawn: readonly string[];
  edges: readonly PlateEdge[];
}

/**
 * The frame, in graph units.
 *
 * Height is set by the spine — one row per move — and width follows from the
 * shape of the plate on screen, so a wide desktop plate gets a wide figure and a
 * phone gets a tall one, both filling what they are given.
 */
function frameOf(par: number, aspect: number) {
  const spineHeight = Math.max(par, 1) * ROW_HEIGHT;
  const height = spineHeight + PADDING * 2;
  // Wide enough to hold detours beside the spine on a narrow phone, and never so
  // wide that the figure rattles around inside it. A plate is a portrait figure;
  // on a desktop it is centred with margins, the way a plate sits on a page,
  // rather than stretched across the window.
  const halfWidth = Math.min(
    Math.max((aspect * height) / 2 - PADDING, COLLIDE_R * 3),
    spineHeight * 0.55,
  );
  return { spineHeight, halfWidth, height };
}

export function useBoardLayout(spec: BoardSpec | null): BoardLayout | null {
  const simRef = useRef<Simulation<SimNode, undefined> | null>(null);
  const nodesRef = useRef(new Map<string, SimNode>());
  const linksRef = useRef(new Map<string, SimLink>());
  const frameRef = useRef<string | null>(null);
  // The tick *value* must be read, not just the setter: the memo below depends
  // on it, and depending on the setter (which is stable) meant positions were
  // computed once and never again — the simulation ran but nothing redrew.
  const [tick, setTick] = useState(0);

  // A new puzzle is a genuinely new board, so everything resets.
  const puzzleKey = spec ? `${spec.source}->${spec.target}` : null;
  const previousKey = useRef<string | null>(null);
  if (puzzleKey !== previousKey.current) {
    previousKey.current = puzzleKey;
    simRef.current?.stop();
    simRef.current = null;
    nodesRef.current = new Map();
    linksRef.current = new Map();
  }

  const aspect = spec?.aspect && spec.aspect > 0 ? spec.aspect : DEFAULT_ASPECT;
  const frame = frameOf(spec?.par ?? 1, aspect);
  const { spineHeight, halfWidth } = frame;

  // Only the *identity* of the drawn set matters for re-syncing.
  const nodeKey = spec ? spec.nodes.join(' ') : '';
  const edgeKey = spec ? spec.edges.map((e) => `${e.a}|${e.b}`).join(' ') : '';

  useEffect(() => {
    if (!spec) return;

    const nodes = nodesRef.current;
    const links = linksRef.current;

    /**
     * Where a node belongs vertically: how far along it is, source to target.
     *
     * `ds / (ds + dt)`, not distance-to-target alone. On a best route the two are
     * the same number — `ds + dt` is par there, so the spine is unaffected — but
     * off it they are not, and measuring from the target alone gave every node
     * further from the target than par a negative height, which clamped to zero.
     * That is not a rare case: it was between a quarter and two thirds of every
     * board, all of it stacked on the source's own row in a heap the source was
     * buried in. Progress cannot go negative, so nothing can pile up there, and a
     * detour off the first move now sits just in front of the source where it
     * belongs.
     */
    const preferredY = (id: string) => {
      const ds = spec.distFromSource.get(id);
      const dt = spec.distToTarget.get(id);
      if (ds === undefined || dt === undefined) return spineHeight / 2;
      const total = ds + dt;
      return total === 0 ? 0 : (ds / total) * spineHeight;
    };

    /**
     * Which words hold the centre line, one per step down the spine.
     *
     * Pinning every node on *some* shortest path there was a real glitch: the
     * legal graph offers several equally short answers, so two or three words
     * share a depth and every one of them was pinned to the same point — drawn
     * exactly on top of each other.
     *
     * A depth with only one route word through it is a genuine waypoint and holds
     * the centre. Where there is a choice, the word the player actually named
     * takes it, so the route they walked straightens onto the spine as they walk
     * it and the roads not taken fall to either side. Where they have not chosen
     * yet, nobody is pinned and the alternatives share the width.
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

    /**
     * Roughly where each arriving word should appear, from the words it joins.
     *
     * Naming one word can pull in a whole region of routes at once, and only the
     * named word itself has a parent to grow out of. The rest had nowhere to start
     * from and were all seeded at the origin, so they burst outward from a single
     * point and then found their places — the same explosion the first draw used
     * to have, just later. Starting each of them among the words it is actually
     * joined to means the settle that follows is a nudge rather than a scramble.
     */
    const seeds = new Map<string, { x: number; y: number; n: number }>();
    for (const { a, b } of spec.edges) {
      const from = nodes.get(a);
      const to = nodes.get(b);
      if (from && !to) {
        const seed = seeds.get(b) ?? { x: 0, y: 0, n: 0 };
        seeds.set(b, { x: seed.x + (from.x ?? 0), y: seed.y + (from.y ?? 0), n: seed.n + 1 });
      } else if (to && !from) {
        const seed = seeds.get(a) ?? { x: 0, y: 0, n: 0 };
        seeds.set(a, { x: seed.x + (to.x ?? 0), y: seed.y + (to.y ?? 0), n: seed.n + 1 });
      }
    }

    let added = 0;
    spec.nodes.forEach((id, i) => {
      const existing = nodes.get(id);
      if (existing) {
        // Already placed. Only its pinning can change, when a word turns out to
        // sit on the best route after all.
        applyPins(existing, id, spec, spineHeight, centred);
        return;
      }
      added += 1;

      // Start next to whatever it was reached from, so it appears to grow out of
      // the move the player just made rather than materialising across the board;
      // failing that, among its neighbours; failing that, at its own height.
      const parent = spec.parentOf.get(id);
      const anchor = parent ? nodes.get(parent) : undefined;
      const seed = seeds.get(id);
      const side = i % 2 === 0 ? 1 : -1;
      const from =
        anchor ??
        (seed && seed.n > 0 ? { x: seed.x / seed.n, y: seed.y / seed.n } : undefined);
      const node: SimNode = {
        id,
        x: (from?.x ?? 0) + side * (18 + (i % 4) * 7),
        y: from?.y ?? preferredY(id),
      };
      applyPins(node, id, spec, spineHeight, centred);
      nodes.set(id, node);
    });

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
     * Hold everything inside the frame.
     *
     * Run after the tick rather than as a force, because a force only nudges
     * velocity and a node pressed against the wall would keep drifting through
     * it. Killing the velocity component too, so nodes settle along the edge
     * instead of vibrating against it.
     */
    const confine = () => {
      const limitX = halfWidth - COLLIDE_R * 0.5;
      for (const node of nodeList) {
        if (node.x === undefined || node.y === undefined) continue;
        if (node.x < -limitX) {
          node.x = -limitX;
          node.vx = 0;
        } else if (node.x > limitX) {
          node.x = limitX;
          node.vx = 0;
        }
        // The source keeps the top of the frame to itself. Everything else is
        // held below it, so a fan of first moves spreads out in front of the
        // source rather than crowding onto it — the top edge was where nodes
        // with nowhere better to be used to collect.
        const ceiling = node.id === spec.source ? 0 : TOP_MARGIN;
        if (node.y < ceiling) {
          node.y = ceiling;
          node.vy = 0;
        } else if (node.y > spineHeight) {
          node.y = spineHeight;
          node.vy = 0;
        }
      }
    };

    let simulation = simRef.current;
    const created = simulation === null;
    if (!simulation) {
      simulation = forceSimulation<SimNode>(nodeList)
        .force('charge', forceManyBody<SimNode>().strength(-320).distanceMax(520))
        .force('collide', forceCollide<SimNode>(COLLIDE_R).strength(0.9))
        .force('x', forceX<SimNode>(0).strength(0.03))
        // Weak on purpose: enough to orient the figure top-to-bottom, too weak to
        // flatten it into rows.
        .force('y', forceY<SimNode>((n) => preferredY(n.id)).strength(0.07))
        .alphaDecay(0.035)
        .on('tick', () => {
          confine();
          setTick((n) => n + 1);
        })
        // Nothing is drawn until it has been settled below, so the internal timer
        // must not start on its own and animate the way there.
        .stop();
      simRef.current = simulation;
    } else {
      simulation.nodes(nodeList);
      simulation.force('y', forceY<SimNode>((n) => preferredY(n.id)).strength(0.07));
      simulation.on('tick', () => {
        confine();
        setTick((n) => n + 1);
      });
    }

    simulation.force(
      'link',
      forceLink<SimNode, SimLink>(linkList)
        .id((n) => n.id)
        .distance(74)
        .strength(0.55),
    );

    /**
     * Run the layout to rest without drawing a frame of it.
     *
     * `simulation.tick()` steps the layout without dispatching the tick event, so
     * nothing re-renders while this runs. Confinement has to be applied by hand
     * each step, because that normally rides on the event this deliberately skips.
     *
     * Synchronous, and therefore paid for in blocked main thread — see
     * SETTLE_DECAY, which is what keeps the bill small.
     */
    const settle = (from: number) => {
      const animated = simulation.alphaDecay();
      simulation.stop().alpha(from).alphaDecay(SETTLE_DECAY);
      let steps = 0;
      while (simulation.alpha() > simulation.alphaMin() && steps < SETTLE_LIMIT) {
        simulation.tick();
        confine();
        steps += 1;
      }
      simulation.alphaDecay(animated);
      confine();
      // The layout moved without saying so, so ask for the one render that shows it.
      setTick((n) => n + 1);
    };

    const shape = `${halfWidth}x${spineHeight}`;
    const reshaped = frameRef.current !== shape;
    frameRef.current = shape;

    if (created) {
      // The first sight of a board is of a board, not of one assembling itself.
      // Every node starts somewhere arbitrary, and letting the simulation animate
      // its way from there meant the game opened by flinging thirty words out of a
      // single point and reeling them back in. Settled off-screen, the opening
      // frame is the finished figure and the only motion left is the game's own.
      settle(1);
    } else if (added > 0 || newLinks > 0) {
      // Words arriving is the one thing worth animating: it is the player's move
      // landing, and it should ease in from where they made it.
      confine();
      simulation.alpha(REHEAT).restart();
    } else if (reshaped) {
      // A rotated phone, an opening keyboard, a dragged window edge. None of them
      // is a move, so the figure adapts to its new box at once instead of wobbling
      // into it — which is also what stopped the board lurching once on load, when
      // the measured plate size arrived a beat after the first layout.
      settle(RESHAPE_ALPHA);
    }
    // An ordinary re-render must leave a settled board exactly as it is.
  }, [spec, nodeKey, edgeKey, spineHeight, halfWidth]);

  useEffect(
    () => () => {
      simRef.current?.stop();
    },
    [],
  );

  return useMemo(() => {
    if (!spec) return null;
    const positions = new Map<string, Point>();
    for (const [id, node] of nodesRef.current) {
      positions.set(id, { x: node.x ?? 0, y: node.y ?? 0 });
    }

    return {
      positions,
      // The frame, exactly. Nothing is fitted to the figure, so the board never
      // twitches, zooms or drifts as words settle.
      extent: {
        x: -halfWidth - PADDING,
        y: -PADDING,
        width: (halfWidth + PADDING) * 2,
        height: spineHeight + PADDING * 2,
      },
      // Positions are remembered for every word ever placed, but only the words
      // currently on a valid route are *drawn*. Rendering the whole history
      // instead left stubs behind: a node that was on a route earlier, kept
      // forever, dangling once the board moved on. Remembering the position is
      // what stops a returning word from jumping; drawing it is not.
      drawn: spec.nodes,
      edges: spec.edges,
    };
    // Recomputed on every tick, which is the point.
  }, [spec, spineHeight, halfWidth, tick]);
}

/** Pin the spine: source top, target bottom, sole waypoints down the centre. */
function applyPins(
  node: SimNode,
  id: string,
  spec: BoardSpec,
  spineHeight: number,
  centred: ReadonlySet<string>,
) {
  const ds = spec.distFromSource.get(id);
  if (id === spec.source) {
    node.fx = 0;
    node.fy = 0;
  } else if (id === spec.target) {
    node.fx = 0;
    node.fy = spineHeight;
  } else if (centred.has(id) && ds !== undefined) {
    node.fx = 0;
    node.fy = (ds / Math.max(spec.par, 1)) * spineHeight;
  } else if (spec.routeNodes.has(id) && ds !== undefined) {
    // On a shortest route, but sharing its depth with another answer. Its height
    // is still the truth; its side of the centre line is for the layout to find.
    node.fx = undefined;
    node.fy = (ds / Math.max(spec.par, 1)) * spineHeight;
  } else {
    node.fx = undefined;
    node.fy = undefined;
  }
}
