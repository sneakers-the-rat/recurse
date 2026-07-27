/**
 * The file format. Untested until the three copies of it became one — and the
 * decoder is exactly the kind of code that fails silently, by producing a graph
 * that is wrong rather than a graph that throws.
 */

import { describe, expect, it } from 'vitest';
import { decodeDeltas, decodeEdges, decodeGameData } from './data';
import { DICTIONARY, EDGES, PARAMS } from '../test/fixture';

describe('decodeDeltas', () => {
  it('turns steps back into indices', () => {
    expect(decodeDeltas([3, 1, 0, 5])).toEqual([3, 4, 4, 9]);
    expect(decodeDeltas([])).toEqual([]);
  });
});

describe('decodeEdges', () => {
  it('delta-decodes the first of each pair and leaves the second alone', () => {
    expect(decodeEdges([2, 7, 3, 1])).toEqual([
      [2, 7],
      [5, 1],
    ]);
  });

  it('ignores a trailing half-pair rather than inventing an index', () => {
    expect(decodeEdges([2, 7, 3])).toEqual([[2, 7]]);
  });
});

describe('decodeGameData', () => {
  const at = (word: string) => DICTIONARY.indexOf(word);

  /** Re-encode the fixture the way the builder writes it. */
  const files = {
    dictionary: { words: DICTIONARY.join('\n') },
    graph: {
      params: PARAMS,
      edges: EDGES.map(([big, small]) => [at(big), at(small)] as [number, number])
        .sort((a, b) => a[0] - b[0] || a[1] - b[1])
        .flatMap(([big, small], i, all) => [big - (i === 0 ? 0 : all[i - 1]![0]), small]),
    },
    puzzles: {
      params: { slack: 6, drawSlack: 6, drawMax: 30, minPar: 3, maxPar: 5 },
      puzzles: [],
    },
    common: { common: [at('ball'), at('base') - at('ball')] },
  };

  it('round-trips the edge list into a working graph', () => {
    const { graph } = decodeGameData(files);
    expect(graph.findMove('base', 'baseball')).toMatchObject({ sub: 'ball', pos: 4 });
    expect([...graph.neighbors('ball')].sort()).toEqual(['baseball', 'cannonball']);
  });

  it('marks exactly the words the common list names', () => {
    const { graph } = decodeGameData(files);
    expect(graph.isCommon('ball')).toBe(true);
    expect(graph.isCommon('base')).toBe(true);
    // Legal to guess, but never drawn — the distinction the whole game rests on.
    expect(graph.isCommon('baseball')).toBe(false);
    expect(graph.isWord('baseball')).toBe(true);
    expect(graph.commonNeighbors('baseball')).toEqual([]);
  });

  it('carries the draw budget out of the puzzle file', () => {
    expect(decodeGameData(files)).toMatchObject({ drawSlack: 6, drawMax: 30 });
  });
});
