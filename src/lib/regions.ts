/**
 * The map's territories: reading the builder's `regions-{d}.json` (see regions.rs), and grouping
 * the words on the board by territory (`clusterGraph`).
 *
 * A word in a component smaller than `minComponent` is absent from the file, so `has` is false
 * for it. It is still a legal guess, but no rim draws it and no mission names it.
 */

import type { Figure, PlateEdge } from './plate';

/** `regions-{d}.json`, as the builder writes it. Word ids are dictionary deltas. */
export interface RawRegions {
  minComponent: number;
  regions: { name: string; words: number[] }[];
}

export interface Regions {
  count: number;
  /** How many words are on the map in total. */
  size: number;
  /** -1 for a word not on the map. */
  of(word: string): number;
  has(word: string): boolean;
  /** Its most frequent member, already spelled. */
  name(region: number): string;
  /** Every word of a region, on the board or not. */
  words(region: number): readonly string[];
}

/** For a mode whose regions have not been fetched. */
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
    // Delta-encoded dictionary indices, as `common.json` is. See `push_deltas` in main.rs.
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
  /** Its index in `Regions`. */
  region: number;
  name: string;
  words: string[];
  /** Moves with both ends in this territory. */
  inside: PlateEdge[];
}

export interface ClusterGraph {
  clusters: Cluster[];
  /** Drawn word to position in `clusters`. */
  home: ReadonlyMap<string, number>;
  /** Moves between two clusters, counted. */
  links: { a: number; b: number; weight: number }[];
}

/**
 * Group the drawn words by territory, for `atlasLayout`.
 *
 * Regions cover every word a guess can reach (see regions.rs), so a word with no region can only
 * come from a map saved against an older word list; it is left out.
 */
export function clusterGraph(figure: Figure, regions: Regions): ClusterGraph {
  const at = new Map<number, number>();
  const clusters: Cluster[] = [];
  const claim = (region: number) => {
    const found = at.get(region);
    if (found !== undefined) return found;
    const index = clusters.length;
    at.set(region, index);
    clusters.push({ region, name: regions.name(region), words: [], inside: [] });
    return index;
  };

  const home = new Map<string, number>();
  for (const word of figure.nodes) {
    const region = regions.of(word);
    if (region < 0) continue;
    const index = claim(region);
    clusters[index]!.words.push(word);
    home.set(word, index);
  }

  const crossings = new Map<string, { a: number; b: number; weight: number }>();
  for (const edge of figure.edges) {
    const one = home.get(edge.a);
    const two = home.get(edge.b);
    if (one === undefined || two === undefined) continue;
    if (one === two) {
      clusters[one]!.inside.push(edge);
      continue;
    }
    const [a, b] = one < two ? [one, two] : [two, one];
    const key = `${a} ${b}`;
    const found = crossings.get(key);
    if (found) found.weight += 1;
    else crossings.set(key, { a, b, weight: 1 });
  }

  return { clusters, home, links: [...crossings.values()] };
}
