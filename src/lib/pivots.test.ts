/**
 * Which words the answers run through — a count, not an assertion.
 *
 * The instrument for the repetitiveness question: short words that fit inside hundreds of longer
 * ones pivot a large share of the bank, so a run of days keeps arriving at the same few hubs by
 * different roads. `ContainsTooFrequentWord` in select.rs is the lever, a mode's `tooFrequent` is the
 * list it bans, and this is what says whether the list is the right one — change it, rebuild,
 * read the table again. That is the same loop `e2e/boards.spec.ts` gives the layout, and like
 * that one the point is to be *read*: it asserts only that it counted something.
 *
 * **One mode at a time**, because a pivot is a fact about one graph: `king` being a hub of the
 * sound graph says nothing about the spelling one, and a bank of every mode measured against a
 * single graph counts nothing for the modes it does not belong to. Every mode is reported by
 * default; `RECURSE_MODE=phonemes` asks about one, which is what curating a single game wants —
 * and is much the faster of the two.
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
import { shippedBank, shippedData, shippedModes, shippedVersion } from '../test/shipped';

/** Which games to measure. One when asked for, every one otherwise. */
const wanted = shippedModes().filter(
  (one) => !process.env.RECURSE_MODE || process.env.RECURSE_MODE === one.name,
);

describe('pivot words', () => {
  /*
    **Skipped unless asked for, because this is not a test.** It asserts only that it counted
    something; what it is for is the table it prints. Left in the ordinary run it was a minute
    of the suite's ninety seconds, a screenful of output between the results, and — being the
    one thing here that reads the whole bank — the reason `npx vitest run` intermittently
    reported `[vitest-worker]: Timeout calling "onTaskUpdate"`.

    The same arrangement `e2e/boards.spec.ts` has for its contact sheet, and for the same
    reason: an instrument is run when somebody wants to read it.

        RECURSE_PIVOTS=1 npx vitest run src/lib/pivots.test.ts
        RECURSE_PIVOTS=1 RECURSE_MODE=phonemes npx vitest run src/lib/pivots.test.ts
  */
  it.skipIf(!process.env.RECURSE_PIVOTS).each(wanted)(
    'counts the words $name answers run through',
    { timeout: 900_000 },
    (only) => {
    const { graph, lexicon } = shippedData(only.band);
    const puzzles = shippedBank(only.mode);

    /*
      Grouped by target, one distance map alive at a time.

      Every word is the target of many puzzles, so a search per puzzle is waste — but *keeping*
      a search per word is worse. Cached, this held one map of every word for every word that
      is ever a target: on a bank of nine hundred thousand over sixteen thousand words that is
      a quarter of a billion entries, and the run died on the heap rather than finishing.
      Grouping costs the same searches and holds one of them.
    */
    const byTarget = new Map<string, typeof puzzles>();
    for (const puzzle of puzzles) {
      const had = byTarget.get(puzzle.target);
      if (had) had.push(puzzle);
      else byTarget.set(puzzle.target, [puzzle]);
    }

    /**
     * Walk every group, handing each puzzle the words on its shortest routes.
     *
     * Run twice — once to count and once to measure the shares, which needs the ranking the
     * first pass produced. The second run costs the searches again and nothing else, which is
     * the trade for not keeping nine hundred thousand sets of words alive between them.
     */
    const eachAnswer = (visit: (onRoute: Set<string>) => void) => {
      let seen = 0;
      for (const [target, group] of byTarget) {
        const dist = bfs(graph, target, Infinity, graph.commonNeighbors);
        for (const puzzle of group) {
          const onRoute = routeWords(dist, puzzle.source, puzzle.par);
          if (!onRoute) continue;
          seen += 1;
          visit(onRoute);
        }
      }
      return seen;
    };

    /** Every word on some shortest route, or null if the pair does not measure par apart. */
    const routeWords = (dist: Map<string, number>, source: string, par: number) => {
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
    const counted = eachAnswer((onRoute) => {
      for (const word of onRoute) seenIn.set(word, (seenIn.get(word) ?? 0) + 1);
    });

    // A hub is a *token*, and the list is a list to read: written out the way the board draws
    // it, with how it is said where that is not the same thing. A column of phoneme codes
    // would be a table nobody can act on, and acting on it is the entire point.
    const say = (token: string) =>
      lexicon.translated ? `${lexicon.label(token)} /${lexicon.transcribe(token)}/` : token;

    const ranked = [...seenIn].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    // **Which bank this is.** These figures come from `public/data`, and a build is not the
    // only thing that writes a bank — an inspection command can leave a *cached* one newer than
    // the shipped files, and then this reads the old one and prints the same table run after
    // run while the rules plainly changed. Naming the version makes that visible instead of
    // baffling: two runs with one version between them measured one bank.
    const bank = shippedVersion();
    const lines = [
      `=== ${only.name} === bank ${bank.version}, ${bank.puzzles} puzzles in public/data`,
      `${counted} puzzles, ${seenIn.size} distinct words on some shortest route`,
      `rank  word                              puzzles   share`,
      ...ranked
        .slice(0, 50)
        .map(
          ([word, count], i) =>
            `${String(i + 1).padStart(4)}  ${say(word).padEnd(32)} ${String(count).padStart(7)}  ` +
            `${((100 * count) / counted).toFixed(2)}%`,
        ),
    ];

    // A second pass for the puzzle shares, since they need the ranking the first pass produced.
    const total = [...seenIn.values()].reduce((sum, count) => sum + count, 0);
    const cuts = [10, 50, 200];
    const tops = cuts.map((n) => new Set(ranked.slice(0, n).map(([word]) => word)));
    const touching = cuts.map(() => 0);
    eachAnswer((onRoute) => {
      tops.forEach((top, i) => {
        for (const word of onRoute) {
          if (top.has(word)) {
            touching[i] = (touching[i] ?? 0) + 1;
            return;
          }
        }
      });
    });
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
