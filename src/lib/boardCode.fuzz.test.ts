/**
 * The fuzz, which is the slow half of what boardCode.test.ts promises.
 *
 * Its own file because it is its own kind of test. Everything in boardCode.test.ts asks a
 * fixed question of a fixed board and answers in a millisecond; this walks real boards of both
 * games with a simulated player and is measured in seconds — and at `RECURSE_FUZZ=200`, which
 * is what to do after touching the format, in tens of them. Kept together, the only way to give
 * the sweep the time it needs was to give it to every test in the suite, and a global timeout
 * raised to suit the slowest test is a timeout that has stopped catching anything.
 *
 * So the group is the seam: `*.fuzz.test.ts` is a vitest project of its own with a timeout of
 * its own — see `test.projects` in vite.config.ts. `npm test` still runs it.
 */

import { describe, expect, it } from "vitest";
import { shippedData, shippedModes, shippedShard } from "../test/shipped";
import { FLAVOURS, playRound, reading, SHAPES } from "../test/rounds";
import { actionsOf, COMMANDS, KINDS } from "./actions";
import { pathFor, stateFromPath } from "./route";
import { decodeBoard, encodeBoard } from "./boardCode";
import { restore, snapshot } from "./game";

/**
 * The fuzz: whatever anybody can do to a board, done, and then put through a URL and back.
 *
 * **Every board is walked by the vocabulary itself.** `src/test/rounds.ts` draws commands from
 * `offers` — the game's own account of what could be done next, of each kind there is — and
 * does them with `act`, so a round here is a round somebody could have played and nothing about
 * what is legal or what a guess lands on is written down twice. A command kind added to
 * lib/actions.ts arrives in this test whether or not anybody remembers to come and add it,
 * which is what the coverage claims below are for.
 *
 * **Both games**, because one operation only exists in a translated alphabet: a spelling that
 * names two pronunciations is one guess and two moves, and the letters game cannot produce one.
 *
 * Three claims, in the order they would break:
 *
 *   1. **A code loses nothing a player can see.** A round restored through a code is the same
 *      board as the same round restored from storage — every move in order, every grouping into
 *      guesses, both tallies, the marks, the cursor, whether it was finished, and a hint level
 *      for every word still unnamed. The one thing it does not carry is the level of a word the
 *      round went on to *name*, which the figure spells out in full and shows no hint for; that
 *      goes out as a total, so the score stays exact. See `reading` for where the line is drawn
 *      and `written` in boardCode.ts for why.
 *   2. **A code is the same code.** Encoding what came back gives the identical characters, so
 *      the round trip is settled rather than merely close: nothing drifts on the second pass.
 *   3. **A code is a URL.** It survives `pathFor` and `stateFromPath` untouched, which is where
 *      it actually has to survive.
 *
 * A failure prints the board, the shape and the seed, which is everything needed to get the
 * round back — and the command list with it, so it can be read.
 */
describe("a round of any shape, through a code and back", () => {
  /**
   * How much of the bank to walk. A handful of boards of each game by default, because this
   * runs in the ordinary suite; `RECURSE_FUZZ=n` widens it to n boards apiece for a real
   * sweep, which is what to do after touching the format.
   */
  const BOARDS = Number(process.env.RECURSE_FUZZ ?? 6);
  const SEEDS = Number(process.env.RECURSE_FUZZ ? 8 : 3);

  /** The games, with a band of each: a phonemes board is where `also` comes from. */
  const games = shippedModes();

  /** Every kind of command has a flavour that draws it, or the fuzz has a hole in it. */
  it("draws on every command the game offers", () => {
    const kinds = new Set(Object.values(FLAVOURS).map((one) => one.kind));
    for (const kind of COMMANDS) expect([...kinds]).toContain(kind);
  });

  /**
   * Let the event loop run between boards.
   *
   * Vitest's worker talks to the runner over RPC with a timeout of its own, and a `it` body
   * that never yields cannot service it: a wide sweep is a single synchronous block of a minute
   * or more, and the run came back with every test passed *and* an unhandled
   * `Timeout calling "onTaskUpdate"` beside it — which vitest rightly says may mean the results
   * are not to be trusted. One macrotask per board is enough, and a board is the right grain:
   * small enough that the gap is never long, large enough that the yielding costs nothing
   * against the work.
   */
  const breathe = () => new Promise((go) => setTimeout(go, 0));

  it.each(games)(
    "walks $name boards and loses nothing through a code",
    async ({ mode, band }) => {
      const { graph, lexicon, manifest } = shippedData(band);
      const world = { graph, lexicon };
      // Boards of this game, from the shard that does not move with the date, longest first —
      // a long answer is the busiest round and the biggest code.
      const puzzles = shippedShard(0)
        .filter((one) => manifest.bands[one.band]?.mode === mode)
        .sort((a, b) => b.par - a.par)
        .slice(0, BOARDS);
      expect(puzzles.length).toBeGreaterThan(0);

      /** What the corpus exercised, so a green run cannot be a run that did nothing. */
      const seen = new Set<string>();

      for (const puzzle of puzzles) {
        await breathe();
        for (const shape of Object.keys(SHAPES) as (keyof typeof SHAPES)[]) {
          for (let seed = 1; seed <= SEEDS; seed++) {
            const { state, commands } = playRound(
              puzzle,
              world,
              SHAPES[shape],
              seed,
            );
            const where = `${puzzle.source}→${puzzle.target} ${shape} seed ${seed}`;

            const kept = snapshot(state);
            const code = encodeBoard(kept, puzzle, graph);
            for (const action of actionsOf(kept, puzzle)) {
              seen.add(action.do);
              // And the one case that is not a kind: a guess that played two tokens, which only
              // a translated alphabet produces and which the bits write as an `also`.
              if (action.do === "guess" && action.words.length > 1)
                seen.add("also");
            }
            // A word the board never drew, which is the case a move index makes free and a
            // dictionary index would have made expensive.
            for (const word of state.revealed.keys()) {
              if (!puzzle.board.includes(word)) seen.add("off-board word");
            }

            // 1. The same game, whichever way it was put back together.
            const sent = decodeBoard(code, puzzle, graph);
            // The one action no *played* game produces: a hint on a word the round went on to
            // name, dropped to a total on the way out. It only ever appears on the far side, so
            // it is counted here rather than off `actionsOf` — and counted at all, because a
            // corpus that stopped naming its hinted words would stop exercising the drop.
            if (sent?.spentHints) seen.add("spent");
            expect(
              sent,
              `${where}: refused its own code ${code}\n${JSON.stringify(commands)}`,
            ).not.toBeNull();
            const through = restore(puzzle, sent, lexicon.label);
            const stored = restore(puzzle, kept, lexicon.label);
            expect(
              reading(through),
              `${where}\n${JSON.stringify(commands)}`,
            ).toEqual(reading(stored));
            // And the same as the game that was played, which is the stronger claim of the two:
            // it holds `restore` to account as well as the code.
            expect(reading(through), where).toEqual(reading(state));

            // 2. Settled: what came back encodes to the same characters.
            expect(encodeBoard(snapshot(through), puzzle, graph), where).toBe(
              code,
            );

            // 3. And it is a URL.
            expect(
              stateFromPath(pathFor(puzzle.id, "", "/", code), "/"),
              where,
            ).toBe(code);
          }
        }
      }

      // The corpus has to have contained the things it is supposed to protect. Without this a
      // fuzz that quietly stopped producing hints would still be green.
      for (const kind of [...KINDS, "off-board word"])
        expect([...seen]).toContain(kind);
    },
  );

  /**
   * And the sound game specifically, because it is the only place a guess plays two moves.
   * Asserted apart from the loop so that a corpus which happened to miss one is a failure
   * about *that* rather than a failure of the whole sweep.
   */
  it("carries a guess that named two pronunciations", () => {
    const phonemes = shippedModes().find((one) => one.name === "phonemes");
    expect(phonemes).toBeDefined();
    const { graph, lexicon, manifest } = shippedData(phonemes!.band);
    const world = { graph, lexicon };
    const puzzles = shippedShard(0).filter(
      (one) => manifest.bands[one.band]?.mode === phonemes!.mode,
    );

    let found = 0;
    for (const puzzle of puzzles.slice(0, 40)) {
      for (let seed = 1; seed <= 4 && found < 3; seed++) {
        const { state } = playRound(puzzle, world, SHAPES.heavy, seed);
        const kept = snapshot(state);
        const many = actionsOf(kept, puzzle).filter(
          (one) => one.do === "guess" && one.words.length > 1,
        );
        if (many.length === 0) continue;
        found += 1;
        const code = encodeBoard(kept, puzzle, graph);
        const through = restore(
          puzzle,
          decodeBoard(code, puzzle, graph),
          lexicon.label,
        );
        expect(reading(through)).toEqual(reading(state));
        // One typed word, one guess against the score, two moves on the board.
        expect(through.log.length).toBeGreaterThan(through.guesses);
      }
      if (found >= 3) break;
    }
    expect(
      found,
      "no round played a spelling that named two pronunciations",
    ).toBeGreaterThan(0);
  });
});
