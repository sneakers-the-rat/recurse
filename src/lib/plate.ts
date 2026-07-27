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
  /** How many moves worse than optimal a drawn route may be. */
  slack: number;
  /** Back off slack until the drawn set fits under this. */
  maxDrawn?: number;
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
  // The first is the shortest route, which is drawn anyway; the second is the one
  // at risk. Fewer than two and the puzzle should not have been offered.
  const branch = options[1];
  if (branch === undefined) return [];

  const path = [branch];
  let at = branch;
  let remaining = distToTarget.get(branch)!;
  while (remaining > 0) {
    const next = graph
      .commonNeighbors(at)
      .find((word) => (distToTarget.get(word) ?? Infinity) === remaining - 1);
    if (next === undefined) return [];
    path.push(next);
    at = next;
    remaining -= 1;
  }
  return path;
}

export function buildPlate(
  graph: Graph,
  source: string,
  target: string,
  revealed: Iterable<Revealed>,
  options: PlateOptions,
): Plate {
  const maxDrawn = options.maxDrawn ?? 90;
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
   * Nodes on a route from any anchor to the target no worse than `slack`, or
   * null if there are already more than `cap` of them.
   *
   * Deliberately a fresh bounded search rather than a scan of the cached
   * distance map. With two-letter subwords the graph is dense enough that ~100k
   * words sit within the widest slack, so anything proportional to that is far
   * too slow to run after every guess. Expanding outward and abandoning the
   * moment the board cannot fit keeps the work proportional to what is actually
   * drawn, which is at most a hundred nodes.
   */
  const gather = (slack: number, cap: number): Map<string, number> | null => {
    const candidates = new Map<string, number>();
    for (const word of protectedNodes) candidates.set(word, 0);
    for (const anchor of anchors) {
      const anchorToTarget = distToTarget.get(anchor);
      if (anchorToTarget === undefined) continue;
      const limit = anchorToTarget + slack;

      // Expansion is confined to nodes that are themselves on an admissible
      // route. That is exact, not an approximation: if `d(w) + dt(w) > limit`
      // then no route through w fits, and every node along a shortest path to an
      // admissible node is admissible too — so nothing reachable is missed. It
      // is what keeps the search proportional to the board instead of to the
      // ball around it, which at this density is most of the language.
      const admissible = (word: string, depth: number) => {
        const dt = distToTarget.get(word);
        return dt !== undefined && depth + dt <= limit;
      };

      if (!admissible(anchor, 0)) continue;
      const visited = new Set<string>([anchor]);
      let frontier = [anchor];
      for (let d = 0; frontier.length > 0 && d <= limit; d++) {
        for (const word of frontier) {
          const dt = distToTarget.get(word) ?? 0;
          const over = d + dt - anchorToTarget;
          const seen = candidates.get(word);
          if (seen === undefined || over < seen) candidates.set(word, over);
          if (candidates.size > cap) return null;
        }
        if (d === limit) break;
        const next: string[] = [];
        for (const word of frontier) {
          for (const neighbor of graph.commonNeighbors(word)) {
            if (visited.has(neighbor) || !admissible(neighbor, d + 1)) continue;
            visited.add(neighbor);
            next.push(neighbor);
          }
        }
        frontier = next;
      }
    }
    return candidates;
  };

  // Widen from the floor until the board is as generous as it can be while
  // staying readable.
  //
  // Starting at zero — the best routes and nothing else — is what makes the
  // upper bound a guarantee rather than a hope. It also has to be adaptive at
  // all because the puzzle bank measures neighbourhood size on the *common*
  // graph, while this draws the *legal* one, which is five times larger; a board
  // recorded as 40 nodes there can be 700 here.
  //
  // Ascending rather than descending because on a graph this size the ball at a
  // large slack is enormous, so descending paid for the biggest set first and
  // then discarded it. Odd values are skipped: parity means they add nothing.
  //
  // The cap only bounds the work; it is not a proxy for what will fit. Deriving
  // it from maxDrawn was wrong once the drawing budget shrank: a wide
  // neighbourhood then blew the cap, the widening gave up, and the board fell
  // back to the shortest paths alone — no alternatives at all on exactly the
  // puzzles that have the most of them. Trimming decides what fits; this only
  // decides when a neighbourhood is too big to be worth gathering.
  const cap = Math.max(maxDrawn * 20, 1500);

  /**
   * Trim an oversized board down, dropping the *worst* detours first.
   *
   * Backing off to a narrower slack instead was a real bug: with two-letter
   * subwords, slack 2 routinely blows past maxDrawn, so the board collapsed all
   * the way to slack 0 — the shortest path and nothing else, drawn as a bare line
   * with no alternatives to weigh. Keeping the nearest detours and cutting the
   * far ones always leaves something to choose between.
   *
   * How many to keep is found by bisection, because it has to land *close* to the
   * limit and not merely under it. Backing off geometrically undershot badly — a
   * board with room for thirty words was drawn with twenty-three — and, worse, it
   * undershot by a different amount each time, so naming one word could leave the
   * board with fewer words on it than before. Pruning is monotone (adding a
   * candidate can only raise degrees, so the survivors can only grow), which is
   * what makes bisection valid here.
   */
  const trim = (excess: Map<string, number>, limit: number): Set<string> => {
    const order = [...excess.entries()]
      .filter(([word]) => !protectedNodes.has(word))
      .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
      .map(([word]) => word);

    const survivorsOf = (keepCount: number) =>
      pruneDeadEnds(graph, new Set([...protectedNodes, ...order.slice(0, keepCount)]), protectedNodes);

    let best = survivorsOf(0);
    let low = 0;
    let high = order.length;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      const result = survivorsOf(mid);
      if (result.size <= limit) {
        best = result;
        low = mid;
      } else {
        high = mid - 1;
      }
    }
    return best;
  };

  // Slack 0 — the best routes and nothing else — is the floor, and it is drawn
  // whatever happens. Each widening either fits, and is kept, or overflows, in
  // which case it is trimmed back to the budget and the widening stops there.
  const floor = gather(0, cap);
  let slack = 0;
  let live = pruneDeadEnds(graph, floor ? new Set(floor.keys()) : protectedNodes, protectedNodes);
  for (let wider = 2; wider <= options.slack; wider += 2) {
    const candidates = gather(wider, cap);
    if (!candidates) break;
    const pruned = pruneDeadEnds(graph, new Set(candidates.keys()), protectedNodes);
    slack = wider;
    if (pruned.size <= maxDrawn) {
      live = pruned;
      continue;
    }
    live = trim(candidates, maxDrawn);
    break;
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
