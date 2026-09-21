/**
 * What a map has to be true of.
 *
 * Two halves. The first is the economy — what a mission promises, what a power costs, what
 * spending does — and it is the part with rules in it. The second is that a map survives being
 * written down, which is the same promise `restore` makes about a round and matters more here:
 * a daily board is lost for a day and a map is lost for good.
 */

import { describe, expect, it } from 'vitest';
import {
  abandon,
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
  travelTo,
  wander,
  type Atlas,
} from './atlas';
import { PLAIN } from './lexicon';
import { buildRegions, type Regions } from './regions';
import { shippedData, shippedRegions } from '../test/shipped';
import type { Graph } from './types';

/** The real letters graph and the real map, because both are what a map is played on. */
const data = shippedData();
const regions = shippedRegions();
const graph: Graph = data.graph;

/** Somewhere with room to move: the first word of the biggest territory. */
const biggest = [...Array(regions.count).keys()].sort(
  (one, two) => regions.words(two).length - regions.words(one).length,
)[0]!;
const START = regions.words(biggest)[0]!;

/** Walk `steps` moves out from a fresh map, so a test has a map with something on it. */
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

describe('a guess', () => {
  it('reveals what it lands on and costs nothing', () => {
    const atlas = openAtlas(START);
    const next = graph.commonNeighbors(START)[0]!;
    const out = guess(atlas, graph, next);

    expect(out.refusal).toBeUndefined();
    expect(out.atlas.revealed.has(next)).toBe(true);
    expect(out.atlas.selected).toBe(next);
    expect(out.landed).toBe(next);
    // A map has no score to keep, so there is nothing for a guess to have cost.
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
    // Where you already are is not travel.
    expect(travelTo(atlas, atlas.selected)).toBeNull();
    // Nor is a word that is on the graph but not on this map.
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

/** How far out everything is from where a map has got to, which is what an offer is priced at. */
function reach(atlas: Atlas) {
  return hopsFrom(graph, regions, new Set(atlas.revealed.keys()));
}

/** Put a word on the map without walking to it, for a test that only cares that it is there. */
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
    // Each a different length of journey, so the choice is a choice.
    expect(new Set(offered.map((word) => hops.get(word))).size).toBe(offered.length);
  });

  it('are priced live until they are taken, and at what they said afterwards', () => {
    const atlas = refresh(grown(4), reach(grown(4)));
    const far = atlas.offers[atlas.offers.length - 1]!;
    const before = reach(atlas).get(far)!;
    expect(before).toBeGreaterThan(1);

    // A step toward it: stand on whatever is next to it and reveal that. The offer is worth
    // less than it was, because the offer is only ever worth what it is worth now.
    const closer = graph.commonNeighbors(far).find((near) => !atlas.revealed.has(near))!;
    const nearer = found(atlas, closer);
    expect(reach(nearer).get(far)).toBeLessThan(before);

    // Taken, it stops moving: that is the whole of what a slot buys.
    const held = take(atlas, { word: far, hops: before });
    expect(held.taken).toEqual([{ word: far, hops: before }]);
    expect(take(found(held, closer), { word: 'other', hops: 1 }).taken[0]!.hops).toBe(before);
  });

  it('are taken into a fixed number of slots, and no more', () => {
    let atlas = grown(4);
    expect(atlas.slots).toBe(SLOTS);
    for (let n = 0; n < SLOTS; n++) atlas = take(atlas, { word: `far-${n}`, hops: n + 2 });
    expect(atlas.taken.length).toBe(SLOTS);

    // Every slot full: the next is refused outright rather than pushing one out.
    const crowded = take(atlas, { word: 'one-too-many', hops: 9 });
    expect(crowded).toBe(atlas);

    // And given up one at a time, each freeing its own slot.
    const freed = abandon(atlas, 'far-0');
    expect(freed.taken.map((one) => one.word)).toEqual(['far-1']);
    expect(abandon(freed, 'never-taken')).toBe(freed);
  });

  it('pays what it promised, however the word was reached', () => {
    const atlas = take(grown(4), { word: 'somewhere', hops: 7 });
    // Reached by some other road entirely, which is exactly the case re-measuring would
    // underpay: the player found more of the map on the way and the mission is still done.
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

    // Untouched while every offer is still out there, which is what lets a price fall without
    // the table reshuffling under it.
    expect(refresh(atlas, reach(atlas))).toBe(atlas);

    const gone = found(atlas, atlas.offers[0]!);
    const again = refresh(gone, reach(gone));
    expect(again.offers).not.toContain(atlas.offers[0]);

    // One taken into a slot is no longer something to choose, and its place is filled.
    const held = take(atlas, { word: atlas.offers[0]!, hops: 5 });
    const after = refresh(held, reach(held));
    expect(after.offers).not.toContain(atlas.offers[0]);
    expect(after.offers.length).toBe(atlas.offers.length);
  });
});

/** The distance this test measures for itself, so the assertion is not the code again. */
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

/**
 * The instrument, held to the one promise that makes it useful: what it leaves behind is a map
 * somebody could have played. A walk that put words on the board without moves under them would
 * be a picture of a map, and every layout decision taken by looking at one would be taken
 * against a board the game cannot produce.
 */
describe('walking a map', () => {
  it('makes real moves, and stops when it runs out of them', () => {
    // Seeded, so a failure is a board somebody can get back to.
    let seed = 7;
    const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

    const walked = wander(openAtlas(START), graph, PLAIN, 30, random);
    expect(walked.revealed.size).toBeGreaterThan(10);
    expect(walked.log.length).toBeGreaterThan(0);

    // Every word on it was either the start or the far end of a move that was made.
    const reached = new Set([START, ...walked.log.map((one) => one.to)]);
    for (const word of walked.revealed.keys()) expect(reached.has(word)).toBe(true);

    // And every move joins two words the graph really joins.
    for (const { from, to } of walked.log) {
      expect(graph.commonNeighbors(from)).toContain(to);
    }
  });

  it('asks for nothing it cannot have', () => {
    const tiny = wander(openAtlas(START), graph, PLAIN, 0);
    expect(tiny.revealed.size).toBe(1);
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

    // Nothing more to sell about it.
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

  /**
   * The price is the letter count and not the distance, and this is the reason: the button
   * says the price before anything is spent, so a price that was the distance would answer
   * the question a mission exists to ask.
   */
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
    // Nothing was walked to get here, so there is no move to remember.
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

  it('replays a move made from a dropped word', () => {
    const rich: Atlas = { ...openAtlas(START), points: 40 };
    const far = graph.words.find(
      (word) =>
        regions.has(word) && !rich.revealed.has(word) && graph.commonNeighbors(word).length > 0,
    )!;
    const dropped = drop(rich, graph, regions, far).atlas;
    const onward = guess(dropped, graph, graph.commonNeighbors(far)[0]!).atlas;
    expect(onward.log.length).toBe(1);

    // The move starts at a word no move explains, so the drop has to go on first.
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
    // A map that says nothing sensible about slots still has the ones every map has.
    expect(patched.slots).toBe(SLOTS);
  });
});

describe('the map’s vocabulary', () => {
  /**
   * The component filter, from the client's side. A word with no moves is still a perfectly
   * good guess and still in the dictionary — it is simply not somewhere to explore.
   */
  it('leaves out words with nowhere to go, without leaving them out of the dictionary', () => {
    const lonely = graph.words.find(
      (word) => graph.isCommon(word) && graph.commonNeighbors(word).length === 0,
    )!;
    expect(regions.has(lonely)).toBe(false);
    expect(graph.isWord(lonely)).toBe(true);
  });

  it('puts every word it does hold in exactly one region', () => {
    const counted = new Set<string>();
    for (let region = 0; region < regions.count; region++) {
      for (const word of regions.words(region)) {
        expect(counted.has(word)).toBe(false);
        counted.add(word);
        expect(regions.of(word)).toBe(region);
      }
    }
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
