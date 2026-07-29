/**
 * The file format. Untested until the three copies of it became one — and the
 * decoder is exactly the kind of code that fails silently, by producing a graph
 * that is wrong rather than a graph that throws.
 */

import { describe, expect, it } from 'vitest';
import { decodeDeltas, decodeRows, decodeGameData } from './data';
import { DICTIONARY, EDGES, PARAMS } from '../test/fixture';

describe('decodeDeltas', () => {
  it('turns steps back into indices', () => {
    expect(decodeDeltas([3, 1, 0, 5])).toEqual([3, 4, 4, 9]);
    expect(decodeDeltas([])).toEqual([]);
  });
});

describe('decodeRows', () => {
  it('mirrors half a row into a whole one', () => {
    // Word 0 joins 1 and 2; word 1 joins 2. Each edge is written once, from its lower
    // end, and the rest of the graph is derived.
    const rows = decodeRows({ counts: [2, 1, 0], above: [1, 1, 2] });
    expect([...rows.degrees]).toEqual([2, 2, 2]);
    expect([...rows.offsets]).toEqual([0, 2, 4, 6]);
    // Every row ascending, without anything being sorted.
    expect([...rows.targets]).toEqual([1, 2, 0, 2, 0, 1]);
  });

  it('handles a graph with no edges at all', () => {
    const rows = decodeRows({ counts: [0, 0], above: [] });
    expect([...rows.offsets]).toEqual([0, 0, 0]);
    expect(rows.targets).toHaveLength(0);
  });

  it('refuses a row that points outside the dictionary', () => {
    expect(() => decodeRows({ counts: [1], above: [9] })).toThrow(/missing/);
  });
});

describe('decodeGameData', () => {
  const at = (word: string) => DICTIONARY.indexOf(word);

  /** Re-encode the fixture the way the builder writes it. */
  const encode = (edges: readonly [string, string][]) => {
    const halves = DICTIONARY.map(() => [] as number[]);
    for (const [a, b] of edges) {
      const [low, high] = at(a) < at(b) ? [at(a), at(b)] : [at(b), at(a)];
      halves[low]!.push(high);
    }
    for (const half of halves) half.sort((x, y) => x - y);
    return {
      counts: halves.map((half) => half.length),
      above: halves.flatMap((half) => half.map((id, i) => (i === 0 ? id : id - half[i - 1]!))),
    };
  };
  // `ball` and `base` are the ordinary words and no move joins them, so the common
  // graph the builder would ship for this fixture is empty. The client takes it as
  // given rather than filtering the legal one, which is the point.
  const files = {
    dictionary: { words: DICTIONARY.join('\n') },
    graph: { params: PARAMS, legal: encode(EDGES), common: encode([]) },
    manifest: {
      version: 'testtest',
      shards: 256,
      days: 1,
      puzzles: 0,
      params: { slack: 6, minPar: 3, maxPar: 5 },
    },
    puzzles: [],
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

  it('carries the manifest through, since the calendar arithmetic needs it', () => {
    expect(decodeGameData(files).manifest).toMatchObject({ shards: 256, days: 1 });
  });
});
