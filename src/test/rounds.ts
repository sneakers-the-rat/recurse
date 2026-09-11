/**
 * A simulated player, for tests that need a round rather than a move.
 *
 * Two things want one and they want opposite things from it. `codeSize.test.ts` needs rounds
 * of a *stated shape* — thirty hints, twenty-five strays — because the length of a shared board
 * is a claim about what people actually do. `boardCode.test.ts` needs rounds of *every* shape,
 * as many as it can get, because what it checks is that nothing anybody can do to a board
 * survives a trip through a URL differently from how it went in. One simulator serves both: the
 * shape is a budget per flavour, and which flavour happens next is a draw.
 *
 * **It plays through the vocabulary and nothing else.** `offers` in lib/actions.ts says what
 * commands a board would accept, of a given kind; `act` does one. So this knows the *rules* of
 * nothing: what is legal, what a guess lands on, what a hint costs are all the game's answers,
 * and a round it produces is a round somebody could have played. That is the whole reason it is
 * worth round-tripping — a hand-assembled `GameState` would only test the encoding against
 * itself.
 *
 * **A flavour is a kind plus a taste**, because the interesting distinctions in a round are not
 * distinctions the game makes: a guess at a word the board never drew, a guess at a word
 * already reached, and a guess along the answer are one command kind and three quite different
 * things to encode. `FLAVOURS` is that table, and `boardCode.test.ts` asserts it covers every
 * kind in `COMMANDS` — so a command added to the game joins the fuzz whether or not anybody
 * remembers to come here.
 *
 * **Seeded, and it hands back what it did.** Every draw comes from `seed`, so a fuzz failure
 * prints a board and a number and the round comes back exactly; and `commands` is the list, so
 * the failure can be read rather than guessed at. Nothing here touches `Math.random`.
 *
 * **A guess is typed the way a player types it**: the spelling, through the lexicon, which in a
 * translated alphabet is how one guess comes to play two moves — a spelling can name two
 * pronunciations and every one that plays is played. That is the one thing the letters game
 * cannot produce, which is why the fuzz corpus takes in phonemes boards.
 */

import { act, offers, type Command, type World } from "../lib/actions";
import { hintCount, newGame, select, type GameState } from "../lib/game";
import { shortestPath } from "../lib/graph";
import { PLAIN } from "../lib/lexicon";
import type { Puzzle } from "../lib/types";

/**
 * How much of each thing a player does. A budget rather than a script: the draw picks among
 * whatever still has some left, so the flavours interleave the way they do in a real round.
 */
export interface Wildness {
  /** Guesses at words the puzzle never declared. */
  strays: number;
  /** Guesses at words not yet reached, which is how a round gets anywhere. */
  onward: number;
  /** Guesses that repeat a move already made, which are free. */
  repeats: number;
  /** Guesses the game refuses. */
  misses: number;
  /** Taps on a word already reached, which move the cursor and cost nothing. */
  hops: number;
  /** Hint clicks, one letter of one word each. */
  hintClicks: number;
  /** Move marks bought. */
  marks: number;
  /** Whether to walk the answer at the end, so the round is finished. */
  finish: boolean;
}

/**
 * A kind of command, and which of the offers of that kind this flavour wants.
 *
 * `nonsense` is the one flavour whose command is not among the offers, and deliberately: a
 * refusal is what a guess comes to when the judge says no, so the only way to get one is to
 * type something that is not a word. Everything else draws from what the board offers.
 */
export const FLAVOURS: Record<
  keyof Omit<Wildness, "finish">,
  {
    kind: Command["do"];
    nonsense?: true;
    wants?: (command: Command, state: GameState) => boolean;
  }
> = {
  strays: {
    kind: "guess",
    wants: (command, state) =>
      command.do === "guess" &&
      !state.puzzle.board.includes(command.typed) &&
      !state.revealed.has(command.typed),
  },
  onward: {
    kind: "guess",
    wants: (command, state) =>
      command.do === "guess" && !state.revealed.has(command.typed),
  },
  repeats: {
    kind: "guess",
    wants: (command, state) =>
      command.do === "guess" && state.revealed.has(command.typed),
  },
  misses: { kind: "guess", nonsense: true },
  hops: { kind: "stand" },
  hintClicks: { kind: "hint" },
  marks: { kind: "mark" },
};

/**
 * Three shapes, and the middle one is what a round looks like.
 *
 * `heavy` is not a worst case invented to be hard: about thirty hints and fifteen to thirty
 * guesses at words the board never drew is what people do, and every one of those is expensive
 * in a different part of a code. Measuring only `tidy` flatters the encoding threefold.
 */
export const SHAPES = {
  tidy: {
    strays: 0,
    onward: 0,
    repeats: 0,
    misses: 0,
    hops: 0,
    hintClicks: 2,
    marks: 0,
    finish: true,
  },
  ordinary: {
    strays: 8,
    onward: 2,
    repeats: 1,
    misses: 3,
    hops: 3,
    hintClicks: 10,
    marks: 1,
    finish: true,
  },
  heavy: {
    strays: 25,
    onward: 4,
    repeats: 4,
    misses: 12,
    hops: 10,
    hintClicks: 30,
    marks: 3,
    finish: true,
  },
  /**
   * A round still in progress, which is a board somebody might well share and the only shape
   * that leaves the cursor somewhere other than where the last guess landed.
   *
   * Every other shape ends by walking the answer, so it ends standing on the goal — and a
   * `stand` written for the cursor at the end of a series would never be exercised by them.
   */
  unfinished: {
    strays: 6,
    onward: 3,
    repeats: 1,
    misses: 2,
    hops: 4,
    hintClicks: 6,
    marks: 1,
    finish: false,
  },
} satisfies Record<string, Wildness>;

/** Xorshift32. A couple of lines, repeatable, and nothing here is a secret. */
export function rng(seed: number) {
  let at = seed >>> 0 || 0x9e3779b9;
  return () => {
    at ^= at << 13;
    at ^= at >>> 17;
    at ^= at << 5;
    return (at >>> 0) / 0x100000000;
  };
}

/**
 * A word no dictionary has, for getting a refusal.
 *
 * Long enough to clear `minWord`, so the judge refuses it as "not a word" rather than as too
 * short — either is a refusal, but this one makes it look up the dictionary.
 */
const NONSENSE = "qzqxxvwk";

/** What a round did, and what it was asked to do. */
export interface Round {
  state: GameState;
  /** Every command issued, in order — a failing case, ready to be read or replayed. */
  commands: Command[];
}

/**
 * Play a round.
 *
 * Draws a flavour from whatever still has budget, asks the board for the commands of that kind,
 * takes one that suits the flavour, and does it — then walks the answer, if the shape asks for
 * a finished board. A flavour with nothing to offer on this board spends its budget rather than
 * looping: a board is allowed to be too small for a shape.
 */
export function playRound(
  puzzle: Puzzle,
  world: World,
  shape: Wildness,
  seed = 7,
): Round {
  const { graph, lexicon = PLAIN } = world;
  const next = rng(seed);
  // A declaration rather than a generic arrow: eslint parses this file with Babel's JSX
  // plugin on, which reads `<T>` as a tag — and prettier rewrites the `<T,>` that would have
  // disambiguated it. A function has no such argument with anybody.
  function pick<T>(from: readonly T[]): T | undefined {
    return from.length === 0
      ? undefined
      : from[Math.floor(next() * from.length)];
  }

  let state = newGame(puzzle);
  const commands: Command[] = [];
  const run = (command: Command) => {
    commands.push(command);
    state = act(state, world, command).state;
  };

  const left = { ...shape };
  const flavours = Object.keys(FLAVOURS) as (keyof typeof FLAVOURS)[];
  for (;;) {
    const wanted = flavours.filter((one) => left[one] > 0);
    if (wanted.length === 0) break;
    const flavour = pick(wanted)!;
    left[flavour] -= 1;
    const { kind, wants, nonsense } = FLAVOURS[flavour];
    if (nonsense) {
      run({ do: "guess", typed: NONSENSE });
      continue;
    }
    /*
      **A stray is a guess made from somewhere, and where from is part of the flavour.** The
      offers are the moves from wherever the cursor is, so wandering means standing somewhere
      first — which is also how a round comes to hold the alternating run of `stand` and
      `guess` that a wandering player produces.
    */
    if (flavour === "strays") {
      const somewhere = pick(offers(state, world, "stand"));
      if (somewhere) run(somewhere);
    }
    const choices = offers(state, world, kind).filter(
      (command) => !wants || wants(command, state),
    );
    const command = pick(choices);
    if (command) run(command);
  }

  if (shape.finish) {
    // From the source, wherever the wandering left the cursor, and along the answer the board
    // is drawn as: the route through ordinary words, which is what par counts.
    const answer =
      shortestPath(
        graph,
        puzzle.source,
        puzzle.target,
        graph.commonNeighbors,
      ) ?? [];
    if (state.selected !== puzzle.source) {
      run({ do: "stand", word: puzzle.source });
    } else {
      state = select(state, puzzle.source);
    }
    for (const word of answer.slice(1))
      run({ do: "guess", typed: lexicon.label(word) });
  }

  return { state, commands };
}

/**
 * Every observable fact about a game, as something two of them can be compared by.
 *
 * A `GameState` holds maps and derived counts, so comparing two of them means saying what
 * counts as the same game. This is that list: the moves in order and how they were grouped
 * into guesses, where each word was reached from, the two tallies, the hints and the marks,
 * the cursor, and whether the round is over. Nothing about object identity, and nothing
 * derived twice.
 *
 * Hints and marks are sorted, because a `Map`'s iteration order is not something a player can
 * see — a board that came back with the same hints in another order is the same board. What
 * that order *does* decide is the bytes, and `boardCode.test.ts` pins those separately by
 * re-encoding what it restored.
 *
 * **Hints are counted on the words the figure still shows one for, plus the total.** That is
 * the one place this is weaker than "the same game", and it is weaker on purpose: a shared
 * board's code does not carry a level for a word the round went on to name, because the figure
 * spells that word out in full and shows nothing for the hint — see `written` in boardCode.ts.
 * So the levels of *named* words are not comparable, while everything a player can see is: the
 * unnamed words keep their own levels, and `hintCount` keeps the score whole. Comparing the raw
 * map instead would be asserting that a share link reconstructs bookkeeping nobody can look at,
 * which is exactly what it was made to stop paying for.
 */
export function reading(state: GameState) {
  return {
    log: state.log.map(
      (entry) =>
        `${entry.order} ${entry.from} > ${entry.to} ` +
        `${entry.move.kind} ${entry.move.sub}@${entry.move.pos}`,
    ),
    revealed: [...state.revealed.values()]
      .map((one) => `${one.word} via ${one.via ?? "-"} #${one.order}`)
      .sort(),
    guesses: state.guesses,
    misses: state.misses,
    solved: state.solved,
    selected: state.selected,
    hints: [...state.hints]
      .filter(([word]) => !state.revealed.has(word))
      .map(([word, level]) => `${word}=${level}`)
      .sort(),
    hintCount: hintCount(state),
    edgeHints: [...state.edgeHints].sort(),
  };
}
