/**
 * A hand-built graph for tests, small enough to reason about completely.
 *
 *   base ──ball@4── baseball ──base@0── ball ──cannon@0── cannonball ──ball@6── cannon
 *
 * So `ball` is a hub of degree 2, `base` and `cannon` are leaves, and the only
 * route from `base` to `cannon` runs the whole width of it.
 *
 * The dictionary carries extra words that are deliberately *not* in the graph —
 * `lifespan`, `lime` — to exercise the case where a legal guess lands on a word
 * the board has never heard of.
 */

import { buildGraph, type Rows } from '../lib/graph';
import { decodeRows } from '../lib/data';
import type { Graph, GraphParams } from '../lib/types';

/** The canonical index: sorted, exactly as the builder emits it. */
export const DICTIONARY = [
  'ball',
  'base',
  'baseball',
  'cannon',
  'cannonball',
  'life',
  'lifespan',
  'lifetime',
  'lime',
  'span',
].sort();

export const PARAMS: GraphParams = { commonScowl: 35, legalScowl: 80, minWord: 4, minSub: 2 };

/** [big, small] pairs, as index pairs into the dictionary. */
export const EDGES: [string, string][] = [
  ['baseball', 'base'], // − ball @ 4
  ['baseball', 'ball'], // − base @ 0
  ['cannonball', 'cannon'], // − ball @ 6
  ['cannonball', 'ball'], // − cannon @ 0
];

/**
 * Neighbour rows from word pairs, the way the builder emits them.
 *
 * The tests describe the toy graph as edges because that is how a person thinks about
 * it; the client is handed rows because that is what it ships. This is the one place
 * that translates, so a fixture cannot drift into building a graph of a different
 * shape from the real one.
 */
export function rowsOf(words: readonly string[], edges: readonly [string, string][]): Rows {
  const at = (word: string) => words.indexOf(word);
  const halves = words.map(() => [] as number[]);
  for (const [a, b] of edges) {
    const [low, high] = at(a) < at(b) ? [at(a), at(b)] : [at(b), at(a)];
    halves[low]!.push(high);
  }
  for (const half of halves) half.sort((x, y) => x - y);
  return decodeRows({
    counts: halves.map((half) => half.length),
    above: halves.flatMap((half) => half.map((id, i) => (i === 0 ? id : id - half[i - 1]!))),
  });
}

export function testGraph(extraWords: string[] = []): Graph {
  const words = [...DICTIONARY, ...extraWords].sort();
  const rows = rowsOf(words, EDGES);
  // Every word ordinary, which is what these tests want: an empty common set means
  // "the whole dictionary counts". See buildGraph.
  return buildGraph(PARAMS, words, rows, rows, new Set());
}
