/**
 * Invariants of the atlas layout: no overlaps, a restored map does not move, a change reheats only
 * its own territory, and every move made has room for its subword. The last block runs on the
 * real map, which has hubs a toy never does. How it looks is e2e/atlas.spec.ts's job.
 */

import { describe, expect, it } from 'vitest';
import {
  atlasLayout,
  EVEN,
  NOTHING,
  regionPull,
  roomFor,
  type AtlasLayout,
  type Remembered,
  type Sizes,
  type Territory,
} from './atlasLayout';
import { crowded, reachOf } from './forces';
import { plateGap } from './hull';
import { clusterGraph, buildRegions, type ClusterGraph, type Regions } from './regions';
import { labelAlong, markRadius } from './sizes';
import { DOT_R } from '../components/plate/sizes';
import { openAtlas, wander } from './atlas';
import { PLAIN } from './lexicon';
import { atlasFigure, type Figure } from './plate';
import type { Point } from './types';
import { shippedData, shippedRegions } from '../test/shipped';

/** Inside a positively wound convex ring, or on its edge. */
function inside(at: Point, ring: readonly Point[]): boolean {
  if (ring.length < 3) return false;
  for (let i = 0; i < ring.length; i++) {
    const from = ring[i]!;
    const to = ring[(i + 1) % ring.length]!;
    const side = (to.x - from.x) * (at.y - from.y) - (to.y - from.y) * (at.x - from.x);
    if (side < -1e-6) return false;
  }
  return true;
}

/** A toy map: three rings of five words, one region each, joined in a chain by single edges. */
function toy(): { figure: Figure; regions: Regions } {
  const nodes: string[] = [];
  const edges: { a: string; b: string }[] = [];
  const join = (a: string, b: string) => edges.push(a < b ? { a, b } : { a: b, b: a });

  for (let clump = 0; clump < 3; clump++) {
    const ring = [0, 1, 2, 3, 4].map((i) => `w${clump}${i}`);
    nodes.push(...ring);
    for (let i = 0; i < ring.length; i++) join(ring[i]!, ring[(i + 1) % ring.length]!);
    if (clump > 0) join(`w${clump - 1}0`, `w${clump}0`);
  }
  nodes.sort();
  edges.sort((one, two) => (one.a + one.b).localeCompare(two.a + two.b));

  // Delta-encoded dictionary ids, as regions-{d}.json is.
  const dictionary = [...nodes];
  const of = (word: string) => dictionary.indexOf(word);
  const regions = buildRegions(
    {
      minComponent: 3,
      regions: [0, 1, 2].map((clump) => {
        const ids = [0, 1, 2, 3, 4].map((i) => of(`w${clump}${i}`)).sort((a, b) => a - b);
        let last = 0;
        return {
          name: `w${clump}0`,
          words: ids.map((id) => {
            const step = id - last;
            last = id;
            return step;
          }),
        };
      }),
    },
    dictionary,
  );

  return { figure: { nodes, edges }, regions };
}

function laidOut(
  clusters: ClusterGraph,
  sizes: Sizes = EVEN,
  settled: Remembered = NOTHING,
): AtlasLayout {
  const layout = atlasLayout(clusters, sizes, settled);
  layout.settle();
  return layout;
}

/** A word's position relative to its territory, as rings are. */
const local = (at: Point, one: Territory): Point => ({ x: at.x - one.at.x, y: at.y - one.at.y });

/** Words overlapping within a territory, measured with the layout's own `roomFor`. */
const clashing = (laid: AtlasLayout, sizes: Sizes) => {
  const at = laid.positions();
  return laid
    .territories()
    .flatMap((one) => [
      ...crowded(
        one.words.map((word) => ({ id: word, ...local(at.get(word)!, one) })),
        roomFor(sizes),
      ),
    ]);
};

/** Every word a rim dot except `hubs`, which are revealed at `degree`. */
const sized = (hubs: ReadonlySet<string>, degree = 120): Sizes => ({
  radius: (word) => (hubs.has(word) ? markRadius(degree) : DOT_R),
  degree: (word) => (hubs.has(word) ? degree : 1),
  revealed: (word) => hubs.has(word),
});

describe('clusterGraph', () => {
  it('puts each clump in its own territory, and the bridges between them', () => {
    const { figure, regions } = toy();
    const clusters = clusterGraph(figure, regions);

    expect(clusters.clusters).toHaveLength(3);
    for (const cluster of clusters.clusters) expect(cluster.words).toHaveLength(5);
    // A chain of three: two crossings, each of one move.
    expect(clusters.links).toHaveLength(2);
    expect(clusters.links.every((link) => link.weight === 1)).toBe(true);
  });

  it('adopts a word with no region of its own into its neighbours’', () => {
    const { figure, regions } = toy();
    // In no region, joined to one word.
    const stray = { nodes: [...figure.nodes, 'zz'], edges: [...figure.edges, { a: 'w01', b: 'zz' }] };
    const clusters = clusterGraph(stray, regions);

    expect(clusters.clusters).toHaveLength(3);
    expect(clusters.home.get('zz')).toBe(clusters.home.get('w01'));
  });

  it('gives a word joined to nothing a territory of its own, keyed apart from the real ones', () => {
    const { figure, regions } = toy();
    const alone = { nodes: [...figure.nodes, 'zz'], edges: figure.edges };
    const clusters = clusterGraph(alone, regions);

    expect(clusters.clusters).toHaveLength(4);
    const island = clusters.clusters[clusters.home.get('zz')!]!;
    expect(island.words).toEqual(['zz']);
    expect(island.region).toBeLessThan(0);
  });
});

describe('how hard a border pulls', () => {
  it('is the count of the moves that cross it', () => {
    expect(regionPull(2)).toBeCloseTo(2 * regionPull(1), 6);
    expect(regionPull(3)).toBeCloseTo(3 * regionPull(1), 6);
    expect(regionPull(0)).toBe(0);
    expect(regionPull(-3)).toBe(0);
  });

  // Capped at or below 1: a stronger spring overshoots and oscillates.
  it('rises with the crossings, and then stops', () => {
    expect(regionPull(4)).toBeGreaterThan(regionPull(1));
    expect(regionPull(500)).toBe(regionPull(100));
    expect(regionPull(500)).toBeLessThanOrEqual(1);
  });
});

describe('atlasLayout', () => {
  it('places every drawn word, and a word within its own territory', () => {
    const { figure, regions } = toy();
    const laid = laidOut(clusterGraph(figure, regions));

    expect(laid.positions().size).toBe(figure.nodes.length);
    expect(laid.territories()).toHaveLength(3);
    const at = laid.positions();
    for (const territory of laid.territories()) {
      for (const word of territory.words) {
        expect(inside(local(at.get(word)!, territory), territory.ring), word).toBe(true);
      }
    }
  });

  it('takes a remembered arrangement back without so much as a tick', () => {
    const { figure, regions } = toy();
    const clusters = clusterGraph(figure, regions);
    const first = laidOut(clusters);
    const again = atlasLayout(clusters, EVEN, first.remember());

    expect(again.moving()).toBe(false);
    expect([...again.positions()]).toEqual([...first.positions()]);
  });

  it('holds territories off each other', () => {
    const { figure, regions } = toy();
    const laid = laidOut(clusterGraph(figure, regions));
    const all = laid.territories();

    for (const [i, one] of all.entries()) {
      for (const two of all.slice(i + 1)) {
        expect(
          plateGap(one.ring, one.at, two.ring, two.at),
          `${one.region} and ${two.region}`,
        ).toBeNull();
      }
    }
  });

  it('never lets two words lie over each other', () => {
    const { figure, regions } = toy();
    // `EVEN` shows every name, the crowded case.
    expect(clashing(laidOut(clusterGraph(figure, regions)), EVEN)).toEqual([]);
  });

  // A revealed rim dot grows without arriving, and must still reheat its territory.
  it('makes room when a word already on the board grows into a hub', () => {
    const { figure, regions } = toy();
    const clusters = clusterGraph(figure, regions);
    const dots = sized(new Set());
    const first = laidOut(clusters, dots);
    expect(clashing(first, dots)).toEqual([]);

    const grown = sized(new Set(['w00']));
    const after = atlasLayout(clusters, dots, first.remember());
    after.update(clusters, grown);
    after.settle();
    expect(clashing(after, grown)).toEqual([]);

    // Other territories may move, but every word in them keeps its offset.
    const was = first.remember().offsets;
    const now = after.remember().offsets;
    for (const one of after.territories()) {
      if (one.words.includes('w00')) continue;
      for (const word of one.words) expect(now.get(word), word).toEqual(was.get(word));
    }
  });

  it('draws a new word into the territory it belongs to rather than starting it over', () => {
    const { figure, regions } = toy();
    const before = {
      nodes: figure.nodes.filter((word) => word !== 'w04'),
      edges: figure.edges.filter(({ a, b }) => a !== 'w04' && b !== 'w04'),
    };
    const first = laidOut(clusterGraph(before, regions));
    const after = atlasLayout(clusterGraph(before, regions), EVEN, first.remember());
    after.update(clusterGraph(figure, regions), EVEN);
    after.settle();

    const at = after.place('w04');
    expect(at).toBeDefined();
    const territory = after.territories().find((one) => one.region === 0)!;
    expect(inside(local(at!, territory), territory.ring)).toBe(true);
  });
});

/** Over the real map, grown with `wander` (atlas.ts). */
describe('arranged over the real map', () => {
  it('never lets two words lie over each other, however busy the word', () => {
    const { graph } = shippedData();
    const regions = shippedRegions();
    const busiest = regions
      .words(
        [...Array(regions.count).keys()].sort(
          (one, two) => regions.words(two).length - regions.words(one).length,
        )[0]!,
      )
      .slice()
      .sort((one, two) => graph.commonNeighbors(two).length - graph.commonNeighbors(one).length)[0]!;

    // Deterministic, so a red result is one somebody can reproduce.
    let seed = 1;
    const dice = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

    // One layout updated in turn, as the board runs it.
    let atlas = openAtlas(busiest);
    let laid: AtlasLayout | null = null;
    for (const step of [1, 30, 120]) {
      atlas = wander(atlas, graph, PLAIN, step, dice);
      const revealed = new Set(atlas.revealed.keys());
      const sizes: Sizes = {
        radius: (word) =>
          revealed.has(word) ? markRadius(graph.commonNeighbors(word).length) : DOT_R,
        degree: (word) => (revealed.has(word) ? graph.commonNeighbors(word).length : 1),
        revealed: (word) => revealed.has(word),
      };
      const figure = atlasFigure(graph, (word) => regions.has(word), revealed, atlas.log);
      const clusters = clusterGraph(figure, regions);
      if (laid) laid.update(clusters, sizes);
      else laid = atlasLayout(clusters, sizes);
      laid.settle();
      expect(clashing(laid, sizes), `${revealed.size} words found`).toEqual([]);
    }
  });

  /**
   * Lopsidedness is the length of the mean unit vector from a hub to its neighbours in the same
   * territory: 0 when they surround it, 1 when they are all to one side.
   */
  it('draws a word inside its own neighbourhood, however busy the word', () => {
    const { graph } = shippedData();
    const regions = shippedRegions();

    let seed = 3;
    const dice = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

    const atlas = wander(openAtlas('over'), graph, PLAIN, 400, dice);
    const revealed = new Set(atlas.revealed.keys());
    const sizes: Sizes = {
      radius: (word) =>
        revealed.has(word) ? markRadius(graph.commonNeighbors(word).length) : DOT_R,
      degree: (word) => (revealed.has(word) ? graph.commonNeighbors(word).length : 1),
      revealed: (word) => revealed.has(word),
    };
    const figure = atlasFigure(graph, (word) => regions.has(word), revealed, atlas.log);
    const clusters = clusterGraph(figure, regions);
    const laid = laidOut(clusters, sizes);
    const at = laid.positions();

    const near = new Map<string, string[]>();
    for (const { a, b } of figure.edges) {
      (near.get(a) ?? near.set(a, []).get(a)!).push(b);
      (near.get(b) ?? near.set(b, []).get(b)!).push(a);
    }

    const hubs = [...near]
      .filter(([word]) => revealed.has(word))
      .sort((one, two) => two[1].length - one[1].length)
      .slice(0, 12);

    const beside: string[] = [];
    for (const [word, others] of hubs) {
      const here = at.get(word);
      const home = clusters.home.get(word);
      if (!here || home === undefined) continue;
      const kin = others.filter((other) => clusters.home.get(other) === home);
      // Too few neighbours to surround anything.
      if (kin.length < 6) continue;
      let x = 0;
      let y = 0;
      for (const other of kin) {
        const spot = at.get(other);
        if (!spot) continue;
        const away = Math.hypot(spot.x - here.x, spot.y - here.y) || 1;
        x += (spot.x - here.x) / away / kin.length;
        y += (spot.y - here.y) / away / kin.length;
      }
      const lopsided = Math.hypot(x, y);
      // Loose, because a word beside a larger hub legitimately leans (`overs`, next to `over`).
      if (lopsided > 0.85) beside.push(`${word} (${kin.length} kin, ${lopsided.toFixed(2)})`);
    }
    expect(beside, `${revealed.size} words found`).toEqual([]);
  });

  // The subword sits at `labelAlong`, as the plate places it; it must be clear of both marks.
  it('leaves room on every move made to write its subword', () => {
    const { graph } = shippedData();
    const regions = shippedRegions();

    let seed = 7;
    const dice = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

    const atlas = wander(openAtlas('house'), graph, PLAIN, 150, dice);
    const revealed = new Set(atlas.revealed.keys());
    const sizes: Sizes = {
      radius: (word) => (revealed.has(word) ? markRadius(graph.commonNeighbors(word).length) : DOT_R),
      degree: (word) => (revealed.has(word) ? graph.commonNeighbors(word).length : 1),
      revealed: (word) => revealed.has(word),
    };
    const figure = atlasFigure(graph, (word) => regions.has(word), revealed, atlas.log);
    const laid = laidOut(clusterGraph(figure, regions), sizes);
    const at = laid.positions();
    const room = roomFor(sizes);

    const buried: string[] = [];
    for (const { from, to } of atlas.log) {
      const a = at.get(from);
      const b = at.get(to);
      if (!a || !b) continue;
      const span = Math.hypot(b.x - a.x, b.y - a.y);
      const along = labelAlong(span, reachOf(room(from)), reachOf(room(to)));
      if (along <= markRadius(sizes.degree(from)) || span - along <= markRadius(sizes.degree(to)))
        buried.push(`${from} → ${to}`);
    }
    expect(buried, `${atlas.log.length} moves made`).toEqual([]);
  });
});
