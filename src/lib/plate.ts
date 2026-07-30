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
  /**
   * Every move the player has made, as pairs.
   *
   * `revealed` carries the move each word *arrived* by, which is one edge per word and
   * therefore not every move: a move onto a word already named reveals nothing, so it leaves
   * no trace there. Those are exactly the moves that join a game played from both ends — the
   * winning move of such a round — and drawing the board from arrivals alone left it off the
   * figure with the subword that names it. See `joins` in game.ts.
   */
  moves?: readonly { from: string; to: string }[];
  /**
   * The words on a shortcut the player has found an end of, if they have.
   *
   * Drawn like a found word — every legal edge it has to the board — because a shortcut is
   * only ever handed over once its existence has been earned. Empty or absent until then,
   * which is what keeps the board agreeing with the par in the header. See App's secret
   * trail and `secret` on Puzzle.
   */
  secret?: ReadonlySet<string>;
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

  // The two words the puzzle is about, and everything the player has found: a player who
  // walked into a dead end must still see where they are standing.
  //
  // The second way out of an end is *not* here. It used to be, worked out client-side and
  // forced onto the board — but the builder declares the opening branch at each end now, at the
  // same reach the rule promises it at, so computing one here could only add words the puzzle
  // never declared. Which is the whole failure mode this file was built to stop having.
  const protectedNodes = new Set<string>([source, target, ...named]);

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
  // The rest of a shortcut the player is standing on. Unnamed and unlabelled — this says a
  // shorter way exists and that the words are there to be guessed, not what they are.
  for (const word of options.secret ?? []) {
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

  /**
   * Every edge there is between two drawn words — with one line drawn between what "there
   * is" means for a word the player walked to and a word the puzzle merely declares.
   *
   * A word the player **reached by a move** shows *all* of its legal moves to words on the
   * board. Anything less is a lie about where they are standing: a word arriving from off
   * the corpus was drawn joined only to the word it sprouted from, so a rare word sitting
   * between three drawn words looked like a spur off one of them. The edge list is shipped
   * and indexed by word, so this is a row lookup per drawn word — no search, nothing to
   * wait for, nothing to show progress of.
   *
   * A word **nobody has reached yet** shows its common moves only, and that is not
   * conservatism about drawing: a legal edge between two ordinary words that the player has
   * not found is a *shortcut*, and drawing it puts a line on the board that is shorter than
   * the par in the header. The whole point of a secret is that finding it is the reward — so
   * the board keeps quiet about one until the player has an end of it. See `secret` on
   * Puzzle, and App's secret trail.
   */
  const reached = new Set(found.filter((entry) => entry.via !== null).map((entry) => entry.word));
  const openly = (word: string) => reached.has(word) || (options.secret?.has(word) ?? false);
  for (const a of nodes) {
    for (const b of openly(a) ? graph.neighbors(a) : graph.commonNeighbors(a)) {
      if (live.has(b)) addEdge(a, b);
    }
  }

  /**
   * **Every move the player has made is drawn**, and that is a stronger promise than the
   * one this used to keep.
   *
   * It used to ask only whether a found word had ended up with *some* edge, and attach the
   * orphans. Which covered the two ways a kept word can end up with no drawn neighbour —
   * the graph has never heard of it, because guesses are judged against the whole
   * dictionary and a legal move can land outside the common corpus; or the graph knows it
   * and the route joining it to the rest was not part of what the puzzle declared — but it
   * missed the case where the word at the *far* end already had edges of its own. Then the
   * move was silently not on the board.
   *
   * That is every secret route there is: walking one steps out to a rare word and back onto
   * the answer, and the step back lands on a word that is already drawn and already joined
   * to its neighbours, so nothing was orphaned and nothing was added. The player's own move
   * was missing from the figure — measured at 40 boards out of 40 with a secret — and the
   * label naming the subword went with it, since GraphPlate can only write it along an edge
   * that exists.
   *
   * So the trail is drawn because it was walked, not because the alternative would look
   * broken. A word off the corpus also inherits its place in the vertical ordering from
   * where it was reached from, which is the only thing that can say where it belongs.
   */
  for (const entry of found) {
    if (!live.has(entry.word)) continue;
    // Up the trail to the first word that is actually on the board. The source
    // always is, so this terminates.
    let via = entry.via;
    while (via !== null && !live.has(via)) {
      via = found.find((r) => r.word === via)?.via ?? null;
    }
    if (via === null) continue;

    addEdge(via, entry.word);

    const parentToTarget = distToTarget.get(via);
    const parentFromSource = distFromSource.get(via);
    if (parentToTarget !== undefined && !distToTarget.has(entry.word)) {
      distToTarget.set(entry.word, parentToTarget + 1);
    }
    if (parentFromSource !== undefined && !distFromSource.has(entry.word)) {
      distFromSource.set(entry.word, parentFromSource + 1);
    }
  }

  // And the moves that revealed nothing, which the loop above cannot see: both ends were
  // already named, so neither carries this edge as the one it arrived by. Both are on the
  // board by construction — a named word is protected — so there is nothing to attach, only
  // a line to draw.
  for (const { from, to } of options.moves ?? []) {
    if (live.has(from) && live.has(to)) addEdge(from, to);
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
