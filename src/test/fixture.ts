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

import { buildGraph } from '../lib/graph';
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

export function testGraph(extraWords: string[] = []): Graph {
  const words = [...DICTIONARY, ...extraWords].sort();
  const at = (word: string) => words.indexOf(word);
  return buildGraph(
    PARAMS,
    words,
    EDGES.map(([big, small]) => [at(big), at(small)] as const),
  );
}
