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
 * This module is the single authority on whether a move is legal. The builder
 * suppresses some subwords (bare affixes like -ing) and enforces minimum
 * lengths; rather than re-deriving those rules in the UI and risking drift, the
 * UI asks the edge list. `analyzeEdit` in moves.ts exists only to *explain*
 * rejections, never to decide them.
 *
 * What is *on disk* is data.ts's business. This takes a decoded edge list.
 */

import { insertionSpots, wordReading } from './moves';
import type { Graph, GraphParams, Move } from './types';

/**
 * Build the graph from the edge list and the dictionary that indexes it.
 *
 * Adjacency stores only the neighbouring words. The subword and its position are
 * *derived* from a word pair on demand rather than shipped: recovering them costs
 * a handful of string slices, only the few moves actually displayed ever need
 * them, and not shipping them cut the edge list from 1,278KB to 352KB gzipped.
 */
export interface Rows {
  /** Neighbour count per dictionary word. */
  degrees: Int32Array;
  /** Every neighbour list, concatenated in word order. */
  targets: Int32Array;
  /** Where each word's row starts in `targets`. */
  offsets: Int32Array;
}

/**
 * Build the graph from neighbour lists the builder already worked out.
 *
 * Both graphs arrive as rows over dictionary ids, and nothing is assembled here: the
 * browser used to turn an edge list into 151,000 adjacency arrays on every page load —
 * 517,000 pushes, a fifth of a second before a board could be drawn — and to derive the
 * *common* graph edge by edge on top of that, by asking whether some reading of each
 * move named an ordinary word. Both are now the builder's job, which is where the
 * definitions live anyway. See tools/graphgen/src/main.rs.
 *
 * Words are turned into strings lazily, per row, and cached. A session touches a few
 * thousand words of the 189,000 in the dictionary, so materialising all of them up
 * front was work thrown away.
 *
 * Adjacency still stores only the neighbouring words. The subword and its position are
 * *derived* from a word pair on demand rather than shipped: recovering them costs a
 * handful of string slices, only the few moves actually displayed ever need them, and
 * not shipping them keeps the file a third of the size.
 */
export function buildGraph(
  params: GraphParams,
  dictionary: readonly string[],
  legal: Rows,
  common: Rows,
  commonWords: ReadonlySet<string>,
): Graph {
  const ids = new Map<string, number>();
  for (let i = 0; i < dictionary.length; i++) ids.set(dictionary[i]!, i);

  const empty: readonly string[] = Object.freeze([]);
  const materialise = (rows: Rows, cache: Map<number, readonly string[]>, id: number) => {
    const cached = cache.get(id);
    if (cached) return cached;
    const from = rows.offsets[id]!;
    const count = rows.degrees[id]!;
    if (count === 0) return empty;
    const list: string[] = new Array(count);
    for (let i = 0; i < count; i++) list[i] = dictionary[rows.targets[from + i]!]!;
    cache.set(id, list);
    return list;
  };

  const legalCache = new Map<number, readonly string[]>();
  const commonCache = new Map<number, readonly string[]>();

  const isWord = (word: string) => ids.has(word);
  // Absent a common list, every word counts as ordinary — which is what the toy
  // fixtures in the tests want.
  const isCommon = (word: string) =>
    commonWords.size === 0 ? ids.has(word) : commonWords.has(word);

  const neighbors = (word: string): readonly string[] => {
    const id = ids.get(word);
    return id === undefined ? empty : materialise(legal, legalCache, id);
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
  const commonNeighbors = (word: string): readonly string[] => {
    const id = ids.get(word);
    return id === undefined ? empty : materialise(common, commonCache, id);
  };

  const describe = (from: string, to: string): Move => {
    const adding = to.length > from.length;
    const spots = insertionSpots(adding ? from : to, adding ? to : from);
    // The edge exists, so some reading names a word; that is the one to show. The
    // fallback is for callers that describe a pair which is not an edge at all.
    const chosen =
      wordReading(spots, params.minSub, isWord) ??
      [...spots].sort((a, b) => b.sub.length - a.sub.length)[0];
    return {
      to,
      sub: chosen?.sub ?? '',
      pos: chosen?.pos ?? 0,
      kind: adding ? 'add' : 'remove',
    };
  };

  const degree = (word: string) => {
    const id = ids.get(word);
    return id === undefined ? 0 : legal.degrees[id]!;
  };

  return {
    params,
    words: dictionary,
    isWord,
    isCommon,
    commonNeighbors,
    has: (word) => degree(word) > 0,
    neighbors,
    findMove: (from, to) => (neighbors(from).includes(to) ? describe(from, to) : null),
    degree,
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
