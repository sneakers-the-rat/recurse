/**
 * Prints what arranging and reopening a large map costs, and how many words the collider leaves
 * overlapping. An instrument like pivots.test.ts; it asserts almost nothing.
 *
 *     RECURSE_ARRANGE=1 npx vitest run --project=unit src/lib/arrangeCost.test.ts
 */

import { describe, expect, it } from 'vitest';
import { shippedMap } from '../test/shipped';
import { openAtlas, spread } from './atlas';
import { atlasFigure } from './plate';
import { atlasLayout, roomFor, type Sizes } from './atlasLayout';
import { clusterGraph } from './regions';
import { crowded } from './forces';
import { markRadius } from './sizes';
import { DOT_R } from '../components/plate/sizes';

const RUN = process.env.RECURSE_ARRANGE === '1';

describe.skipIf(!RUN)('opening a saved map', () => {
  it('says what a pass over a settled arrangement costs', { timeout: 600_000 }, () => {
    const { graph, lexicon, regions } = shippedMap('letters');

    // A declaration, because the eslint parser reads `<T>` on an arrow as JSX.
    function took<T>(what: string, run: () => T): T {
      const began = performance.now();
      const out = run();
      console.log(`  ${(performance.now() - began).toFixed(0).padStart(6)}ms  ${what}`);
      return out;
    }

    const start = 'over';
    let atlas = openAtlas(start);
    atlas = took('2000 guesses', () => spread(atlas, graph, lexicon, 2000, start));
    const revealed = new Set(atlas.revealed.keys());
    console.log(`  map: ${revealed.size} revealed`);

    const figure = took('atlasFigure', () =>
      atlasFigure(
        graph,
        (word) => regions.has(word),
        revealed,
        atlas.log.map(({ from, to }) => ({ from, to })),
      ),
    );
    console.log(`  figure: ${figure.nodes.length} nodes, ${figure.edges.length} moves`);

    const sizes: Sizes = {
      radius: (word) =>
        revealed.has(word) ? markRadius(graph.commonNeighbors(word).length) : DOT_R,
      degree: (word) => (revealed.has(word) ? graph.commonNeighbors(word).length : 1),
      revealed: (word) => revealed.has(word),
    };
    const room = roomFor(sizes);

    const clusters = took('clusterGraph', () => clusterGraph(figure, regions));
    const first = took('arranging from nothing', () => {
      const one = atlasLayout(clusters, sizes);
      one.settle();
      return one;
    });

    /** Overlapping words per territory, in its own coordinates. */
    const leftOver = (laid: ReturnType<typeof atlasLayout>) => {
      const at = laid.positions();
      let words = 0;
      let places = 0;
      const worst: { name: string; over: number; size: number; hub: number }[] = [];
      for (const one of laid.territories()) {
        const over = crowded(
          one.words.map((word) => ({
            id: word,
            x: at.get(word)!.x - one.at.x,
            y: at.get(word)!.y - one.at.y,
          })),
          room,
        );
        if (over.size === 0) continue;
        places += 1;
        words += over.size;
        worst.push({
          name: one.words[0] ?? '?',
          over: over.size,
          size: one.words.length,
          hub: Math.max(...one.words.map((word) => sizes.degree(word))),
        });
      }
      return { words, places, worst: worst.sort((a, b) => b.over - a.over) };
    };

    const settled = first.remember();
    const after = leftOver(first);
    console.log(
      `  settled: ${after.words} words lying over another, in ${after.places} of ${clusters.clusters.length} territories`,
    );
    for (const one of after.worst.slice(0, 5)) {
      console.log(
        `        ${String(one.over).padStart(4)} over, in a territory of ${one.size} whose busiest word has ${one.hub} moves`,
      );
    }

    // Reopened from saved offsets, nothing should be hot.
    const again = took('opening it again from what was written down', () => {
      const one = atlasLayout(clusters, sizes, settled);
      one.settle();
      return one;
    });
    console.log(`  reopened moving: ${again.moving()}`);
    expect(again.positions().size).toBe(first.positions().size);

    const biggest = clusters.clusters
      .slice()
      .sort((one, two) => two.words.length - one.words.length)[0]!;
    console.log(
      `  biggest territory: ${biggest.words.length} words of ${clusters.clusters.length} territories`,
    );
  });
});
