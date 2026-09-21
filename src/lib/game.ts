/**
 * The daily game's state, as pure functions over an immutable snapshot.
 *
 * What a guess *does* to a board — which words it reveals, where it leaves the cursor, what a
 * repeated move costs — is found.ts, because the explore mode asks the same question of the
 * same graphs. What is here is everything that only makes sense with a puzzle in hand: two
 * ends, a par to beat, hints to buy and a round that finishes.
 *
 * The rules, as they stand:
 *  - You start with the source word revealed and selected.
 *  - You may guess from *any* revealed word, not just the last one, so the game
 *    is exploring a graph rather than walking a chain.
 *  - **And from the goal**, which is the other place you are standing before you have
 *    moved. A move is an insertion or a removal and the two are inverses, so the graph
 *    is undirected and `carts → heartens` is the same puzzle as `heartens → carts`.
 *    Working back from the goal is therefore not a second mode, and refusing it was
 *    only ever an accident of which word the builder happened to write first. See
 *    `isFront`.
 *  - A move you have not made before reveals whatever it lands on and costs one guess.
 *  - Repeating a move you already made costs nothing. It tells you nothing you did not
 *    know, and charging for it would punish navigating your own map.
 *  - **The round ends when your moves join the source to the goal**, not when the goal
 *    is reached. With two ends to work from those are different events: the move that
 *    finishes a game worked from both sides lands on a word the player already has, and
 *    joining two halves is the whole of what it does. See `joins`.
 *  - An illegal guess costs nothing but is counted as a miss, so the cost of
 *    flailing is visible without being punitive.
 *  - Score is the guess count; par is the shortest path.
 *  - Hints are unlimited and counted. Asking is not cheating — this is not a
 *    competitive game, and "10 guesses, 10,000 hints" is a fine thing to post —
 *    but it is the other half of a score, so every click is tallied and shared.
 *
 * Why the score counts *moves* and not words: par is a number of moves, and a score is
 * only worth reading against par if it measures the same thing. A move between two words
 * the player already has used to be free, on the grounds that it could not help them —
 * which stopped being true the moment there were two halves to join, and free would have
 * meant finishing under par without finding a shortcut.
 */

import {
  advance,
  joins,
  moveKey,
  open,
  replay,
  type Found,
  type LogEntry,
} from "./found";
import { hintLevels, ITSELF, type Spell } from "./hints";
import { PLAIN, type Lexicon } from "./lexicon";
import { judgeGuess } from "./moves";
import type { Graph, Judgement, Move, Puzzle } from "./types";


/**
 * A round of the daily game: what has been found, plus everything a puzzle adds.
 *
 * Extends `Found` structurally rather than nesting it, so every consumer still reads
 * `state.revealed` and `state.log` and a step is `{ ...state, ...step.found }`.
 */
export interface GameState extends Found {
  puzzle: Puzzle;
  /** The word new guesses are made from — a revealed one or the goal. See `isFront`. */
  selected: string;
  misses: number;
  /** Whether the moves made join the source to the goal. Derived; see `joins`. */
  solved: boolean;
  /**
   * How far each unnamed word has been given away, by hint level. Absent means
   * nothing has been asked about it. See `hintLabel` for what each level shows.
   */
  hints: Map<string, number>;
  /**
   * Hints bought on words that have since been named, which nothing on the figure shows.
   *
   * Zero in a game that was played here: every hint is in `hints`, against the word it was
   * asked about. It is only ever set by a game that arrived through a **shared link**, whose
   * code drops those words to stay short — a board somebody sends is for looking at, and a
   * hint on a word that is now spelled out in full is invisible on it. The tally is the one
   * thing that would notice, so the tally is what this keeps whole. See `hintCount`, and
   * `written` in boardCode.ts for the trade.
   */
  spentHints: number;
  /**
   * Moves given away, as `"from to"` — directed, because what a hint on a move says is which
   * way the letters go *from the word that was asked*.
   *
   * The hint for a word on the answer, and the only one it has. Spelling out a word on a
   * shortest route hands over the answer: three letters of a seven-letter word usually names
   * it. So those words sell the *shape* of the move instead — arriving letters or leaving
   * ones, drawn on the edge, because that is what a move is and a node is not.
   */
  edgeHints: Set<string>;
}

/**
 * Hints asked for, all told.
 *
 * The sum of the levels, because a level is exactly one click: nothing spends more
 * than one at a time. Dev mode's "spell this word out" deliberately does not go
 * through here at all — it is an inspection of the board, not help with it, and when
 * it *was* a hint one tap on a ten-letter word put ten on the tally.
 *
 * `spentHints` is in it because a shared board's code does not carry a level for a word it has
 * since named — see `GameState.spentHints`. Everything that shows a score comes through here,
 * so the figure can lose those levels without the score losing them too.
 */
export function hintCount(state: GameState): number {
  let total = state.edgeHints.size + state.spentHints;
  for (const level of state.hints.values()) total += level;
  return total;
}

export function newGame(puzzle: Puzzle): GameState {
  return {
    puzzle,
    ...open(puzzle.source),
    selected: puzzle.source,
    misses: 0,
    solved: false,
    hints: new Map(),
    spentHints: 0,
    edgeHints: new Set(),
  };
}

export type GuessOutcome =
  | {
      kind: "revealed";
      state: GameState;
      move: Move;
      word: string;
      solved: boolean;
    }
  | { kind: "already-known"; state: GameState; move: Move; word: string }
  | {
      kind: "rejected";
      state: GameState;
      judgement: Extract<Judgement, { ok: false }>;
    };

/**
 * Somewhere a guess may be made from: everywhere the player has been, and the goal.
 *
 * The goal is a front from the first move and never becomes a *revealed* word by being
 * stood on — those are two different facts and the board draws both. Revealed means
 * reached: it is what earns a word the arrival animation, the fan of moves leading off the
 * board, and the loss of the gilt lozenge that says "still to get to". A player who works
 * back from the goal and joins up in the middle never reached it, and the figure should say
 * so.
 */
export function isFront(state: GameState, word: string): boolean {
  return state.revealed.has(word) || word === state.puzzle.target;
}

/**
 * What the board is showing, for deciding where a guess lands.
 *
 * A typed word can name several nodes and the cursor can only be on one — see `advance` in
 * found.ts. Which of them the player has already seen is a question about the *figure* rather
 * than about the graph, so it comes from `plate.ts` through the caller rather than being
 * worked out here: the board grows as words are found, and only the thing drawing it knows
 * what is on it now.
 */
export interface Drawn {
  /** Words on a shortest route — the answer, and the line the board is laid out along. */
  spine: ReadonlySet<string>;
  /** Every word drawn, spine or not. */
  nodes: ReadonlySet<string>;
}

/**
 * Where a guess that named several words leaves the cursor.
 *
 * **The one already most a part of the board wins**, in four tiers:
 *
 *   an endpoint  — the goal or the word they started from. It finishes the round, and
 *                  standing anywhere else after playing it reads as being ignored.
 *   on the spine — a word on a shortest route: the answer, which is what the board is
 *                  laid out along and what the player is looking for.
 *   drawn        — already on the board somewhere, so they have seen it and it has a place.
 *   new          — a node this guess has just brought into existence.
 *
 * Because a guess that names several tokens usually names one the player meant and one they
 * have never heard of, and landing on the new one leaves them somewhere off to the side
 * wondering what happened.
 *
 * `drawn` is the caller's, because which words are on the board is `plate.ts`'s question and
 * the answer changes as the board grows. Without it only the endpoint tier can be told apart,
 * which is the letters game and every test written before any of this.
 */
function ranking(puzzle: Puzzle, drawn: Drawn | null): (word: string) => number {
  return (word) =>
    word === puzzle.target || word === puzzle.source
      ? 0
      : drawn?.spine.has(word)
        ? 1
        : drawn?.nodes.has(word)
          ? 2
          : 3;
}

/**
 * Apply a typed guess made from `state.selected`.
 *
 * `lexicon` is how what was typed becomes a node of the graph. It is the identity in the
 * letters mode and defaults to it, so nothing here or below has to know that an alphabet
 * exists — the tokens in `state` are whatever the graph is indexed by, and they are compared
 * and stored and hinted at without being read.
 */
export function applyGuess(
  state: GameState,
  graph: Graph,
  raw: string,
  isWord: ((word: string) => boolean) | null = null,
  lexicon: Lexicon = PLAIN,
  drawn: Drawn | null = null,
): GuessOutcome {
  const judgement = judgeGuess(graph, state.selected, raw, isWord, lexicon);

  if (!judgement.ok) {
    return {
      kind: "rejected",
      state: { ...state, misses: state.misses + 1 },
      judgement,
    };
  }

  const step = advance(
    state,
    state.selected,
    judgement,
    ranking(state.puzzle, drawn),
  );

  if (!step.moved) {
    return {
      kind: "already-known",
      state: { ...state, selected: step.landed },
      move: step.move,
      word: step.landed,
    };
  }

  const solved = joins(state.puzzle.source, state.puzzle.target, step.found.log);
  return {
    kind: "revealed",
    move: step.move,
    word: step.landed,
    solved,
    state: { ...state, ...step.found, selected: step.landed, solved },
  };
}

/** Move the cursor to another word a guess can be made from. */
export function select(state: GameState, word: string): GameState {
  if (!isFront(state, word) || word === state.selected) return state;
  return { ...state, selected: word };
}

/**
 * Ask for one more hint about an unnamed word.
 *
 * No limit, but no free clicks either: once the word is spelled out there is
 * nothing left to give, so the level stops there rather than running the tally up
 * for nothing. A word you are standing on is not a question — which is every word
 * already named, and the goal.
 */
export function useHint(
  state: GameState,
  word: string,
  spell: Spell = ITSELF,
): GameState {
  if (isFront(state, word)) return state;
  const level = state.hints.get(word) ?? 0;
  const wanted = Math.min(level + 1, hintLevels(word, spell));
  if (wanted === level) return state;
  return { ...state, hints: new Map(state.hints).set(word, wanted) };
}

/**
 * Give away one more of a word's moves: the next of `near` that has not been given away yet.
 *
 * What a word on the answer sells instead of its letters. `near` is the words it is joined to
 * *on the board*, in the order the caller wants them spent — so this owns the rule ("one more
 * per click, and nothing once they are all marked") and the board owns which moves exist.
 *
 * Which matters as the board grows: a word that had two drawn moves when it was first asked
 * about has four once the player names something beside it, and the two new ones are then
 * there to be bought. Marks are remembered by the pair rather than counted, so the ones
 * already paid for stay where they are when that happens.
 */
export function useMoveHint(
  state: GameState,
  word: string,
  near: readonly string[],
): GameState {
  // The goal counts as standing on it. It used to be the one word that sold the shape of a
  // move without being reachable, which was the substitute for not being able to work from
  // that end; now a tap stands there instead and the mark would be selling what a guess from
  // the goal shows for free.
  if (isFront(state, word)) return state;
  // Both directions, because the mark is drawn on the *edge*: a move bought from one end is
  // already on the board when the player asks from the other, and charging again for a mark
  // that is already there is a click that buys nothing.
  const next = near.find(
    (other) =>
      !state.edgeHints.has(moveKey(word, other)) &&
      !state.edgeHints.has(moveKey(other, word)),
  );
  if (next === undefined) return state;
  return {
    ...state,
    edgeHints: new Set(state.edgeHints).add(moveKey(word, next)),
  };
}

/**
 * A given-away move, as **the word it was asked about and how you get there**, or null if that
 * move has not been bought.
 *
 * The mark belongs to the word, not to the line: it is drawn beside `at`, and says whether
 * arriving at `at` along this move *adds* letters or *removes* them. Which is the only reading
 * that survives being looked at — a sign floating between two words is a claim with no
 * direction in it, and a sign that describes the move away from the word you asked about
 * answers a question nobody asked.
 *
 * So: `cons ————— + contractions` reads "you get to `contractions` from here by adding", and
 * the `+` sits against `contractions` because that is the word it is about.
 *
 * Either end is accepted, because a move bought from one end is not for sale again from the
 * other.
 */
export function moveHint(
  state: GameState,
  a: string,
  b: string,
): { at: string; other: string; kind: "add" | "remove" } | null {
  const at = state.edgeHints.has(moveKey(a, b))
    ? a
    : state.edgeHints.has(moveKey(b, a))
      ? b
      : null;
  if (at === null) return null;
  const other = at === a ? b : a;
  return { at, other, kind: at.length > other.length ? "add" : "remove" };
}

/**
 * A game in progress, in a form that survives being written down.
 *
 * Only what cannot be derived. `revealed` is the source plus whatever the logged moves
 * landed on, `guesses` is how many *orders* the log holds — one guess can be several moves,
 * see `advance` — and `solved` is whether those moves join the source to the goal, so
 * storing those too would be storing the same facts twice and inviting them to disagree. What
 * is left is the log, where the cursor is (moving it costs nothing, so it leaves no trace in
 * the log), and the two tallies that are not about words at all.
 */
export interface GameSnapshot {
  log: LogEntry[];
  selected: string;
  misses: number;
  /** Word and level, as pairs. The tally is derived from the levels. */
  hints: [string, number][];
  /**
   * Hints whose word is not in `hints` because it has since been named. Absent everywhere but
   * a game rebuilt from a shared link — see `GameState.spentHints`.
   */
  spentHints?: number;
  /** Moves given away, as `"from to"`. Absent in games saved before they existed. */
  edgeHints?: string[];
}

export function snapshot(state: GameState): GameSnapshot {
  return {
    log: state.log,
    selected: state.selected,
    misses: state.misses,
    hints: [...state.hints],
    ...(state.spentHints > 0 ? { spentHints: state.spentHints } : {}),
    edgeHints: [...state.edgeHints],
  };
}

/**
 * Rebuild a game from a snapshot, or start a fresh one.
 *
 * Total by construction: what `replay` cannot make sense of is dropped rather than trusted,
 * and so is everything below. A snapshot is a string that was in a browser for a month, and a
 * half-restored map that crashes the board is a far worse outcome than a game that quietly
 * starts again.
 *
 * `spell` is how a token is written, for clamping the hint levels — see `Spell` in hints.ts.
 * Left out, a word is its own spelling, which is the letters game.
 */
export function restore(
  puzzle: Puzzle,
  saved: GameSnapshot | null | undefined,
  spell: Spell = ITSELF,
): GameState {
  const fresh = newGame(puzzle);
  if (!saved) return fresh;

  // The goal is the one place a move may start from without having been reached.
  const found = replay(saved.log, puzzle.source, new Set([puzzle.target]));

  // Levels are clamped to what the word can actually give: a stored 40 on a
  // five-letter word would otherwise inflate the hint tally for ever.
  const hints = new Map<string, number>();
  for (const pair of Array.isArray(saved.hints) ? saved.hints : []) {
    const [word, level] = Array.isArray(pair) ? pair : [];
    if (typeof word !== "string" || !Number.isFinite(level)) continue;
    const wanted = Math.min(
      Math.max(1, Math.trunc(level as number)),
      hintLevels(word, spell),
    );
    hints.set(word, wanted);
  }

  // A given-away move, as written down: two words with a space between them. Nothing here
  // checks that the pair is a move — the board decides what it can draw a mark on, and a pair
  // that is no longer an edge simply never gets drawn.
  const edgeHints = new Set<string>();
  for (const key of Array.isArray(saved.edgeHints) ? saved.edgeHints : []) {
    if (typeof key !== "string") continue;
    const [from, to] = key.split(" ");
    if (from && to && from !== to) edgeHints.add(moveKey(from, to));
  }

  return {
    puzzle,
    ...found,
    selected:
      found.revealed.has(saved.selected) || saved.selected === puzzle.target
        ? saved.selected
        : puzzle.source,
    misses: Number.isFinite(saved.misses)
      ? Math.max(0, Math.trunc(saved.misses))
      : 0,
    solved: joins(puzzle.source, puzzle.target, found.log),
    hints,
    // Levels for words the figure no longer shows, which only a shared link carries. Read the
    // way every other stored number is: a value that is not a sane count buys nothing.
    spentHints: Number.isFinite(saved.spentHints)
      ? Math.max(0, Math.trunc(saved.spentHints as number))
      : 0,
    edgeHints,
  };
}

/**
 * Has anything happened here worth remembering?
 *
 * True of a finished game as well as a half-played one, and that is the point: the
 * completed view — the score, the trail, the thing to paste — has to be there when
 * the player comes back to a board they already solved.
 */
export function worthKeeping(state: GameState): boolean {
  return (
    state.log.length > 0 ||
    state.misses > 0 ||
    state.hints.size > 0 ||
    state.edgeHints.size > 0
  );
}
