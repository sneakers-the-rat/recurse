/**
 * The recurse-word graph.
 *
 * A move deletes a contiguous run of letters that is itself a word, or inserts
 * one. Removal and insertion are inverses, so the graph is undirected and each
 * stored edge yields two moves:
 *
 *     base      --[+ball @ 4]-->  baseball
 *     baseball  --[-ball @ 4]-->  base
 *
 * `pos` is an insertion index into the *shorter* word, which is also where the
 * run starts inside the longer word — because
 * `big === small.slice(0, pos) + sub + small.slice(pos)`. One number serves both
 * directions.
 *
 * This module is the single authority on whether a move is legal. The build
 * script suppresses some subwords (bare affixes like -ing) and enforces minimum
 * lengths; rather than re-deriving those rules in the UI and risking drift, the
 * UI asks the edge list. `analyzeEdit` in moves.ts exists only to *explain*
 * rejections, never to decide them.
 */

import { insertionSpots } from './moves';
import type { Graph, Move, RawGraph } from './types';

/**
 * Undo the delta encoding: pairs of dictionary indices, first element as a
 * running sum. See delta_encode in tools/build_graph.py.
 */
export function decodeEdges(flat: readonly number[]): [number, number][] {
  const pairs: [number, number][] = [];
  let big = 0;
  for (let i = 0; i + 1 < flat.length; i += 2) {
    big += flat[i]!;
    pairs.push([big, flat[i + 1]!]);
  }
  return pairs;
}

/**
 * Build the graph from the edge list and the dictionary that indexes it.
 *
 * Adjacency stores only the neighbouring words. The subword and its position are
 * *derived* from a word pair on demand rather than shipped: recovering them costs
 * a handful of string slices, only the few moves actually displayed ever need
 * them, and not shipping them cut the edge list from 1,278KB to 352KB gzipped.
 */
export function buildGraph(
  raw: RawGraph,
  dictionary: readonly string[],
  common?: ReadonlySet<string>,
): Graph {
  const { edges, params } = raw;

  const words = new Set<string>(dictionary);
  const adjacency = new Map<string, string[]>();

  const link = (from: string, to: string) => {
    const list = adjacency.get(from);
    if (list) list.push(to);
    else adjacency.set(from, [to]);
  };

  for (const [bigIdx, smallIdx] of decodeEdges(edges)) {
    const big = dictionary[bigIdx];
    const small = dictionary[smallIdx];
    if (big === undefined || small === undefined) {
      throw new Error(`graph.json edge references a missing index: ${bigIdx},${smallIdx}`);
    }
    link(big, small);
    link(small, big);
  }

  // Stable order so layout and rendering never depend on edge-file ordering.
  for (const list of adjacency.values()) list.sort();

  const empty: readonly string[] = Object.freeze([]);
  const isWord = (word: string) => words.has(word);
  // Absent a common list, every word counts as ordinary — which is what the toy
  // fixtures in the tests want.
  const isCommon = (word: string) => (common ? common.has(word) : words.has(word));

  const describe = (from: string, to: string): Move => {
    const adding = to.length > from.length;
    const shorter = adding ? from : to;
    const longer = adding ? to : from;
    const spots = insertionSpots(shorter, longer);
    // The edge exists, so at least one reading is a legal word; prefer that one,
    // and be generous when several readings are possible.
    const valid = spots.filter((s) => s.sub.length >= params.minSub && isWord(s.sub));
    const chosen =
      valid.sort((a, b) => b.sub.length - a.sub.length || a.pos - b.pos)[0] ??
      spots.sort((a, b) => b.sub.length - a.sub.length)[0];
    return {
      to,
      sub: chosen?.sub ?? '',
      pos: chosen?.pos ?? 0,
      kind: adding ? 'add' : 'remove',
    };
  };

  /**
   * Neighbours reachable by a move an ordinary player would recognise: both words
   * ordinary, and the word added or removed ordinary too.
   *
   * This is the graph the board is drawn from. Drawing the legal one instead put
   * words nobody knows on the plate and, worse, made the gilt "best route" a line
   * through them that was shorter than the par the puzzle advertised — so the
   * board contradicted the header and gave away the secret in the same stroke.
   * Legality is untouched: every real word is still a legal guess.
   */
  const commonAdjacency = new Map<string, string[]>();

  /**
   * Is there *any* reading of this move that uses an ordinary word?
   *
   * Any, not the one `describe` happens to display: the game already accepts a move
   * if any reading is legal, so the drawn graph has to be generous in the same way.
   * Asking only about the displayed reading made the board disagree with the
   * builder about which edges exist, and boards lost the alternatives that puzzle
   * selection had guaranteed were there.
   */
  const commonMove = (from: string, to: string) => {
    const adding = to.length > from.length;
    const shorter = adding ? from : to;
    const longer = adding ? to : from;
    return insertionSpots(shorter, longer).some(
      (spot) => spot.sub.length >= params.minSub && isCommon(spot.sub),
    );
  };

  const commonNeighbors = (word: string): readonly string[] => {
    const cached = commonAdjacency.get(word);
    if (cached) return cached;
    if (!isCommon(word)) return empty;
    const list = (adjacency.get(word) ?? empty).filter(
      (other) => isCommon(other) && commonMove(word, other),
    );
    commonAdjacency.set(word, list);
    return list;
  };

  return {
    params,
    words: dictionary,
    isWord,
    isCommon,
    commonNeighbors,
    has: (word) => adjacency.has(word),
    neighbors: (word) => adjacency.get(word) ?? empty,
    movesFrom: (word) => (adjacency.get(word) ?? empty).map((to) => describe(word, to)),
    findMove: (from, to) =>
      (adjacency.get(from) ?? empty).includes(to) ? describe(from, to) : null,
    degree: (word) => (adjacency.get(word) ?? empty).length,
  };
}

/**
 * Breadth-first distances from `src`.
 *
 * `edges` picks which graph is being walked: the whole legal one, or the ordinary
 * words the board is drawn from. They give different distances, and the board has
 * to use the same one it draws or the spine will not match the figure on it.
 */
export function bfs(
  graph: Graph,
  src: string,
  maxDepth = Infinity,
  edges: (word: string) => readonly string[] = graph.neighbors,
): Map<string, number> {
  const dist = new Map<string, number>([[src, 0]]);
  let frontier = [src];
  let d = 0;
  while (frontier.length && d < maxDepth) {
    d += 1;
    const next: string[] = [];
    for (const word of frontier) {
      for (const nbr of edges(word)) {
        if (!dist.has(nbr)) {
          dist.set(nbr, d);
          next.push(nbr);
        }
      }
    }
    frontier = next;
  }
  return dist;
}

export interface Corridor {
  nodes: Set<string>;
  fromSrc: Map<string, number>;
  fromTgt: Map<string, number>;
}

/**
 * The nodes worth drawing: those on some path from `src` to `tgt` no longer
 * than `par + slack`.
 *
 * Only even slack changes anything. A node `v` sits on a walk of length
 * `d(src,v) + d(v,tgt)`, whose parity matches `par` throughout the relevant
 * region, so slack 1 yields exactly the slack 0 set. Slack 0 is just the
 * shortest paths — 4 to 9 nodes, with no visible alternatives. Slack 2 is what
 * makes it a graph rather than a line.
 */
export function corridor(graph: Graph, src: string, tgt: string, par: number, slack = 2): Corridor {
  const limit = par + slack;
  const fromSrc = bfs(graph, src, limit);
  const fromTgt = bfs(graph, tgt, limit);
  const nodes = new Set<string>();
  for (const [word, ds] of fromSrc) {
    const dt = fromTgt.get(word);
    if (dt !== undefined && ds + dt <= limit) nodes.add(word);
  }
  return { nodes, fromSrc, fromTgt };
}

/** Nodes on at least one shortest src->tgt path, endpoints included. */
export function shortestPathNodes(graph: Graph, src: string, tgt: string, par: number): Set<string> {
  const fromSrc = bfs(graph, src, par);
  const fromTgt = bfs(graph, tgt, par);
  const nodes = new Set<string>();
  for (const [word, ds] of fromSrc) {
    const dt = fromTgt.get(word);
    if (dt !== undefined && ds + dt === par) nodes.add(word);
  }
  return nodes;
}

/** One shortest path as a list of words, or null if unreachable. */
export function shortestPath(graph: Graph, src: string, tgt: string): string[] | null {
  if (src === tgt) return [src];
  const prev = new Map<string, string | null>([[src, null]]);
  let frontier = [src];
  while (frontier.length) {
    const next: string[] = [];
    for (const word of frontier) {
      for (const nbr of graph.neighbors(word)) {
        if (prev.has(nbr)) continue;
        prev.set(nbr, word);
        if (nbr === tgt) {
          const path: string[] = [];
          for (let cur: string | null = tgt; cur !== null; cur = prev.get(cur) ?? null) {
            path.push(cur);
          }
          return path.reverse();
        }
        next.push(nbr);
      }
    }
    frontier = next;
  }
  return null;
}

/** Shortest distance between two words, or Infinity. */
export function distance(graph: Graph, src: string, tgt: string, maxDepth = 12): number {
  return bfs(graph, src, maxDepth).get(tgt) ?? Infinity;
}
