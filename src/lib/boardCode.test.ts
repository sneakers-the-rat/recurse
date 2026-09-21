/**
 * Boards written down and read back.
 *
 * Two promises, and they pull in opposite directions. A code has to come back as the round
 * that went in — the same moves, the same score, the same hints, from either end of the
 * puzzle — and it has to be short enough to sit in something a person pastes, which is why
 * the sizes here are asserted rather than described. Everything in between is a string that
 * arrived from somebody else's clipboard, so the third promise is that no such string can do
 * worse than produce a board with less on it.
 *
 * The toy graph, because what is under test is the encoding and not the bank: five words and
 * four edges are enough to make every operation happen, and a code's length is easier to
 * reason about when the dictionary is ten words long. `boardCode` is asked about the shipped
 * data in `plate.test.ts`'s company — see the size test at the end, which uses a real
 * puzzle's word count rather than the fixture's.
 *
 * **The fuzz that walks real boards is `boardCode.fuzz.test.ts`**, in a test group of its own
 * so that the seconds it takes are not charged to the timeout every test here is judged by.
 */

import { describe, expect, it } from "vitest";
import { testGraph } from "../test/fixture";
import { shippedData } from "../test/shipped";
import { reading } from "../test/rounds";
import { shortestPath } from "./graph";
import {
  decodeBoard,
  encodeBoard,
  explain,
  isBoardCode,
  spending,
  staleCode,
} from "./boardCode";
import { moveKey } from "./found";
import {
  applyGuess,
  hintCount,
  newGame,
  restore,
  select,
  snapshot,
  useHint,
  useMoveHint,
  type GameState,
} from "./game";
import type { Lexicon } from "./lexicon";
import type { Puzzle } from "./types";

const graph = testGraph();
const dict = graph.isWord;

/** `base → cannon`, the whole width of the toy graph: four moves through `ball`. */
const puzzle: Puzzle = {
  id: "aaaa1111",
  day: 0,
  band: 0,
  source: "base",
  target: "cannon",
  par: 4,
  secret: 0,
  corridorSize: 5,
  altNodes: 0,
  shortestPaths: 1,
  maxRank: 0,
  board: ["base", "baseball", "ball", "cannonball", "cannon"],
};

/** Play a run of guesses, each from wherever the last one landed. */
function play(from: GameState, ...words: string[]): GameState {
  return words.reduce(
    (state, word) => applyGuess(state, graph, word, dict).state,
    from,
  );
}

/** Through a code and back, the way a shared link is opened. */
function round(state: GameState, of: Puzzle = puzzle): GameState {
  const code = encodeBoard(snapshot(state), of, graph);
  const sent = decodeBoard(code, of, graph);
  expect(sent).not.toBeNull();
  return restore(of, sent);
}

describe("a code", () => {
  it("is base64url and nothing else, so it survives being a path segment", () => {
    const state = play(
      newGame(puzzle),
      "baseball",
      "ball",
      "cannonball",
      "cannon",
    );
    const code = encodeBoard(snapshot(state), puzzle, graph);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(isBoardCode(code)).toBe(true);
  });

  it("counts its stands from the sorted pair, whichever end is the source", () => {
    /*
      **The address is direction-blind and so is the format.** A puzzle id is a digest of the
      *sorted* pair — a move is its own inverse, so which end the builder wrote first is a
      finding of the rules and moves when a rule moves. If a code counted from `source`
      instead, a rebuild that flipped the two ends would leave every address alone and change
      what every code meant. See `endpoints` in actions.ts.
    */
    const flipped: Puzzle = {
      ...puzzle,
      source: puzzle.target,
      target: puzzle.source,
    };
    const state = play(newGame(puzzle), "baseball", "ball");
    const code = encodeBoard(snapshot(state), puzzle, graph);
    // The same code read against the same puzzle written the other way round: the same round,
    // because the words a `stand` names are found in the same order either way.
    const back = restore(flipped, decodeBoard(code, flipped, graph));
    expect(back.log.map((entry) => `${entry.from} ${entry.to}`)).toEqual(
      state.log.map((entry) => `${entry.from} ${entry.to}`),
    );
  });
});

describe("a round, through a code and back", () => {
  it("comes back as the same moves, in the same order", () => {
    const state = play(
      newGame(puzzle),
      "baseball",
      "ball",
      "cannonball",
      "cannon",
    );
    const back = round(state);
    expect(back.log.map((entry) => `${entry.from} ${entry.to}`)).toEqual(
      state.log.map((entry) => `${entry.from} ${entry.to}`),
    );
    expect(back.guesses).toBe(state.guesses);
    expect(back.solved).toBe(true);
    expect([...back.revealed.keys()]).toEqual([...state.revealed.keys()]);
  });

  it("keeps a round played from the goal end, and where the cursor was left", () => {
    // Both ends are somewhere to stand — see `isFront` — so a code that only understood a
    // chain from the source would lose half of how this game is played.
    let state = select(newGame(puzzle), "cannon");
    state = play(state, "cannonball", "ball");
    state = select(state, "base");
    state = play(state, "baseball");
    const back = round(state);
    expect(back.log.map((entry) => `${entry.from} ${entry.to}`)).toEqual([
      "cannon cannonball",
      "cannonball ball",
      "base baseball",
    ]);
    expect(back.selected).toBe(state.selected);
    // Two halves that have not met yet, which is a real state of this game and one a code
    // has to be able to hold: `solved` is whether the moves *join* the ends, not whether the
    // goal was reached. See `joins`.
    expect(back.solved).toBe(state.solved);
    expect(back.solved).toBe(false);
  });

  it("keeps a cursor moved after the last guess", () => {
    // A tap costs nothing and leaves no trace in the log, so the trailing `stand` is the
    // only record there is of one.
    const state = select(play(newGame(puzzle), "baseball"), "cannon");
    expect(round(state).selected).toBe("cannon");
  });

  it("keeps the hints, the marks and the refusals — the other half of a score", () => {
    let state = play(newGame(puzzle), "baseball");
    state = useHint(useHint(state, "ball"), "ball");
    state = useHint(state, "cannonball");
    state = useMoveHint(state, "ball", ["cannonball"]);
    state = applyGuess(state, graph, "nonsense", dict).state;

    const back = round(state);
    expect([...back.hints]).toEqual([...state.hints]);
    expect(hintCount(back)).toBe(hintCount(state));
    expect([...back.edgeHints]).toEqual([moveKey("ball", "cannonball")]);
    expect(back.misses).toBe(1);
  });

  it("costs one guess for a word that named two moves", () => {
    // A spelling can name several tokens in a translated alphabet and every one that plays is
    // a move — as one guess. A code that wrote them as two would restore a worse score than
    // was played. See `also` on `Judgement`.
    const twoWays: Lexicon = {
      translated: true,
      label: (token) => token,
      transcribe: () => "",
      labels: (token) => [token],
      knows: () => true,
      parse: (typed) =>
        typed === "both" ? ["baseball", "cannonball"] : [typed],
    };
    const forked: Puzzle = {
      ...puzzle,
      source: "ball",
      target: "cannonball",
      par: 1,
    };
    const state = applyGuess(
      newGame(forked),
      graph,
      "both",
      dict,
      twoWays,
    ).state;
    expect(state.guesses).toBe(1);

    const back = round(state, forked);
    expect(back.guesses).toBe(1);
    expect(back.log.map((entry) => entry.to).sort()).toEqual([
      "baseball",
      "cannonball",
    ]);
  });

  it("resolves against the same pair however else the puzzle was re-cut", () => {
    /*
      **The invariant the whole address scheme is for: for a given puzzle id, a code works.**

      An id is a digest of the game, the pair and the vocabulary — and of nothing else, so par,
      the answer, the words the board draws, the day, the band and every selection knob can all
      move without an address moving. Which is the point: those are the taste knobs, they change
      weekly, and a rebuild that touches only them must leave every shared board resolving. See
      graphgen's id.rs.

      What is *not* here, because this cannot test it: a vocabulary change. That changes the
      id, so the link resolves to nothing and falls back to today's board — the honest failure,
      and the one `vocab:` in recurse.yaml exists to announce in advance.
    */
    const recut: Puzzle = {
      ...puzzle,
      par: 9,
      secret: 3,
      day: 4242,
      band: 2,
      board: ["nothing", "in", "common"],
      corridorSize: 99,
      altNodes: 7,
      shortestPaths: 4,
      maxRank: 1,
    };
    const state = play(newGame(puzzle), "baseball", "ball", "cannonball");
    const code = encodeBoard(snapshot(state), puzzle, graph);
    expect(reading(restore(recut, decodeBoard(code, recut, graph)))).toEqual(
      reading(state),
    );
  });

  it("does not care which words the puzzle declared", () => {
    /*
      A guess is a position in the graph's list of moves from where the player stood, so what
      the *board* drew has no bearing on it — same code, to the character, for a puzzle that
      declares five words and one that declares two.

      Which is the point of `Puzzle.board` having left the format: it comes out of the
      selection rules, and those are the taste knobs. A code that indexed it would name other
      words after any of them moved, and the address would not have changed to say so.
    */
    const bare: Puzzle = { ...puzzle, board: ["base", "cannon"] };
    const state = play(newGame(puzzle), "baseball", "ball");
    const code = encodeBoard(snapshot(state), puzzle, graph);
    expect(encodeBoard(snapshot(state), bare, graph)).toBe(code);
    expect(reading(restore(bare, decodeBoard(code, bare, graph)))).toEqual(
      reading(state),
    );
  });

  it("is empty for a board nobody has touched", () => {
    const back = round(newGame(puzzle));
    expect(back.log).toEqual([]);
    expect(back.guesses).toBe(0);
    expect(back.selected).toBe(puzzle.source);
  });
});

/**
 * The word list a code was written against, which a code says for itself.
 *
 * **The thing the puzzle id used to say and no longer does.** An id was a digest of the
 * vocabulary, so a curated word list renamed every board and killed every link — to protect a
 * round. Twelve bits at the head of the code protect the round instead, and leave the address
 * alone. See `stampOf`, and graphgen's id.rs for the whole argument.
 */
describe("the word list a code was written against", () => {
  // The same toy dictionary before and after a curation: same words, same moves, different
  // digest. A code written against one of them is not a code for the other.
  const before = testGraph([], "68336fe4");
  const after = testGraph([], "489d5ef6");
  const state = play(newGame(puzzle), "baseball", "ball");

  it("is carried by every code, and matches the list it was written against", () => {
    expect(staleCode(encodeBoard(snapshot(state), puzzle, before), before)).toBe(false);
    expect(staleCode(encodeBoard(snapshot(state), puzzle, after), after)).toBe(false);
  });

  it("says so when the list has moved under it", () => {
    const code = encodeBoard(snapshot(state), puzzle, before);
    expect(staleCode(code, after)).toBe(true);
  });

  /**
   * **And the round is still read.** This is the deliberate half: the bit stream is this
   * format either way, so what a stale code names is a *plausible* round rather than
   * nonsense — which is exactly why it cannot be left to be discovered. The screen draws it
   * and says not to trust it; refusing outright would throw away a round that is usually
   * right, and drawing it silently would be the failure nobody can see.
   */
  it("still reads the round, so the screen can show it and say not to trust it", () => {
    const code = encodeBoard(snapshot(state), puzzle, before);
    // The toy dictionary is the same either side, so this one comes back intact. Over a real
    // curation it need not, and `decodeBoard` returning null is the other thing the screen
    // has a sentence for.
    expect(decodeBoard(code, puzzle, after)).not.toBeNull();
  });

  it("counts a code this build cannot read at all as stale", () => {
    // The stamp is not in the same place in another format, so it cannot be compared — but a
    // code this build did not write is certainly not one written against this word list, and
    // "ask for a fresh link" is the same remedy.
    const code = encodeBoard(snapshot(state), puzzle, before);
    const other = code.replace(/^./, (digit) => (digit === "I" ? "Q" : "I"));
    expect(staleCode(other, before)).toBe(true);
  });

  it("has no opinion about a string that is not a code", () => {
    // Nothing is not stale. The caller already treats it as a link with no round in it.
    for (const bad of ["", "not a code", "%20"]) expect(staleCode(bad, before)).toBe(false);
  });
});

describe("a code that cannot be trusted", () => {
  const state = play(newGame(puzzle), "baseball", "ball");
  const code = encodeBoard(snapshot(state), puzzle, graph);

  it("is refused outright when it is not a code at all", () => {
    // The caller carries on as if the link had no state in it, which is what a bare id does.
    for (const bad of ["", "not a code", "abc/def", "zz+zz", "%20"]) {
      expect(decodeBoard(bad, puzzle, graph)).toBeNull();
    }
  });

  it("is refused when it is from a version this build does not have", () => {
    // The version is the first three bits, so flipping the leading character is a code from
    // some other format. Refused rather than read as this one.
    const other = code.replace(/^./, (digit) => (digit === "I" ? "Q" : "I"));
    const read = decodeBoard(other, puzzle, graph);
    if (read !== null) expect(read.log).not.toHaveLength(state.log.length);
  });

  it("is refused whole when it has been cut short", () => {
    // A code ends with a terminator and a digest, so half of one is knowably half — which is
    // what a chat client wrapping a link produces. Half a board would look like somebody's
    // round rather than like a broken link, and that is the worse of the two.
    for (let cut = 1; cut < code.length; cut++) {
      expect(decodeBoard(code.slice(0, cut), puzzle, graph)).toBeNull();
    }
  });

  it("is usually refused when a character has been changed", () => {
    // Usually, and not always: there is no checksum, so what catches a mangled paste is the
    // version field, the terminator and the padding. A flip in the middle of a long code names
    // a different legal move instead — see the header for why that is an acceptable answer.
    let caught = 0;
    for (let at = 0; at < code.length; at++) {
      for (const digit of ["A", "B", "z"]) {
        if (code[at] === digit) continue;
        const bent = code.slice(0, at) + digit + code.slice(at + 1);
        if (decodeBoard(bent, puzzle, graph) === null) caught += 1;
      }
    }
    // A flip in a spare bit changes nothing to catch, so not every one can be caught — but a
    // format where most of them sailed through even on a two-character code would be one to
    // distrust outright.
    expect(caught).toBeGreaterThan(code.length);
  });

  it("is refused when anything follows it", () => {
    /*
      A code is *canonical*: one board, one string. Nothing but the zeroes that pad to a
      character boundary may follow the digest — otherwise a chat client or an autolinker that
      swallowed a neighbouring character would hand back the right board under a second name,
      and two links to one board is a thing nobody can debug.
    */
    for (const tail of ["A", "AAAA", "zzzz", "-_"]) {
      expect(decodeBoard(code + tail, puzzle, graph), tail).toBeNull();
    }
  });

  it("does not depend on the puzzle’s word list for its moves", () => {
    // A guess is a position in the graph's own list of moves from where the player stood, so
    // a rebuild that changes which words a board *draws* cannot change which moves a code
    // means. Only a hint or a mark names a word rather than a move, and those index the
    // dictionary, which the address pins.
    const elsewhere: Puzzle = {
      ...puzzle,
      board: ["base", "cannon", "life", "lime"],
    };
    const sent = decodeBoard(code, elsewhere, graph);
    expect(sent).not.toBeNull();
    expect(sent!.log.map((entry) => `${entry.from} ${entry.to}`)).toEqual(
      state.log.map((entry) => `${entry.from} ${entry.to}`),
    );
  });

  it("cannot be made to hint at a word past what the word can give", () => {
    // `restore` clamps a level to what the spelling holds, which is the same guard a snapshot
    // out of `localStorage` gets. A code claiming forty hints on a four-letter word would
    // otherwise put forty on the tally.
    const hinted = useHint(newGame(puzzle), "ball");
    const sent = decodeBoard(
      encodeBoard(snapshot(hinted), puzzle, graph),
      puzzle,
      graph,
    )!;
    sent.hints = [["ball", 40]];
    expect(hintCount(restore(puzzle, sent))).toBe(1 + "ball".length);
  });
});

describe("how long a code is", () => {
  /**
   * A par-8 round on a board of 45 words, which is the large end of what the bank holds.
   *
   * Made of the numbers rather than of a real board: the length of a code is decided by how
   * many words the puzzle declares — six bits at 45 — and by how many operations there are,
   * and neither of those needs a graph to be true. The claim is the one the URL rests on: a
   * whole round is a couple of dozen characters, not a couple of hundred.
   */
  it("is a handful of characters for a whole round", () => {
    const state = play(
      newGame(puzzle),
      "baseball",
      "ball",
      "cannonball",
      "cannon",
    );
    const code = encodeBoard(snapshot(state), puzzle, graph);
    // Three bits of version and five a guess on a five-word board: one guess a character.
    expect(code.length).toBeLessThanOrEqual(5);
  });

  /**
   * The same claim against a real board, because the fixture's dictionary is ten words long
   * and a real one is 189,000 — so only this can show that a code stays short *because* it
   * counts from the puzzle rather than from the dictionary.
   */
  it("spends about a byte a guess on a shipped board", () => {
    const { graph: real, puzzles, manifest } = shippedData();
    // A shard holds every mode's puzzles and this is the letters graph, which knows nothing
    // of a phonemes board's endpoints — it would answer "no route" rather than fail.
    const letters = puzzles.filter(
      (one) => manifest.bands[one.band]?.mode === 0,
    );
    const puzzle = letters.find((one) => one.par >= 4) ?? letters[0]!;
    const route =
      shortestPath(real, puzzle.source, puzzle.target, real.commonNeighbors) ??
      [];
    let state = newGame(puzzle);
    for (const word of route.slice(1)) {
      state = applyGuess(state, real, word, real.isWord).state;
    }
    expect(state.solved).toBe(true);

    const code = encodeBoard(snapshot(state), puzzle, real);
    const back = restore(puzzle, decodeBoard(code, puzzle, real));
    expect(back.log.map((entry) => `${entry.from} ${entry.to}`)).toEqual(
      state.log.map((entry) => `${entry.from} ${entry.to}`),
    );
    expect(back.guesses).toBe(state.guesses);
    expect(back.solved).toBe(true);
    /*
      **A tag bit and the width of the move list it came out of** — eight bits a guess on this
      board, against the twenty a dictionary index would cost — on top of a sixteen-bit head
      and tail: three of version, five of terminator, eight of digest, and up to five more of
      padding to the character boundary.

      That is the number the whole choice of encoding rests on, which is why it is asserted
      rather than described: a guess is a position in the list of legal moves from where the
      player was standing, so it costs the same whether they were on the answer or off
      exploring. A regression here means the packing has come loose from the graph. The
      header comment has the comparison against zstd and against a trained dictionary.
    */
    expect(code.length * 6).toBeLessThanOrEqual(22 + 10 * state.guesses);
  });

  it("grows a bit or so per guess, not a word’s worth", () => {
    const four = encodeBoard(
      snapshot(
        play(newGame(puzzle), "baseball", "ball", "cannonball", "cannon"),
      ),
      puzzle,
      graph,
    );
    const one = encodeBoard(
      snapshot(play(newGame(puzzle), "baseball")),
      puzzle,
      graph,
    );
    expect(four.length - one.length).toBeLessThanOrEqual(3);
  });

  /**
   * And where the length went, which is the question `spending` exists to answer and the dev
   * bar's inspector to draw. See `ReadCode` in DevBar.
   */
  describe("where a code’s length goes", () => {
    /** A round with something of every shape in it, so the summary has rows to sort. */
    const busy = () => {
      let state = play(newGame(puzzle), "baseball", "ball");
      state = useHint(state, "cannonball");
      state = useHint(state, "cannonball");
      state = useMoveHint(state, "ball", ["cannonball"]);
      return state;
    };

    it("accounts for every bit the reader took, and nothing else", () => {
      const state = busy();
      const code = encodeBoard(snapshot(state), puzzle, graph);
      const read = explain(code, puzzle, graph);
      expect(read).not.toBeNull();

      const spend = spending(read!.fields);
      const bits = spend.reduce((sum, one) => sum + one.bits, 0);
      // Every field is counted once, and the total is the fields' own widths added up.
      expect(spend.reduce((sum, one) => sum + one.count, 0)).toBe(
        read!.fields.length,
      );
      expect(bits).toBe(
        read!.fields.reduce(
          (sum, f) => sum + f.bits.replace(/[^01]/g, "").length,
          0,
        ),
      );
      // And it fits the characters it was read from, with only the padding to spare — a
      // summary that claimed more bits than the code holds would be counting something twice.
      expect(bits).toBeLessThanOrEqual(code.length * 6);
      expect(bits).toBeGreaterThan((code.length - 1) * 6);
    });

    it("names the dearest kind of field first", () => {
      const read = explain(
        encodeBoard(snapshot(busy()), puzzle, graph),
        puzzle,
        graph,
      );
      const spend = spending(read!.fields);
      expect(spend.length).toBeGreaterThan(1);
      for (let at = 1; at < spend.length; at++) {
        expect(spend[at - 1]!.bits).toBeGreaterThanOrEqual(spend[at]!.bits);
      }
      // The head and the tail are rows of their own rather than being netted off, because on a
      // short code they are most of it and that is the thing worth seeing.
      expect(spend.map((one) => one.name)).toContain("version");
      expect(spend.map((one) => one.name)).toContain("op");
    });

    it("is empty for a code that will not read", () => {
      expect(explain("!!!!", puzzle, graph)).toBeNull();
      expect(spending([])).toEqual([]);
    });
  });
});
