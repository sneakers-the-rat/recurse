/** The open map's guesses, economy and save format, over the shipped letters data. */

import { describe, expect, it } from 'vitest';
import { walk } from './trail';
import {
  abandon,
  canStart,
  collect,
  drop,
  dropCost,
  guess,
  hopsFrom,
  loadAtlas,
  missions,
  name,
  NAMED,
  NAME_COST,
  openAtlas,
  refresh,
  saveAtlas,
  SLOTS,
  take,
  travel,
  spread,
  travelTo,
  wander,
  type Atlas,
} from './atlas';
import { PLAIN } from './lexicon';
import { buildRegions, type Regions } from './regions';
import { shippedMap } from '../test/shipped';
import type { Graph } from './types';

const { graph: shippedGraph, regions } = shippedMap();
const graph: Graph = shippedGraph;

/** The word with the most common moves in the biggest region, so there is room to move. */
const biggest = [...Array(regions.count).keys()].sort(
  (one, two) => regions.words(two).length - regions.words(one).length,
)[0]!;
const START = regions
  .words(biggest)
  .slice()
  .sort((one, two) => graph.commonNeighbors(two).length - graph.commonNeighbors(one).length)[0]!;

/** A fresh map after `steps` guesses. */
function grown(steps: number): Atlas {
  let atlas = openAtlas(START);
  for (let step = 0; step < steps; step++) {
    const here = [...atlas.revealed.keys()].find((word) =>
      graph.commonNeighbors(word).some((near) => !atlas.revealed.has(near)),
    );
    if (here === undefined) break;
    const next = graph.commonNeighbors(here).find((near) => !atlas.revealed.has(near))!;
    atlas = travel(atlas, here).atlas;
    atlas = guess(atlas, graph, next).atlas;
  }
  return atlas;
}

describe('starting a map', () => {
  /** What the rim around a word alone would hold. See `atlasFigure`. */
  const rim = (word: string) => graph.commonNeighbors(word).filter((near) => regions.has(near));

  it('starts from a word with something drawn around it', () => {
    expect(canStart(graph, regions, START)).toBe(true);
  });

  it('refuses a word on the map whose only moves are to words it does not draw', () => {
    // The reported case: in a region, with legal moves, and not one common one.
    expect(regions.has('gym')).toBe(true);
    expect(graph.neighbors('gym').length).toBeGreaterThan(0);
    expect(rim('gym')).toEqual([]);
    expect(canStart(graph, regions, 'gym')).toBe(false);
  });

  it('refuses every word that would start alone, and no other', () => {
    for (let region = 0; region < regions.count; region++) {
      for (const word of regions.words(region)) {
        expect(canStart(graph, regions, word), word).toBe(rim(word).length > 0);
      }
    }
  });

  it('refuses words off the map and words not in the dictionary', () => {
    expect(canStart(graph, regions, 'qqqqqq')).toBe(false);
  });
});

describe('a guess', () => {
  it('reveals what it lands on and costs nothing', () => {
    const atlas = openAtlas(START);
    const next = graph.commonNeighbors(START)[0]!;
    const out = guess(atlas, graph, next);

    expect(out.refusal).toBeUndefined();
    expect(out.atlas.revealed.has(next)).toBe(true);
    expect(out.atlas.selected).toBe(next);
    expect(out.landed).toBe(next);
    expect(out.atlas.points).toBe(0);
  });

  it('is refused in a sentence, and leaves the map alone', () => {
    const atlas = openAtlas(START);
    const out = guess(atlas, graph, 'qqqqqq');
    expect(out.refusal).toBeDefined();
    expect(out.atlas).toBe(atlas);
  });
});

describe('fast travel', () => {
  it('finds somewhere already reached, and nowhere else', () => {
    const atlas = grown(4);
    const been = [...atlas.revealed.keys()].find((word) => word !== atlas.selected)!;

    expect(travelTo(atlas, been)).toBe(been);
    expect(travelTo(atlas, atlas.selected)).toBeNull();
    const unfound = graph.words.find((word) => regions.has(word) && !atlas.revealed.has(word))!;
    expect(travelTo(atlas, unfound)).toBeNull();
  });

  it('moves the cursor and nothing else', () => {
    const atlas = grown(4);
    const been = [...atlas.revealed.keys()].find((word) => word !== atlas.selected)!;
    const out = travel(atlas, been);

    expect(out.atlas.selected).toBe(been);
    expect(out.atlas.log).toBe(atlas.log);
    expect(out.atlas.revealed.size).toBe(atlas.revealed.size);
  });
});

function reach(atlas: Atlas) {
  return hopsFrom(graph, regions, new Set(atlas.revealed.keys()));
}

/** Put a word on the map without a move. */
function found(atlas: Atlas, word: string): Atlas {
  return {
    ...atlas,
    revealed: new Map(atlas.revealed).set(word, { word, via: null, move: null, order: 0 }),
  };
}

describe('missions', () => {
  it('name words that are really that far out, and never one already found', () => {
    const atlas = grown(6);
    const revealed = new Set(atlas.revealed.keys());
    const hops = reach(atlas);
    const offered = missions(hops);
    expect(offered.length).toBeGreaterThan(0);

    for (const word of offered) {
      expect(revealed.has(word)).toBe(false);
      expect(regions.has(word)).toBe(true);
      expect(hopsTo(word, revealed)).toBe(hops.get(word));
    }
    // Each at a different distance.
    expect(new Set(offered.map((word) => hops.get(word))).size).toBe(offered.length);
  });

  it('are priced live until they are taken, and at what they said afterwards', () => {
    const atlas = refresh(grown(4), reach(grown(4)));
    const far = atlas.offers[atlas.offers.length - 1]!;
    const before = reach(atlas).get(far)!;
    expect(before).toBeGreaterThan(1);

    // Revealing a neighbour of it makes it nearer.
    const closer = graph.commonNeighbors(far).find((near) => !atlas.revealed.has(near))!;
    const nearer = found(atlas, closer);
    expect(reach(nearer).get(far)).toBeLessThan(before);

    // Once taken, its price is fixed.
    const held = take(atlas, { word: far, hops: before });
    expect(held.taken).toEqual([{ word: far, hops: before }]);
    expect(take(found(held, closer), { word: 'other', hops: 1 }).taken[0]!.hops).toBe(before);
  });

  it('are taken into a fixed number of slots, and no more', () => {
    let atlas = grown(4);
    expect(atlas.slots).toBe(SLOTS);
    for (let n = 0; n < SLOTS; n++) atlas = take(atlas, { word: `far-${n}`, hops: n + 2 });
    expect(atlas.taken.length).toBe(SLOTS);

    const crowded = take(atlas, { word: 'one-too-many', hops: 9 });
    expect(crowded).toBe(atlas);

    const freed = abandon(atlas, 'far-0');
    expect(freed.taken.map((one) => one.word)).toEqual(['far-1']);
    expect(abandon(freed, 'never-taken')).toBe(freed);
  });

  it('pays what it promised, however the word was reached', () => {
    const atlas = take(grown(4), { word: 'somewhere', hops: 7 });
    const { atlas: paid, paid: mission } = collect(found(atlas, 'somewhere'));

    expect(mission?.hops).toBe(7);
    expect(paid.points).toBe(7);
    expect(paid.taken).toEqual([]);
  });

  it('pays nothing until the word is found', () => {
    const atlas = take(grown(4), { word: 'nowhere', hops: 5 });
    expect(collect(atlas).paid).toBeNull();
    expect(collect(atlas).atlas.points).toBe(0);
  });

  it('pays one at a time, so each is announced in its turn', () => {
    let atlas = take(grown(4), { word: 'one', hops: 3 });
    atlas = take(atlas, { word: 'two', hops: 4 });
    atlas = found(found(atlas, 'one'), 'two');

    const first = collect(atlas);
    expect(first.paid?.word).toBe('one');
    const second = collect(first.atlas);
    expect(second.paid?.word).toBe('two');
    expect(second.atlas.points).toBe(7);
    expect(collect(second.atlas).paid).toBeNull();
  });

  it('is topped back up when an offer is reached or taken, and held still otherwise', () => {
    const atlas = refresh(grown(4), reach(grown(4)));
    expect(atlas.offers.length).toBeGreaterThan(0);

    expect(refresh(atlas, reach(atlas))).toBe(atlas);

    const gone = found(atlas, atlas.offers[0]!);
    const again = refresh(gone, reach(gone));
    expect(again.offers).not.toContain(atlas.offers[0]);

    const held = take(atlas, { word: atlas.offers[0]!, hops: 5 });
    const after = refresh(held, reach(held));
    expect(after.offers).not.toContain(atlas.offers[0]);
    expect(after.offers.length).toBe(atlas.offers.length);
  });
});

/** An independent distance, so the assertion does not reuse `hopsFrom`. */
function hopsTo(word: string, revealed: ReadonlySet<string>): number {
  const seen = new Set(revealed);
  let frontier = [...revealed];
  for (let hops = 1; frontier.length > 0; hops++) {
    const next: string[] = [];
    for (const from of frontier) {
      for (const near of graph.commonNeighbors(from)) {
        if (seen.has(near)) continue;
        if (near === word) return hops;
        seen.add(near);
        next.push(near);
      }
    }
    frontier = next;
  }
  return Infinity;
}

/** The dev instruments must produce maps a player could have made. */
describe('walking a map', () => {
  it('makes real moves, and stops when it runs out of them', () => {
    // Seeded, so a failure is a board somebody can get back to.
    let seed = 7;
    const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

    const walked = wander(openAtlas(START), graph, PLAIN, 30, random);
    expect(walked.revealed.size).toBeGreaterThan(10);
    expect(walked.log.length).toBeGreaterThan(0);

    const reached = new Set([START, ...walked.log.map((one) => one.to)]);
    for (const word of walked.revealed.keys()) expect(reached.has(word)).toBe(true);

    for (const { from, to } of walked.log) {
      expect(graph.commonNeighbors(from)).toContain(to);
    }
  });

  it('asks for nothing it cannot have', () => {
    const tiny = wander(openAtlas(START), graph, PLAIN, 0);
    expect(tiny.revealed.size).toBe(1);
  });

  it('spreads outward from a word, its whole neighbourhood before anything further', () => {
    const near = graph.commonNeighbors(START);
    expect(near.length).toBeGreaterThan(1);

    // As many steps as START has neighbours: every one of them, all guessed from START.
    const rim = spread(openAtlas(START), graph, PLAIN, near.length, START);
    for (const word of near) expect(rim.revealed.has(word), word).toBe(true);
    for (const { from } of rim.log) expect(from).toBe(START);

    // Depth is the depth of the word a move was made from, plus one. Breadth first means the
    // depth moved from never decreases along the log.
    const further = spread(openAtlas(START), graph, PLAIN, near.length + 12, START);
    expect(further.revealed.size).toBeGreaterThan(rim.revealed.size);
    expect(further.log.some((one) => one.from !== START)).toBe(true);

    const depth = new Map([[START, 0]]);
    let out = 0;
    for (const { from, to } of further.log) {
      const here = depth.get(from);
      expect(here, `${from} was walked from before it was found`).toBeDefined();
      expect(here!, `${from} after depth ${out}`).toBeGreaterThanOrEqual(out);
      out = here!;
      if (!depth.has(to)) depth.set(to, here! + 1);
    }
    expect(out).toBeGreaterThan(0);
  });

  it('will not walk out of somewhere nobody has been', () => {
    const map = openAtlas(START);
    const away = graph.commonNeighbors(START)[0]!;
    expect(spread(map, graph, PLAIN, 20, away)).toBe(map);
  });
});

describe('powers', () => {
  it('sell a word’s length for a point, once', () => {
    const rich: Atlas = { ...grown(3), points: 4 };
    const unfound = [...rich.revealed.keys()]
      .flatMap((word) => [...graph.commonNeighbors(word)])
      .find((word) => !rich.revealed.has(word))!;

    const bought = name(rich, unfound);
    expect(bought.atlas.hints.get(unfound)).toBe(NAMED);
    expect(bought.atlas.points).toBe(4 - NAME_COST);

    const again = name(bought.atlas, unfound);
    expect(again.refusal).toBeDefined();
    expect(again.atlas.points).toBe(bought.atlas.points);
  });

  it('refuse what cannot be paid for', () => {
    const atlas = grown(3);
    const unfound = graph.commonNeighbors(atlas.selected).find((w) => !atlas.revealed.has(w))!;
    const out = name(atlas, unfound);
    expect(out.refusal).toBeDefined();
    expect(out.atlas).toBe(atlas);
  });

  // See `dropCost`.
  it('price a drop by its letters', () => {
    expect(dropCost('carts')).toBe(5);
    expect(dropCost('a')).toBe(1);
  });

  it('put a dropped word on the map, and take the points', () => {
    const rich: Atlas = { ...grown(3), points: 40 };
    const far = graph.words.find(
      (word) => regions.has(word) && !rich.revealed.has(word) && word.length === 5,
    )!;
    const out = drop(rich, graph, regions, far);

    expect(out.refusal).toBeUndefined();
    expect(out.atlas.revealed.has(far)).toBe(true);
    expect(out.atlas.points).toBe(40 - far.length);
    expect(out.atlas.revealed.get(far)?.via).toBeNull();
    expect(out.atlas.log.length).toBe(rich.log.length);
  });

  it('refuse to drop a word that is not on the map at all', () => {
    const rich: Atlas = { ...grown(3), points: 40 };
    expect(drop(rich, graph, regions, 'qqqqqq').refusal).toBeDefined();
  });
});

describe('writing a map down', () => {
  it('takes it back exactly, drops and all', () => {
    const rich: Atlas = { ...grown(6), points: 12 };
    const far = graph.words.find((word) => regions.has(word) && !rich.revealed.has(word))!;
    const withDrop = drop(rich, graph, regions, far).atlas;
    const named = name(withDrop, [...graph.commonNeighbors(withDrop.start)][0]!).atlas;

    const held = take(refresh(named, reach(named)), { word: 'somewhere', hops: 6 });
    const back = loadAtlas(saveAtlas(held))!;
    expect(back.offers).toEqual(held.offers);
    expect(back.taken).toEqual(held.taken);
    expect(back.slots).toBe(held.slots);
    expect(back.start).toBe(named.start);
    expect(back.selected).toBe(named.selected);
    expect(back.points).toBe(named.points);
    expect([...back.revealed.keys()].sort()).toEqual([...named.revealed.keys()].sort());
    expect(back.log).toEqual(named.log);
    expect([...back.hints]).toEqual([...named.hints]);
  });

  it('keeps where the player has stood, part way back along it', () => {
    const atlas = grown(4);
    const behind = walk(atlas, 'back');
    expect(behind.selected).not.toBe(atlas.selected);
    const back = loadAtlas(saveAtlas(behind))!;
    expect(back.stood).toEqual(behind.stood);
    expect(back.selected).toBe(behind.selected);
    expect(walk(back, 'next').selected).toBe(atlas.selected);
  });

  it('replays a move made from a dropped word', () => {
    const rich: Atlas = { ...openAtlas(START), points: 40 };
    const far = graph.words.find(
      (word) =>
        regions.has(word) && !rich.revealed.has(word) && graph.commonNeighbors(word).length > 0,
    )!;
    const dropped = drop(rich, graph, regions, far).atlas;
    const onward = guess(dropped, graph, graph.commonNeighbors(far)[0]!).atlas;
    expect(onward.log.length).toBe(1);

    const back = loadAtlas(saveAtlas(onward))!;
    expect(back.log.length).toBe(1);
    expect(back.revealed.has(far)).toBe(true);
    expect(back.revealed.size).toBe(onward.revealed.size);
  });

  it('is total: nonsense comes back as nothing rather than as a throw', () => {
    expect(loadAtlas(null)).toBeNull();
    expect(loadAtlas(undefined)).toBeNull();
    expect(loadAtlas({} as never)).toBeNull();
    const patched = loadAtlas({
      start: START,
      log: [{ from: 'nowhere', to: 'elsewhere', move: null, order: 'x' }] as never,
      dropped: [null, 3] as never,
      selected: 'gone',
      hints: [['x'], null] as never,
      points: -4,
      offers: [{ word: 1 }, ''] as never,
      taken: { hops: 2 } as never,
      slots: 'two' as never,
    })!;
    expect(patched.start).toBe(START);
    expect(patched.log).toEqual([]);
    expect(patched.selected).toBe(START);
    expect(patched.points).toBe(0);
    expect(patched.offers).toEqual([]);
    expect(patched.taken).toEqual([]);
    expect(patched.slots).toBe(SLOTS);
  });
});

describe('the map’s vocabulary', () => {
  it('leaves out words with nowhere to go, without leaving them out of the dictionary', () => {
    const lonely = graph.words.find(
      (word) => graph.isCommon(word) && graph.commonNeighbors(word).length === 0,
    )!;
    expect(regions.has(lonely)).toBe(false);
    expect(graph.isWord(lonely)).toBe(true);
  });

  it('puts every word it does hold in exactly one region', () => {
    const counted = new Set<string>();
    const wrong: string[] = [];
    for (let region = 0; region < regions.count; region++) {
      for (const word of regions.words(region)) {
        if (counted.has(word) || regions.of(word) !== region) wrong.push(word);
        counted.add(word);
      }
    }
    expect(wrong).toEqual([]);
    expect(counted.size).toBe(regions.size);
  });

  it('reads a file with nothing in it as a map with nothing on it', () => {
    const empty: Regions = buildRegions({ minComponent: 3, regions: [] }, graph.words);
    expect(empty.count).toBe(0);
    expect(empty.size).toBe(0);
    expect(empty.has(START)).toBe(false);
    expect(empty.of(START)).toBe(-1);
  });
});
