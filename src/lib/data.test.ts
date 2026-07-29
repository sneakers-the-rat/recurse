/**
 * The file format. Untested until the three copies of it became one — and the
 * decoder is exactly the kind of code that fails silently, by producing a graph
 * that is wrong rather than a graph that throws.
 */

import { describe, expect, it } from 'vitest';
import { bandOf, decodeDeltas, decodeRows, decodeGameData, shardForDay, shardOf } from './data';
import { DICTIONARY, EDGES, PARAMS } from '../test/fixture';
import { shippedData, shippedShard } from '../test/shipped';
import { puzzleForDay } from './daily';

/**
 * Which shard a board is in, which is the one piece of arithmetic the client and the builder
 * both have to get right and neither can check alone.
 *
 * It is also the arithmetic a bug hides in for months: shards are named by id prefix and
 * there are 256 of them, while the shortest band's calendar is 27,000 days long, so *any*
 * wrong answer here is right for the first 85 days of the bank.
 */
describe('shardForDay', () => {
  const { manifest } = shippedData();
  const bands = manifest.bands.map((_, index) => index);

  it('names a shard that exists, for any day of any length', () => {
    // Including the days past the number of shards, which is where the day number was being
    // used as a shard index and the game would have stopped loading altogether.
    for (const band of bands) {
      const days = bandOf(band, manifest).days;
      for (const day of [0, 1, 255, 256, 257, 999, days - 1, days, -1]) {
        const index = shardForDay(band, day, manifest);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(manifest.shards);
      }
    }
  });

  it('names the shard that actually holds that board, in the bank that shipped', () => {
    // The builder's promise, checked against the files: `spread` placed band B on day N in
    // shard `(N * 3 + B) % SHARDS`, and a puzzle's id — hence its shard — is a digest of its
    // own answer, so nothing but the builder's own placement makes these agree.
    for (const band of bands) {
      const days = bandOf(band, manifest).days;
      for (const day of [0, 1, 3, 255, 256, 300, 1000]) {
        const index = shardForDay(band, day, manifest);
        const found = puzzleForDay(shippedShard(index), band, day, days);
        expect(found, `band ${band} day ${day} should be in shard ${index}`).not.toBeNull();
        expect(shardOf(found!.puzzle.id)).toBe(index);
        expect(found!.puzzle.band).toBe(band);
      }
    }
  });

  it('gives the three lengths of one day three different shards', () => {
    // Which is what makes playing one length one fetch. Three bands over 256 shards, and 256
    // is a power of two, so the stride of three never collides with itself.
    for (const day of [0, 1, 85, 86, 1000]) {
      const seen = bands.map((band) => shardForDay(band, day, manifest));
      expect(new Set(seen).size).toBe(bands.length);
    }
  });
});

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
      bands: [
        { name: 'short', days: 1, minPar: 3, maxPar: 4 },
        { name: 'medium', days: 1, minPar: 5, maxPar: 6 },
        { name: 'long', days: 1, minPar: 7, maxPar: 10 },
      ],
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
    const { manifest } = decodeGameData(files);
    expect(manifest).toMatchObject({ shards: 256 });
    // Three lengths, each with its own calendar. The client cannot work out where they
    // divide, so the builder says.
    expect(manifest.bands.map((band) => band.name)).toEqual(['short', 'medium', 'long']);
  });
});
