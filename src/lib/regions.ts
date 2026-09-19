/**
 * The map's territories, as the client asks about them.
 *
 * The builder carves each mode's common graph into regions once — see regions.rs — and this
 * is the other end of that file. It answers three questions and nothing else: which territory
 * a word is in, what that territory is called, and whether a word is on the map at all.
 *
 * **Being on the map is the vocabulary of the explore mode.** A word in a component too small
 * to explore is absent from the file, so `has` is false for it: it is still a perfectly legal
 * guess and still in the dictionary, but no rim draws it and no mission will ever name it.
 *
 * The regions are a *partition of the graph*, not of what has been drawn. Which of them are on
 * screen at any moment is `clusterGraph`'s question, and it is a different one — a region with
 * one word revealed is on the board, and the other three hundred words of it are not.
 */

import type { Figure, PlateEdge } from './plate';

/** `regions-{d}.json`, as the builder writes it. Word ids are dictionary deltas. */
export interface RawRegions {
  minComponent: number;
  regions: { name: string; words: number[] }[];
}

export interface Regions {
  /** How many territories the map has. */
  count: number;
  /** How many words are on it, all told: what "reveal everything" would mean. */
  size: number;
  /** Which region this word is in, or -1 for a word the map leaves out. */
  of(word: string): number;
  /** Is this word part of the map? */
  has(word: string): boolean;
  /** What a region is called: its best-known member, already spelled. */
  name(region: number): string;
  /** Every word of a region, on the board or not. */
  words(region: number): readonly string[];
}

/** No map at all, for a mode whose regions have not been fetched. Nothing is on it. */
export const NOWHERE: Regions = {
  count: 0,
  size: 0,
  of: () => -1,
  has: () => false,
  name: () => '',
  words: () => [],
};

export function buildRegions(raw: RawRegions, dictionary: readonly string[]): Regions {
  const names: string[] = [];
  const members: string[][] = [];
  const of = new Map<string, number>();

  for (const region of raw.regions) {
    const index = names.length;
    names.push(region.name);
    const words: string[] = [];
    // Delta-encoded, ascending, the same as `common.json` — see `push_deltas` in the builder.
    let at = 0;
    for (const step of region.words) {
      at += step;
      const word = dictionary[at];
      if (word === undefined) continue;
      words.push(word);
      of.set(word, index);
    }
    members.push(words);
  }

  return {
    count: names.length,
    size: of.size,
    of: (word) => of.get(word) ?? -1,
    has: (word) => of.has(word),
    name: (region) => names[region] ?? '',
    words: (region) => members[region] ?? [],
  };
}

/** One territory, as much of it as is on the board. */
export interface Cluster {
  /** Its index in `Regions`, or a negative number for a huddle with no region of its own. */
  region: number;
  name: string;
  words: string[];
  /** Moves with both ends in this territory: what its own layout arranges. */
  inside: PlateEdge[];
}

export interface ClusterGraph {
  clusters: Cluster[];
  /** Where each region sits in `clusters`. */
  at: ReadonlyMap<number, number>;
  /** Which cluster each drawn word belongs to, by position in `clusters`. */
  home: ReadonlyMap<string, number>;
  /** Moves between two territories, and how many of them there are. */
  links: { a: number; b: number; weight: number }[];
  /**
   * Those moves themselves, still as words.
   *
   * The aggregate above is what the global layout needs — how firmly two territories are tied
   * — and this is what a local one needs: *which* of its words is the one facing out. See the
   * outward pull in atlasLayout.
   */
  across: PlateEdge[];
}

/**
 * The board, seen as territories rather than as words.
 *
 * This is the whole of what makes the atlas's layout affordable: the global arrangement works
 * over tens of clusters and never sees a word, and each local arrangement works over one
 * territory's words and never sees another territory. Neither ever holds the whole board.
 *
 * **A word with no region of its own joins its neighbours'.** Two kinds of word have none: one
 * the player guessed that is legal but not common, and one in a component too small to be on
 * the map, which a spent point can drop them into. Left to themselves they would each be a
 * cluster of one and the global layout would spend its effort keeping a hundred motes apart.
 * So they are handed to whichever territory most of their drawn neighbours are in, twice over
 * so that a chain of them settles; a word with no regioned neighbour at all is a genuine
 * island and does get a cluster to itself, keyed negatively so it cannot collide with a real
 * region.
 */
export function clusterGraph(figure: Figure, regions: Regions): ClusterGraph {
  const near = new Map<string, string[]>();
  for (const { a, b } of figure.edges) {
    (near.get(a) ?? near.set(a, []).get(a)!).push(b);
    (near.get(b) ?? near.set(b, []).get(b)!).push(a);
  }

  const owner = new Map<string, number>();
  const stray: string[] = [];
  for (const word of figure.nodes) {
    const region = regions.of(word);
    if (region >= 0) owner.set(word, region);
    else stray.push(word);
  }

  // Twice, so a word joined only to another stray can still be adopted on the second pass.
  for (let pass = 0; pass < 2 && stray.length > 0; pass++) {
    for (const word of stray) {
      if (owner.has(word)) continue;
      const votes = new Map<number, number>();
      for (const other of near.get(word) ?? []) {
        const region = owner.get(other);
        if (region === undefined) continue;
        votes.set(region, (votes.get(region) ?? 0) + 1);
      }
      let best = -1;
      let most = 0;
      // Ties go to the lower region, so which one adopts a word does not depend on the order
      // its edges happened to be built in.
      for (const [region, count] of [...votes].sort((one, two) => one[0] - two[0])) {
        if (count > most) {
          most = count;
          best = region;
        }
      }
      if (best >= 0) owner.set(word, best);
    }
  }

  // Anything still homeless is an island of its own, negatively keyed.
  let island = -1;
  for (const word of stray) {
    if (!owner.has(word)) owner.set(word, island--);
  }

  const at = new Map<number, number>();
  const clusters: Cluster[] = [];
  const claim = (region: number) => {
    const found = at.get(region);
    if (found !== undefined) return found;
    const index = clusters.length;
    at.set(region, index);
    clusters.push({
      region,
      name: region >= 0 ? regions.name(region) : '',
      words: [],
      inside: [],
    });
    return index;
  };

  const home = new Map<string, number>();
  for (const word of figure.nodes) {
    const index = claim(owner.get(word) ?? -1);
    clusters[index]!.words.push(word);
    home.set(word, index);
  }

  const crossings = new Map<string, { a: number; b: number; weight: number }>();
  const across: PlateEdge[] = [];
  for (const edge of figure.edges) {
    const one = home.get(edge.a);
    const two = home.get(edge.b);
    if (one === undefined || two === undefined) continue;
    if (one === two) {
      clusters[one]!.inside.push(edge);
      continue;
    }
    across.push(edge);
    const [a, b] = one < two ? [one, two] : [two, one];
    const key = `${a} ${b}`;
    const found = crossings.get(key);
    if (found) found.weight += 1;
    else crossings.set(key, { a, b, weight: 1 });
  }

  return { clusters, at, home, links: [...crossings.values()], across };
}
