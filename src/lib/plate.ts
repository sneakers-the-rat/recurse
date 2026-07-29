/**
 * Choosing what to draw.
 *
 * The whole language graph is far too big to show — 151k words carry a move, and
 * almost any word lies on *some* meandering route between two others. So the
 * board is a filtered neighbourhood, assembled in three steps.
 *
 * 1. Routes, not balls. Keep nodes where
 *    `d(anchor, v) + d(v, target) <= d(anchor, target) + slack`, then prune dead
 *    ends until only nodes lying on an actual route remain. Pruning is what makes
 *    a generous slack affordable: at slack 6 the raw neighbourhood is ~192 nodes
 *    but only ~41 of them are on a route, the other ~150 being one-move spurs.
 *    Spending the budget on routes 6 moves off optimal beats spending it on a
 *    thicket of dead ends 1 move off.
 *
 * 2. Spurs become a mark, not a node. A word's remaining moves still matter —
 *    they tell you it is a hub — so each drawn word carries a count of moves
 *    leading off the board. Rendered as a few small ticks, that reads as
 *    "this one has lots of options" in a fraction of the space.
 *
 * 3. The board grows. Every word the player names becomes an anchor in step 1,
 *    so naming something outside the drawn region pulls in the routes from
 *    *there* to the target. Guessing off the map extends the map.
 */

import { bfs } from './graph';
import type { Graph, Revealed } from './types';

export interface PlateEdge {
  a: string;
  b: string;
}

export interface Plate {
  /** Words to draw, sorted for stable ordering. */
  nodes: string[];
  edges: PlateEdge[];
  /** Nodes on some shortest source→target route. */
  routeNodes: Set<string>;
  /** Moves from each drawn node to the target. */
  distToTarget: Map<string, number>;
  /** Moves from the source, for spacing the spine. */
  distFromSource: Map<string, number>;
  /** Legal moves from each drawn node that lead off the board. */
  spurCount: Map<string, number>;
  /** The slack actually used, after backing off to stay drawable. */
  slack: number;
  /**
   * Fewest moves the *legal* graph allows between the two words.
   *
   * Usually the puzzle's par, but smaller when a rare word cuts a corner — the
   * secret. The board is laid out against this rather than against par, so the
   * spine matches the routes actually drawn on it.
   */
  best: number;
}

export interface PlateOptions {
  /**
   * The words the puzzle declares it draws. Empty means the answer and whatever the player
   * has found, which is what a puzzle built before boards existed comes to.
   */
  board?: readonly string[];
  /**
   * Which found words to expand routes from. A word the player just named is
   * always drawn, but working out where it leads is deferred by a beat so the
   * reveal itself stays instant — see App.
   */
  anchors?: ReadonlySet<string>;
}

/**
 * Distances from a word, memoised per graph.
 *
 * The board is rebuilt after every guess, and each rebuild needs distances from
 * the source, the target and each word found so far. Recomputing them meant two
 * or more full sweeps of a 151k-node graph per keystroke-turned-guess. The graph
 * is immutable once loaded, so these never go stale; the cache is keyed weakly so
 * swapping graphs cannot leak.
 */
const distanceCache = new WeakMap<Graph, Map<string, Map<string, number>>>();

function distancesFrom(graph: Graph, word: string): Map<string, number> {
  let perGraph = distanceCache.get(graph);
  if (!perGraph) {
    perGraph = new Map();
    distanceCache.set(graph, perGraph);
  }
  let distances = perGraph.get(word);
  if (!distances) {
    // Measured over ordinary words, because that is the graph being drawn. Using
    // legal distances put a shorter "best route" on the board than the par the
    // puzzle advertises, through words the player has never met.
    distances = bfs(graph, word, Infinity, graph.commonNeighbors);
    perGraph.set(word, distances);
  }
  return distances;
}

/**
 * Drop dead ends, leaving exactly the nodes on some route between the anchors
 * and the target.
 *
 * Repeatedly removing degree-1 nodes cannot remove a node genuinely on a route —
 * such a node has an edge toward each end, so degree >= 2 — and it removes spurs
 * of any length, not just single leaves.
 */
function pruneDeadEnds(graph: Graph, nodes: Set<string>, keep: ReadonlySet<string>): Set<string> {
  const live = new Set(nodes);

  // Repeated sweeps, stopping the neighbour count at two.
  //
  // A worklist that tracks exact degrees is asymptotically better but measurably
  // slower here: two-letter subwords give some words enormous degree, and exact
  // counting has to walk all of it, where "has it got two neighbours yet?" stops
  // almost immediately.
  let changed = true;
  while (changed) {
    changed = false;
    for (const word of live) {
      if (keep.has(word)) continue;
      let degree = 0;
      for (const neighbor of graph.commonNeighbors(word)) {
        if (live.has(neighbor)) {
          degree += 1;
          if (degree > 1) break;
        }
      }
      if (degree <= 1) {
        live.delete(word);
        changed = true;
      }
    }
  }

  return live;
}

/**
 * A second way out of the source, with a route onward so it is not a stub.
 *
 * Puzzle selection guarantees the first move is a choice, but a guarantee about the
 * neighbourhood is not a guarantee about the drawing: the budget trims the
 * widest detours first, and the second branch is exactly the widest detour there
 * is. So the board keeps one deliberately. Returned as a whole path down to the
 * target, because protecting the branch alone would leave it dangling the moment
 * the rest of its route was trimmed.
 */
function secondWayOut(
  graph: Graph,
  source: string,
  distToTarget: ReadonlyMap<string, number>,
): string[] {
  const options = graph
    .commonNeighbors(source)
    .filter((word) => distToTarget.has(word))
    .sort((a, b) => distToTarget.get(a)! - distToTarget.get(b)! || a.localeCompare(b));

  // The first is the shortest route, which is drawn anyway. Every one after it is a
  // candidate for the branch, and the first that leads *somewhere* wins — asking only
  // about `options[1]` meant that when its route doubled back, the board got a spur
  // instead of a second way and nothing else was tried.
  for (const branch of options.slice(1)) {
    const path = descend(
      branch,
      (word) => graph.commonNeighbors(word),
      distToTarget,
      new Set([source]),
    );
    if (path) return path;
  }
  return [];
}

/**
 * A walk from `word` to whatever `distance` measures zero at, never revisiting.
 *
 * Each step goes to a neighbour one move closer, which is what makes the result a
 * shortest route — but "one move closer" is not enough on its own, because the *source*
 * is one move closer to the target than a word hanging off it. Walking blind produced
 * `form → conform → form → …`: a path on paper, a dead-end spur on the board, and the
 * word protected from pruning for the privilege. `avoid` is what the walk may not
 * revisit; it adds itself as it goes.
 */
function descend(
  word: string,
  near: (from: string) => readonly string[],
  distance: ReadonlyMap<string, number>,
  avoid: ReadonlySet<string>,
): string[] | null {
  const remaining = distance.get(word);
  if (remaining === undefined) return null;

  const path: string[] = [];
  const onPath = new Set(avoid);
  let budget = 4000;

  const walk = (at: string, left: number): boolean => {
    if (budget-- <= 0) return false;
    path.push(at);
    onPath.add(at);
    if (left === 0) return true;
    for (const next of near(at)
      .filter((candidate) => !onPath.has(candidate) && distance.get(candidate) === left - 1)
      .sort()) {
      if (walk(next, left - 1)) return true;
    }
    // Nothing onward from here, so this word is not on a route after all.
    path.pop();
    onPath.delete(at);
    return false;
  };

  return walk(word, remaining) ? path : null;
}

export function buildPlate(
  graph: Graph,
  source: string,
  target: string,
  revealed: Iterable<Revealed>,
  options: PlateOptions,
): Plate {
  const puzzleBoard = options.board ?? [];
  const found = [...revealed];
  const named = found.map((r) => r.word);

  // Copied, because stranded words get spliced in below and the cached maps must
  // not be mutated.
  const distToTarget = new Map(distancesFrom(graph, target));
  const distFromSource = new Map(distancesFrom(graph, source));

  // Never prune away the words the puzzle is about or the ones already found:
  // a player who walked into a dead end must still see where they are standing.
  // And never prune away the second way out of the source — see secondWayOut.
  const protectedNodes = new Set<string>([
    source,
    target,
    ...named,
    ...secondWayOut(graph, source, distToTarget),
  ]);

  // Anchors: the source plus the named words that have been expanded, so naming
  // a word outside the drawn region pulls in the routes from there onward.
  const anchors = [source, ...named]
    .filter((w) => graph.has(w) && graph.isCommon(w))
    .filter((w) => w === source || !options.anchors || options.anchors.has(w));

  /**
   * The words to draw: what the puzzle declares, plus wherever the player has got to.
   *
   * The board is not worked out here. A puzzle *is* a set of words — its ways through and
   * enough of the graph joining them that they read as one neighbourhood — and the builder
   * chose that set with the whole graph in hand. This module used to derive its own: a ball
   * around the answer at some slack, pruned of dead ends, trimmed to a budget by bisection.
   * That was a second filter reaching for the same thing as the builder's, disagreeing with it
   * about which words counted, and rerun on every guess.
   *
   * What is left is the one thing the client genuinely knows and the builder cannot: where the
   * player has been. Guessing off the map still extends the map — a word named outside the
   * declared board arrives with a route onward, so it is joined to something and leads
   * somewhere rather than sitting in a corner as a dot.
   */
  const live = new Set<string>(protectedNodes);
  for (const word of puzzleBoard) {
    if (graph.has(word)) live.add(word);
  }
  for (const word of anchors) {
    if (live.has(word) && puzzleBoard.includes(word)) continue;
    const onward = descend(word, (w) => graph.commonNeighbors(w), distToTarget, new Set());
    if (onward) for (const step of onward) live.add(step);
  }

  // What the widest route on the board strays from optimal. A statistic now rather than an
  // input: nothing here chooses words by it.
  let slack = 0;
  for (const word of live) {
    const ds = distFromSource.get(word);
    const dt = distToTarget.get(word);
    if (ds === undefined || dt === undefined) continue;
    slack = Math.max(slack, ds + dt - (distToTarget.get(source) ?? 0));
  }

  const nodes = [...live].sort();

  const seen = new Set<string>();
  const edges: PlateEdge[] = [];
  const addEdge = (a: string, b: string) => {
    const key = a < b ? `${a} ${b}` : `${b} ${a}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push(a < b ? { a, b } : { a: b, b: a });
  };

  for (const a of nodes) {
    for (const b of graph.commonNeighbors(a)) {
      if (live.has(b)) addEdge(a, b);
    }
  }

  /**
   * Nothing drawn is ever drawn unattached.
   *
   * A word the player found is never pruned — they must be able to see where they
   * are standing — but being kept is not the same as being connected, and a word
   * can end up on the board with no drawn neighbour in two different ways:
   *
   *  - The graph has never heard of it. Guesses are judged against the whole
   *    dictionary, so a legal move can land on an ordinary word outside the common
   *    corpus, and such a word has no edges here at all.
   *  - The graph knows it perfectly well, but the route joining it to everything
   *    else did not survive the drawing budget. This is the one that was missed,
   *    and it is not rare: restoring a saved game materialises every word found so
   *    far at once, against a budget of thirty, so the connecting routes are
   *    exactly what gets trimmed. The word was left as a dot in the corner, which
   *    reads as the game having lost it.
   *
   * Both have the same answer — attach it to whatever it was reached from, which
   * the player has by definition also found, and inherit a place in the vertical
   * ordering from there. Asking "did this end up with an edge?" rather than "is
   * this word in the corpus?" catches both, and cannot be outgrown by a third way.
   */
  const attached = new Set<string>();
  for (const { a, b } of edges) {
    attached.add(a);
    attached.add(b);
  }

  for (const entry of found) {
    if (!live.has(entry.word) || attached.has(entry.word)) continue;
    // Up the trail to the first word that is actually on the board. The source
    // always is, so this terminates.
    let via = entry.via;
    while (via !== null && !live.has(via)) {
      via = found.find((r) => r.word === via)?.via ?? null;
    }
    if (via === null) continue;

    addEdge(via, entry.word);
    attached.add(entry.word);
    attached.add(via);

    const parentToTarget = distToTarget.get(via);
    const parentFromSource = distFromSource.get(via);
    if (parentToTarget !== undefined && !distToTarget.has(entry.word)) {
      distToTarget.set(entry.word, parentToTarget + 1);
    }
    if (parentFromSource !== undefined && !distFromSource.has(entry.word)) {
      distFromSource.set(entry.word, parentFromSource + 1);
    }
  }

  // Moves that leave the board. Counted over the *legal* graph on purpose: the
  // fan says "there is more from here than you can see", and a move to a word the
  // board would never draw is exactly that.
  const spurCount = new Map<string, number>();
  for (const word of nodes) {
    let off = 0;
    for (const nbr of graph.neighbors(word)) if (!live.has(nbr)) off += 1;
    spurCount.set(word, off);
  }

  const par = distToTarget.get(source);
  const routeNodes = new Set<string>();
  if (par !== undefined) {
    for (const word of nodes) {
      const ds = distFromSource.get(word);
      const dt = distToTarget.get(word);
      if (ds !== undefined && dt !== undefined && ds + dt === par) routeNodes.add(word);
    }
  }

  return {
    nodes,
    edges,
    routeNodes,
    distToTarget,
    distFromSource,
    spurCount,
    slack,
    best: par ?? 1,
  };
}
