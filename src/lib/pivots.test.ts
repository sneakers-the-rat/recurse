/**
 * Which words the answers run through — a count, not an assertion.
 *
 * The instrument for the repetitiveness question: short words that fit inside hundreds of longer
 * ones pivot a large share of the bank, so a run of days keeps arriving at the same few hubs by
 * different roads. `ContainsTooFrequentWord` in select.rs is the lever, `TOO_FREQUENT` is the
 * list it bans, and this is what says whether the list is the right one — change it, rebuild,
 * read the table again. That is the same loop `survey.txt` gives the rules and
 * `e2e/boards.spec.ts` gives the layout, and like both of those the point is to be *read*: it
 * asserts only that it counted something.
 *
 * A word is counted once per puzzle if it lies on *any* shortest route through common words,
 * which is the set the board draws gilt. Measured on the common graph at par, because that is
 * the answer the puzzle advertises: over the legal graph a puzzle with a secret has a shorter
 * best route, and words at `ds + dt === par` there are detours rather than answers.
 *
 * Walked off the route DAG rather than by intersecting two distance maps. A word is on a
 * shortest route exactly when it can be reached from the source by steps that each bring it one
 * move nearer the target, so the walk touches the route words and their neighbours and nothing
 * else — tens of lookups per puzzle against the few thousand a map intersection would scan.
 *
 * Two numbers say how concentrated the bank is, and the second is the one that matters. The
 * share of route-word *slots* says how much of an average answer comes from a handful of words;
 * the share of *puzzles* touching one says how often a player meets one at all, which is what
 * actually reads as repetitive.
 */

import { describe, expect, it } from 'vitest';
import { bfs } from './graph';
import { shippedBank, shippedData } from '../test/shipped';

describe('pivot words', () => {
  it('counts the words the answers run through', { timeout: 300_000 }, () => {
    const { graph } = shippedData();
    const puzzles = shippedBank();

    // Distances to a target, kept per word: every word is an endpoint of many puzzles, so this
    // turns one search per puzzle into one per word.
    const toTarget = new Map<string, Map<string, number>>();
    const distances = (word: string) => {
      let found = toTarget.get(word);
      if (!found) {
        found = bfs(graph, word, Infinity, graph.commonNeighbors);
        toTarget.set(word, found);
      }
      return found;
    };

    /** Every word on some shortest route, or null if the pair does not measure par apart. */
    const routeWords = (source: string, target: string, par: number) => {
      const dist = distances(target);
      if (dist.get(source) !== par) return null;
      const onRoute = new Set([source]);
      let layer = [source];
      for (let left = par; left > 0; left--) {
        const next: string[] = [];
        for (const word of layer) {
          for (const near of graph.commonNeighbors(word)) {
            if (dist.get(near) !== left - 1 || onRoute.has(near)) continue;
            onRoute.add(near);
            next.push(near);
          }
        }
        layer = next;
      }
      return onRoute;
    };

    const seenIn = new Map<string, number>();
    let counted = 0;
    for (const { source, target, par } of puzzles) {
      const onRoute = routeWords(source, target, par);
      if (!onRoute) continue;
      counted += 1;
      for (const word of onRoute) seenIn.set(word, (seenIn.get(word) ?? 0) + 1);
    }

    const ranked = [...seenIn].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const lines = [
      `${counted} puzzles, ${seenIn.size} distinct words on some shortest route`,
      `rank  word              puzzles   share`,
      ...ranked
        .slice(0, 50)
        .map(
          ([word, count], i) =>
            `${String(i + 1).padStart(4)}  ${word.padEnd(16)} ${String(count).padStart(7)}  ` +
            `${((100 * count) / counted).toFixed(2)}%`,
        ),
    ];

    // A second pass for the puzzle shares, since they need the ranking the first pass produced.
    // The distance maps are all cached by now, so it costs the DAG walks again and nothing else.
    const total = [...seenIn.values()].reduce((sum, count) => sum + count, 0);
    const cuts = [10, 50, 200];
    const tops = cuts.map((n) => new Set(ranked.slice(0, n).map(([word]) => word)));
    const touching = cuts.map(() => 0);
    for (const { source, target, par } of puzzles) {
      const onRoute = routeWords(source, target, par);
      if (!onRoute) continue;
      tops.forEach((top, i) => {
        for (const word of onRoute) {
          if (top.has(word)) {
            touching[i] = (touching[i] ?? 0) + 1;
            return;
          }
        }
      });
    }
    const slots = (n: number) => ranked.slice(0, n).reduce((sum, [, count]) => sum + count, 0);
    lines.push(
      ``,
      `route-word slots in all: ${total} (${(total / counted).toFixed(1)} per puzzle)`,
      `held by the top   ${cuts.join(' / ')} words: ` +
        cuts.map((n) => `${((100 * slots(n)) / total).toFixed(1)}%`).join(' / '),
      `puzzles touching  ${cuts.join(' / ')} words: ` +
        touching.map((n) => `${((100 * n) / counted).toFixed(1)}%`).join(' / '),
    );
    console.log(lines.join('\n'));
    expect(counted).toBeGreaterThan(0);
  });
});
