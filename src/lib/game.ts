/**
 * Game state, as pure functions over an immutable snapshot.
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

import { PLAIN, type Lexicon } from "./lexicon";
import { judgeGuess } from "./moves";
import type { Graph, Judgement, Move, Puzzle, Revealed } from "./types";

export interface LogEntry {
  from: string;
  to: string;
  move: Move;
  /** Guess number this was, 1-based. */
  order: number;
}

export interface GameState {
  puzzle: Puzzle;
  /** Words the player has *reached*. The goal is not one of them until they arrive at it. */
  revealed: Map<string, Revealed>;
  /** The word new guesses are made from — a revealed one or the goal. See `isFront`. */
  selected: string;
  guesses: number;
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
  log: LogEntry[];
}

/** The key a given-away move is remembered by, and drawn from. Directed. */
export function moveKey(from: string, to: string): string {
  return `${from} ${to}`;
}

/**
 * The key a move *made* is remembered by. **Undirected**, unlike `moveKey`.
 *
 * The two exist for opposite reasons and the difference is the point. A hint on a move is
 * about the word that was asked, so which end it was asked from is the whole content of it.
 * A move the player made is a move in both directions at once — the letters came out going
 * one way and would go back in going the other — so `a b` and `b a` are one entry, and the
 * game must not charge twice or draw twice for one thing.
 */
export function edgeKey(a: string, b: string): string {
  return a < b ? `${a} ${b}` : `${b} ${a}`;
}

/**
 * Do the moves made join these two words?
 *
 * A walk of the log, which is a handful of edges — nothing here is worth an index. The
 * source and the goal are both roots of the search space, so this is asked of them and
 * answers whether the round is over: two halves that touch anywhere are one chain.
 */
function joins(from: string, to: string, log: readonly LogEntry[]): boolean {
  if (from === to) return true;
  const near = new Map<string, string[]>();
  for (const { from: a, to: b } of log) {
    if (!near.has(a)) near.set(a, []);
    if (!near.has(b)) near.set(b, []);
    near.get(a)!.push(b);
    near.get(b)!.push(a);
  }
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length > 0) {
    const at = queue.shift()!;
    for (const next of near.get(at) ?? []) {
      if (next === to) return true;
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return false;
}

/**
 * The order in which a word gives its letters up.
 *
 * Scattered, not front to back. A prefix is the one part of a word this game must
 * not hand over cheaply — words live inside other words, so `car·······` names the
 * family and most of the answer with it. A letter from the middle is a clue; the
 * first three letters are the solution.
 *
 * A function of the word, not a draw from `Math.random()`, because the order has to
 * be the same every time it is asked for. Two places depend on that:
 *
 * - A reload has to redraw the board exactly. The snapshot stores a level per word
 *   and nothing else, so the positions have to be recoverable from the word.
 * - `hintLabel` is called while rendering each node, so it has to be pure. Drawing
 *   at random per call would give the same word different letters from one render to
 *   the next, and the board re-renders whenever the layout is moving.
 *
 * The alternative is to choose positions at click time and store them in the
 * snapshot, which would make two players see a word differently. It costs a storage
 * version and a longer snapshot, and buys nothing this needs.
 */
const orders = new Map<string, number[]>();

function revealOrder(word: string): number[] {
  const cached = orders.get(word);
  if (cached) return cached;

  // FNV-1a, then xorshift32: a couple of lines of arithmetic that scatter well
  // enough for this. Nothing here is a secret — the point is an order that looks
  // arbitrary and stays put, not one nobody can predict.
  let seed = 0x811c9dc5;
  for (let i = 0; i < word.length; i++) {
    seed = ((seed ^ word.charCodeAt(i)) * 0x01000193) >>> 0;
  }
  const next = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 0x100000000;
  };

  const order = [...word].map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  orders.set(word, order);
  return order;
}

/**
 * How a word is *spelled*, for the purpose of hinting at it.
 *
 * **Hints are always about letters, in every game.** In the phonemes game a node is a
 * pronunciation, and everything else about it — the move, the graph, what a guess resolves to
 * — is phonemes; a hint is the exception, and has to be, because a hint is help naming the
 * word and nobody knows how many phonemes `thought` has or what `/θɔt/` looks like. Counting
 * five sounds at somebody is a riddle about IPA rather than a clue about the word.
 *
 * So everything below takes the *written* form, and the caller says what that is. The default
 * is the identity, which is exactly right for the letters game and is why nothing there — nor
 * any test written before this existed — has to know the seam is here at all. The phonemes
 * game passes `lexicon.label`.
 */
export type Spell = (word: string) => string;

const ITSELF: Spell = (word) => word;

/**
 * What a hint level gives away, and so what a click buys.
 *
 * Level 1 is the letter count. Every level after that turns up one more letter, in
 * the word's own scattered order, so level `1 + n` shows `n` letters and the last
 * level shows the lot. Progressive on purpose: a letter count is often all anyone
 * needs to place a word, and someone properly stuck can keep asking until the word
 * is simply there.
 *
 * **Takes the written form**, not the token — see `Spell`. The scattered order is a function
 * of the string it is given, so it scatters the *letters* and stays put across reloads for the
 * same reason it always did.
 */
export function hintLabel(word: string, level: number): string | null {
  if (level <= 0) return null;
  if (level === 1) return String(word.length);
  const shown = new Set(
    revealOrder(word).slice(0, Math.min(level - 1, word.length)),
  );
  return [...word].map((letter, i) => (shown.has(i) ? letter : "·")).join("");
}

/**
 * Levels a word has to give: the count, then one per letter.
 *
 * Of the *written* form, which in the phonemes game is longer or shorter than the token it is
 * drawn for — `thought` is seven letters and three phonemes. Every cap on a level goes through
 * here, so the tally and what the board draws cannot disagree about when a word is spent.
 */
export function hintLevels(word: string, spell: Spell = ITSELF): number {
  return 1 + spell(word).length;
}

/** Has this word been spelled out completely? */
export function fullyHinted(
  word: string,
  level: number,
  spell: Spell = ITSELF,
): boolean {
  return level >= hintLevels(word, spell);
}

/**
 * Hints asked for, all told.
 *
 * The sum of the levels, because a level is exactly one click: nothing spends more
 * than one at a time. Dev mode's "spell this word out" deliberately does not go
 * through here at all — it is an inspection of the board, not help with it, and when
 * it *was* a hint one tap on a ten-letter word put ten on the tally.
 */
/**
 * What a round's hints came to: one per level of every word, one per move marked.
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
    revealed: new Map([
      [puzzle.source, { word: puzzle.source, via: null, move: null, order: 0 }],
    ]),
    selected: puzzle.source,
    guesses: 0,
    misses: 0,
    solved: false,
    hints: new Map(),
    spentHints: 0,
    edgeHints: new Set(),
    log: [],
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
 * A typed word can name several nodes and the cursor can only be on one — see `landing` in
 * `applyGuess`. Which of them the player has already seen is a question about the *figure*
 * rather than about the graph, so it comes from `plate.ts` through the caller rather than
 * being worked out here: the board grows as words are found, and only the thing drawing it
 * knows what is on it now.
 */
export interface Drawn {
  /** Words on a shortest route — the answer, and the line the board is laid out along. */
  spine: ReadonlySet<string>;
  /** Every word drawn, spine or not. */
  nodes: ReadonlySet<string>;
}

/**
 * One reading per token.
 *
 * The lexicon is decoded from a shipped file, and nothing downstream of it should have to
 * trust that a spelling lists each of its tokens once. Two readings of the same token are one
 * move: logged twice under one order they would draw one edge, restore as one — `restore`
 * drops a repeated edge — and leave a reload disagreeing with the game it restored.
 */
function dedupe(
  readings: { word: string; move: Move }[],
): { word: string; move: Move }[] {
  const seen = new Set<string>();
  const once: { word: string; move: Move }[] = [];
  for (const reading of readings) {
    if (seen.has(reading.word)) continue;
    seen.add(reading.word);
    once.push(reading);
  }
  return once;
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

  /*
    **Every reading the guess named, as one guess.**

    A typed word can name several tokens — see `also` on `Judgement` — and every one of them
    that makes a legal move from here is a move the player has just made. They all go on the
    board and the tally goes up by one, because the player typed one word: charging per
    pronunciation would charge for knowing less about the language, and adding only one of
    them was the bug this replaced. On `does → dissenters` the reading that happened to sort
    first was not the goal, so typing the goal's own name built a second node beside it and
    the round could not be finished.

    Readings whose move is already on the log are dropped rather than repeated — that is the
    same rule a repeated move has always had — and if *none* survives, the whole guess is the
    free navigation it always was.
  */
  const readings = dedupe([
    { word: judgement.word, move: judgement.move },
    ...judgement.also,
  ]);
  const known = new Set(
    state.log.map((entry) => edgeKey(entry.from, entry.to)),
  );
  const fresh = readings.filter(
    ({ word }) => !known.has(edgeKey(state.selected, word)),
  );

  /*
    Which reading the cursor ends up on, and which one the guess bar reports.

    **The one already most a part of the board wins**, in four tiers:

      an endpoint  — the goal or the word they started from. It finishes the round, and
                     standing anywhere else after playing it reads as being ignored.
      on the spine — a word on a shortest route: the answer, which is what the board is
                     laid out along and what the player is looking for.
      drawn        — already on the board somewhere, so they have seen it and it has a place.
      new          — a node this guess has just brought into existence.

    Because a guess that names several tokens usually names one the player meant and one they
    have never heard of, and landing on the new one leaves them somewhere off to the side
    wondering what happened. Ties go to the first reading, which is the most familiar one —
    the lexicon orders them.

    `drawn` is the caller's, because which words are on the board is `plate.ts`'s question and
    the answer changes as the board grows. Without it only the endpoint tier can be told
    apart, which is the letters game and every test written before any of this.
  */
  const rank = ({ word }: { word: string }) =>
    word === state.puzzle.target || word === state.puzzle.source
      ? 0
      : drawn?.spine.has(word)
        ? 1
        : drawn?.nodes.has(word)
          ? 2
          : 3;
  const landing = (from: readonly { word: string; move: Move }[]) =>
    from.reduce((best, one) => (rank(one) < rank(best) ? one : best), from[0]!);

  if (fresh.length === 0) {
    // Free: walking back along a move you already made is navigation, not progress. Asked the
    // same question as a fresh guess, so re-typing a word puts the cursor where typing it the
    // first time did.
    const already = landing(readings);
    return {
      kind: "already-known",
      state: { ...state, selected: already.word },
      move: already.move,
      word: already.word,
    };
  }

  /*
    The landed reading goes **first on the log**, so that "the moves of guess N" and "what
    guess N did" can be read off the same list: anything wanting one word per guess takes the
    first entry of each order. See `guessedWords`, the trail in App's `result`, and the word
    table in `recordOf`.
  */
  const landed = landing(fresh);
  const made = [landed, ...fresh.filter((one) => one.word !== landed.word)];

  const order = state.guesses + 1;
  // A word already named keeps the entry it arrived with: `via` and `order` record how it
  // was *first* reached, and a second way in is a move rather than another arrival.
  const revealed = new Map(state.revealed);
  for (const { word, move } of made) {
    if (!revealed.has(word))
      revealed.set(word, { word, via: state.selected, move, order });
  }
  const log = [
    ...state.log,
    ...made.map(({ word, move }) => ({
      from: state.selected,
      to: word,
      move,
      order,
    })),
  ];
  const solved = joins(state.puzzle.source, state.puzzle.target, log);

  return {
    kind: "revealed",
    move: landed.move,
    word: landed.word,
    solved,
    state: {
      ...state,
      revealed,
      selected: landed.word,
      guesses: order,
      solved,
      log,
    },
  };
}

/**
 * Does this log entry begin a new guess, or belong to the one before it?
 *
 * **The one definition of what a guess is**, because three things need it and they must not
 * disagree: `restore` numbers the guesses, `guessedWords` counts them, and `actionsOf` in
 * actions.ts writes them down for a shared board. A typed word can name several tokens and put
 * a move on the log for each — see `applyGuess` — so the log is longer than the tally, and a
 * consumer that grouped it differently would hand back a different score.
 *
 * An entry belongs to the guess before it when it carries the same order *and* the same word
 * moved from. The `from` matters because every move of one guess is made from where the player
 * was standing: two genuinely separate guesses that both claim one order — which nothing here
 * writes, but a hand-edited snapshot could — then still count as two. That is the direction
 * worth guarding, since merging two invents a better score than was played.
 *
 * A `NaN` order is never equal to itself, so an entry whose order did not survive being
 * written down begins a guess of its own. That is `restore` wanting a number it cannot trust
 * to buy nothing, and it falls out of the comparison rather than needing a case.
 */
export function newGuess(
  entry: { order: number; from: string },
  before: { order: number; from: string } | undefined,
): boolean {
  return (
    before === undefined ||
    entry.order !== before.order ||
    entry.from !== before.from
  );
}

/**
 * The word each guess landed on, in order: one per guess, however many moves it made.
 *
 * Anything counting *guesses* rather than moves has to come through here: the shared trail is
 * "one mark per guess" and the word table is about words the player typed, and both read as
 * double-counting otherwise. The first entry of each guess is the one it landed on, which
 * `applyGuess` guarantees.
 */
export function guessedWords(log: readonly LogEntry[]): string[] {
  return log
    .filter((entry, at) => newGuess(entry, log[at - 1]))
    .map((entry) => entry.to);
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
 * see `applyGuess` — and `solved` is whether those moves join the source to the goal, so
 * storing those too would be storing the same facts twice and inviting them to disagree. What is left is the log, where the cursor is (moving it costs
 * nothing, so it leaves no trace in the log), and the two tallies that are not about words
 * at all.
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

function isMove(value: unknown): value is Move {
  const move = value as Move | null;
  return (
    typeof move === "object" &&
    move !== null &&
    typeof move.sub === "string" &&
    typeof move.pos === "number" &&
    (move.kind === "add" || move.kind === "remove")
  );
}

/**
 * Rebuild a game from a snapshot, or start a fresh one.
 *
 * Total by construction: anything that does not make sense is dropped rather
 * than trusted. A snapshot is a string that was in a browser for a month — it
 * may have been written by an older version, or by a bank in which one of these
 * words no longer exists, and a half-restored map that crashes the board is a
 * far worse outcome than a game that quietly starts again.
 *
 * A move is replayed only if it starts somewhere the player could have been standing — a
 * word already revealed, or the goal — so the trail stays connected to one end or the other
 * however mangled the input. A move that repeats one already replayed is dropped, because
 * the game does not charge for those and a snapshot that claims two of them would inflate
 * the score.
 *
 * `spell` is how a token is written, for clamping the hint levels — see `Spell`. Left out, a
 * word is its own spelling, which is the letters game.
 */
export function restore(
  puzzle: Puzzle,
  saved: GameSnapshot | null | undefined,
  spell: Spell = ITSELF,
): GameState {
  const fresh = newGame(puzzle);
  if (!saved) return fresh;

  const revealed = new Map(fresh.revealed);
  const log: LogEntry[] = [];
  const made = new Set<string>();
  /*
    **One guess can be several moves, so the count is guesses and not entries.**

    `newGuess` is the definition, shared with everything else that has to agree about it. The
    stored order is read for its *grouping* and never for its value: the counter goes up
    whenever a guess begins, so entries dropped below leave no gap, a snapshot written before
    any of this — where every entry has its own order — restores exactly as it always did, and
    a number somebody typed into `localStorage` cannot run the tally anywhere.

    Compared against the last entry *kept*, not the last one read: dropping an entry costs a
    guess and is conservative, while letting a dropped one break up a group would invent one.
  */
  let previous: { order: number; from: string } | undefined;
  let order = 0;
  for (const entry of Array.isArray(saved.log) ? saved.log : []) {
    if (!entry || typeof entry.to !== "string" || !isMove(entry.move)) continue;
    // A move from a word to itself is not a move. It cannot be typed — an empty edit is
    // refused — but a hand-edited snapshot could claim one, and it would cost a guess.
    if (entry.from === entry.to) continue;
    if (!revealed.has(entry.from) && entry.from !== puzzle.target) continue;
    const key = edgeKey(entry.from, entry.to);
    if (made.has(key)) continue;
    made.add(key);
    const here = {
      order: Number.isFinite(entry.order) ? Number(entry.order) : NaN,
      from: entry.from,
    };
    if (newGuess(here, previous)) order += 1;
    previous = here;
    if (!revealed.has(entry.to)) {
      revealed.set(entry.to, {
        word: entry.to,
        via: entry.from,
        move: entry.move,
        order,
      });
    }
    log.push({ from: entry.from, to: entry.to, move: entry.move, order });
  }
  const guesses = order;

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
    revealed,
    log,
    selected:
      revealed.has(saved.selected) || saved.selected === puzzle.target
        ? saved.selected
        : puzzle.source,
    guesses,
    misses: Number.isFinite(saved.misses)
      ? Math.max(0, Math.trunc(saved.misses))
      : 0,
    solved: joins(puzzle.source, puzzle.target, log),
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
