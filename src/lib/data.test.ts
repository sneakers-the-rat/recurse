/**
 * The file format. Untested until the three copies of it became one — and the
 * decoder is exactly the kind of code that fails silently, by producing a graph
 * that is wrong rather than a graph that throws.
 */

import { describe, expect, it } from 'vitest';
import { decodeDeltas, decodeRows, decodeGameData, shardOf } from './data';
import { DICTIONARY, EDGES, PARAMS } from '../test/fixture';
import {
  shippedBank,
  shippedCalendar,
  shippedData,
  shippedIdForDay,
  shippedManifest,
  shippedShard,
} from '../test/shipped';

/**
 * The calendar, which is the one thing the client and the builder both have to get right and
 * neither can check alone. Read off the shipped files, so what is asserted is the deploy.
 */
describe('the calendar', () => {
  const manifest = shippedManifest();
  const bands = manifest.bands.map((_, index) => index);

  it('names a real board for every band on any day, including past the end', () => {
    for (const band of bands) {
      for (const day of [0, 1, 255, 256, 999, manifest.days - 1, manifest.days, -1]) {
        const id = shippedIdForDay(band, day);
        expect(id, `band ${band} day ${day}`).not.toBeNull();
        expect(id).toHaveLength(12);
      }
    }
  });

  it('puts that board in the shard its own id names, with the band it was asked for', () => {
    // The cross-language promise: the calendar file says which id, the id's first two hex digits
    // say which shard, and the shard is the only place the band is written down. Nothing but the
    // builder writing all three from the same bank makes these agree.
    for (const band of bands) {
      for (const day of [0, 1, 3, 255, 256, 300, 1000]) {
        const id = shippedIdForDay(band, day)!;
        const found = shippedShard(shardOf(id)).find((puzzle) => puzzle.id === id);
        expect(found, `band ${band} day ${day} id ${id}`).toBeDefined();
        expect(found!.band).toBe(band);
      }
    }
  });

  it('gives the three lengths of one day three different boards', () => {
    for (const day of [0, 1, 85, 86, 1000]) {
      const seen = bands.map((band) => shippedIdForDay(day === 0 ? band : band, day));
      expect(new Set(seen).size).toBe(bands.length);
    }
  });

  /**
   * **Every puzzle that ships is on the calendar.** The regression test for the bug this
   * calendar replaced: days used to have to line up with shards, the round robin ran out of the
   * thinnest shard long before the bank was empty, and 13,829 puzzles — 37% of them — shipped
   * with day numbers nothing would ever ask for. They could only be opened by an id, and an id
   * can only be had from somebody who already played the board, so they could not be opened at
   * all.
   *
   * Reads all 46 year files and the whole bank, which is a few MB off a local disk.
   */
  it('leaves no puzzle unreachable', { timeout: 60_000 }, () => {
    const onCalendar = new Set<string>();
    for (let year = manifest.years[0]; year <= manifest.years[1]; year++) {
      const calendar = shippedCalendar(year);
      for (const run of calendar.bands) {
        for (let at = 0; at + calendar.idChars <= run.length; at += calendar.idChars) {
          onCalendar.add(run.slice(at, at + calendar.idChars));
        }
      }
    }
    const shipped = shippedBank().map((puzzle) => puzzle.id);
    const orphans = shipped.filter((id) => !onCalendar.has(id));
    expect(orphans.slice(0, 5)).toEqual([]);
    expect(orphans).toHaveLength(0);
    // And nothing on the calendar that is not in the bank.
    expect(onCalendar.size).toBe(new Set(shipped).size);
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
        { name: 'short', minPar: 3, maxPar: 4 },
        { name: 'medium', minPar: 5, maxPar: 6 },
        { name: 'long', minPar: 7, maxPar: 10 },
      ],
      puzzles: 0,
      epoch: '2026-07-26',
      days: 1,
      years: [2026, 2026] as [number, number],
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
