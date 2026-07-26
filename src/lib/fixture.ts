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

import { buildGraph } from './graph';
import type { Graph, RawGraph } from './types';

/** The canonical index: sorted, exactly as the build script emits it. */
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

const at = (word: string) => DICTIONARY.indexOf(word);

/** [big, small] pairs, first element delta-encoded. See delta_encode. */
function encode(pairs: [string, string][]): number[] {
  const sorted = pairs
    .map(([big, small]) => [at(big), at(small)] as [number, number])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const flat: number[] = [];
  let previous = 0;
  for (const [big, small] of sorted) {
    flat.push(big - previous, small);
    previous = big;
  }
  return flat;
}

export const RAW: RawGraph = {
  params: { commonScowl: 35, legalScowl: 80, minWord: 4, minSub: 2, internalOnly: false },
  edges: encode([
    ['baseball', 'base'], // − ball @ 4
    ['baseball', 'ball'], // − base @ 0
    ['cannonball', 'cannon'], // − ball @ 6
    ['cannonball', 'ball'], // − cannon @ 0
  ]),
};

export function testGraph(extraWords: string[] = []): Graph {
  return buildGraph(RAW, [...DICTIONARY, ...extraWords].sort());
}
