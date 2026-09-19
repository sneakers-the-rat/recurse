/**
 * What the atlas's layout has to be true of, whatever it looks like.
 *
 * Four promises, and they are the ones the two-scale arrangement exists to keep: **nothing drawn
 * lies over anything else drawn**, a territory stays where it was put, a guess disturbs its own
 * neighbourhood and nothing else, and the map comes out a size that can be looked at. None of
 * them is about taste — where a particular word ends up is the contact sheet's question, not
 * this file's.
 *
 * The first is also checked over the **real map**, at the bottom, because a toy of fifteen words
 * never meets the case that matters: one word with a hundred and eighty moves, drawn two hundred
 * units across, in a territory of two hundred words that have to pack around it.
 */

import { describe, expect, it } from 'vitest';
import { arrange, EVEN, NOTHING, remember, roomFor, type Arrangement, type Sizes } from './atlasLayout';
import { crowded } from './forces';
import { clusterGraph, buildRegions, type Regions } from './regions';
import { markRadius } from './sizes';
import { DOT_R } from '../components/plate/sizes';
import { openAtlas, wander } from './atlas';
import { PLAIN } from './lexicon';
import { atlasFigure, type Figure } from './plate';
import { shippedData, shippedRegions } from '../test/shipped';

/**
 * A toy map: three clumps of five, each a ring, joined in a chain by one edge apiece.
 *
 * Small enough to reason about and shaped like the real thing — dense inside, one bridge out —
 * which is the case every promise below is about.
 */
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

  // One region per clump, named after its first word. Written as the file would be: ids into
  // a dictionary, delta encoded.
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

/**
 * **Nothing drawn lies over anything else drawn, names included, and this is the promise.**
 *
 * Asked of the *layout* rather than modelled here: `roomFor` is what the arrangement holds
 * apart, so a test that wrote its own idea of how much room a word takes would be testing two
 * guesses against each other. Within a territory, because that is the scale this promise is
 * made at — territories are held off one another by their own collider, which is a force and
 * allowed to be still resolving when a run ends.
 */
const clashing = (laid: Arrangement, sizes: Sizes) =>
  laid.territories.flatMap((one) => [
    ...crowded(
      one.words.map((word) => ({ id: word, ...laid.positions.get(word)! })),
      roomFor(sizes),
    ),
  ]);

/** Every word a rim dot except the ones named, which are hubs with names on them. */
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
    expect(clusters.across).toHaveLength(2);
  });

  it('adopts a word with no region of its own into its neighbours’', () => {
    const { figure, regions } = toy();
    // A legal-but-uncommon word the player guessed: in nobody's region, hanging off one word.
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

describe('arrange', () => {
  it('places every drawn word, and a word within its own territory', () => {
    const { figure, regions } = toy();
    const clusters = clusterGraph(figure, regions);
    const laid = arrange(clusters, EVEN, NOTHING);

    expect(laid.positions.size).toBe(figure.nodes.length);
    expect(laid.territories).toHaveLength(3);
    for (const territory of laid.territories) {
      for (const word of territory.words) {
        const at = laid.positions.get(word)!;
        const away = Math.hypot(at.x - territory.at.x, at.y - territory.at.y);
        expect(away).toBeLessThanOrEqual(territory.radius);
      }
    }
  });

  /**
   * The promise the whole design is for. A player learns where things are; a guess that does
   * not touch a territory must not move it, or the map they learnt is gone.
   */
  it('leaves every territory exactly where it was when nothing has arrived', () => {
    const { figure, regions } = toy();
    const clusters = clusterGraph(figure, regions);
    const first = arrange(clusters, EVEN, NOTHING);
    const again = arrange(clusters, EVEN, remember(first));

    for (const territory of again.territories) {
      const was = first.territories.find((one) => one.region === territory.region)!;
      expect(territory.at.x).toBeCloseTo(was.at.x, 6);
      expect(territory.at.y).toBeCloseTo(was.at.y, 6);
    }
    // And the words of the two territories nobody disturbed are where they were, to the unit.
    for (const territory of again.territories) {
      if (territory.region === 0) continue;
      for (const word of territory.words) {
        expect(again.positions.get(word)).toEqual(first.positions.get(word));
      }
    }
  });

  it('takes a remembered arrangement back unchanged when nothing has arrived', () => {
    const { figure, regions } = toy();
    const clusters = clusterGraph(figure, regions);
    const first = arrange(clusters, EVEN, NOTHING);
    const again = arrange(clusters, EVEN, remember(first));

    expect([...again.positions]).toEqual([...first.positions]);
  });

  /**
   * Territories are places, and two places that overlap are one. The collider is what makes
   * this true and the link distance is what keeps it affordable — see the note on
   * `REGION_HOME` for what happens when a repulsion is added to them.
   */
  it('holds territories off each other', () => {
    const { figure, regions } = toy();
    const clusters = clusterGraph(figure, regions);
    const laid = arrange(clusters, EVEN, NOTHING);

    for (const [i, one] of laid.territories.entries()) {
      for (const two of laid.territories.slice(i + 1)) {
        const away = Math.hypot(one.at.x - two.at.x, one.at.y - two.at.y);
        // Eight tenths rather than the sum, because a collider is a force and not a wall: it
        // is allowed to be still resolving a little overlap when the run ends.
        expect(away).toBeGreaterThan((one.radius + two.radius) * 0.8);
      }
    }
  });

  it('never lets two words lie over each other', () => {
    const { figure, regions } = toy();
    const clusters = clusterGraph(figure, regions);
    // Every word showing a name, which is the crowded case: five labels round a ring of five.
    expect(clashing(arrange(clusters, EVEN, NOTHING), EVEN)).toEqual([]);
  });

  /**
   * **A word already on the board can grow**, and that was the case this got wrong.
   *
   * Guessing a rim dot turns four units of ink into a mark that can be a hundred across with a
   * name on it. It is not *arriving* — it has had a place since it was a dot — so a warm pass
   * pinned the crowd that had to make room for it, and if its whole rim fell in other regions
   * this one counted as quiet and was never touched at all. Either way the hub was drawn over
   * its own neighbourhood for good.
   */
  it('makes room when a word already on the board grows into a hub', () => {
    const { figure, regions } = toy();
    const clusters = clusterGraph(figure, regions);
    const dots = sized(new Set());
    const first = arrange(clusters, dots, NOTHING);
    expect(clashing(first, dots)).toEqual([]);

    // Nothing has arrived. One word is now a hub, and its own territory has to open up for it.
    const grown = sized(new Set(['w00']));
    const after = arrange(clusters, grown, remember(first));
    expect(clashing(after, grown)).toEqual([]);

    /*
      And only its own territory was rearranged. The others are *shoved* — a territory that has
      ballooned has to be made room for, and their centres move — but not re-solved: every word
      in them is where it was relative to its own territory, which is the thing a player learnt
      and the whole reason the arrangement is kept as offsets. See `remember`.
    */
    for (const one of after.territories) {
      if (one.words.includes('w00')) continue;
      const was = first.territories.find((two) => two.region === one.region)!;
      for (const word of one.words) {
        const now = after.positions.get(word)!;
        const then = first.positions.get(word)!;
        expect(now.x - one.at.x).toBeCloseTo(then.x - was.at.x, 6);
        expect(now.y - one.at.y).toBeCloseTo(then.y - was.at.y, 6);
      }
    }
  });

  it('draws a new word into the territory it belongs to rather than starting it over', () => {
    const { figure, regions } = toy();
    const before = {
      nodes: figure.nodes.filter((word) => word !== 'w04'),
      edges: figure.edges.filter(({ a, b }) => a !== 'w04' && b !== 'w04'),
    };
    const first = arrange(clusterGraph(before, regions), EVEN, NOTHING);
    const after = arrange(clusterGraph(figure, regions), EVEN, remember(first));

    expect(after.positions.has('w04')).toBe(true);
    const territory = after.territories.find((one) => one.region === 0)!;
    const at = after.positions.get('w04')!;
    expect(Math.hypot(at.x - territory.at.x, at.y - territory.at.y)).toBeLessThanOrEqual(
      territory.radius,
    );
  });
});

/**
 * And the same promise over the real map, which is the only place the hard case exists.
 *
 * A toy region is five words the same size. The real one has a word with a hundred and eighty
 * moves, drawn two hundred units across with its name inside it, sitting in a territory of two
 * hundred words that have to find room around it — and the arrangement is *incremental*, so what
 * has to hold is not one pass but every pass of a map being played.
 *
 * Grown with `wander`, so the map is one somebody could have played: the same `guess` a typed
 * word goes through. See atlas.ts.
 */
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

    let atlas = openAtlas(busiest);
    let settled = NOTHING;
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
      const laid = arrange(clusterGraph(figure, regions), sizes, settled);
      settled = remember(laid);
      expect(clashing(laid, sizes), `${revealed.size} words found`).toEqual([]);
    }
  });
});
