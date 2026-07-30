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

import { judgeGuess } from './moves';
import type { Graph, Judgement, Move, Puzzle, Revealed } from './types';

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
 * What a hint level gives away, and so what a click buys.
 *
 * Level 1 is the letter count. Every level after that turns up one more letter, in
 * the word's own scattered order, so level `1 + n` shows `n` letters and the last
 * level shows the lot. Progressive on purpose: a letter count is often all anyone
 * needs to place a word, and someone properly stuck can keep asking until the word
 * is simply there.
 */
export function hintLabel(word: string, level: number): string | null {
  if (level <= 0) return null;
  if (level === 1) return String(word.length);
  const shown = new Set(revealOrder(word).slice(0, Math.min(level - 1, word.length)));
  return [...word].map((letter, i) => (shown.has(i) ? letter : '·')).join('');
}

/** Levels a word has to give: the count, then one per letter. */
export function hintLevels(word: string): number {
  return 1 + word.length;
}

/** Has this word been spelled out completely? */
export function fullyHinted(word: string, level: number): boolean {
  return level >= hintLevels(word);
}

/**
 * Hints asked for, all told.
 *
 * The sum of the levels, because a level is exactly one click: nothing spends more
 * than one at a time. Dev mode's "spell this word out" deliberately does not go
 * through here at all — it is an inspection of the board, not help with it, and when
 * it *was* a hint one tap on a ten-letter word put ten on the tally.
 */
export function hintCount(state: GameState): number {
  let total = state.edgeHints.size;
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
    edgeHints: new Set(),
    log: [],
  };
}

export type GuessOutcome =
  | { kind: 'revealed'; state: GameState; move: Move; word: string; solved: boolean }
  | { kind: 'already-known'; state: GameState; move: Move; word: string }
  | { kind: 'rejected'; state: GameState; judgement: Extract<Judgement, { ok: false }> };

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

/** Apply a typed guess made from `state.selected`. */
export function applyGuess(
  state: GameState,
  graph: Graph,
  raw: string,
  isWord: ((word: string) => boolean) | null = null,
): GuessOutcome {
  const judgement = judgeGuess(graph, state.selected, raw, isWord);

  if (!judgement.ok) {
    return {
      kind: 'rejected',
      state: { ...state, misses: state.misses + 1 },
      judgement,
    };
  }

  const { move, word } = judgement;

  const key = edgeKey(state.selected, word);
  if (state.log.some((entry) => edgeKey(entry.from, entry.to) === key)) {
    // Free: walking back along a move you already made is navigation, not progress.
    return {
      kind: 'already-known',
      state: { ...state, selected: word },
      move,
      word,
    };
  }

  const order = state.guesses + 1;
  // A word already named keeps the entry it arrived with: `via` and `order` record how it
  // was *first* reached, and a second way in is a move rather than another arrival.
  const revealed = new Map(state.revealed);
  if (!revealed.has(word)) revealed.set(word, { word, via: state.selected, move, order });
  const log = [...state.log, { from: state.selected, to: word, move, order }];
  const solved = joins(state.puzzle.source, state.puzzle.target, log);

  return {
    kind: 'revealed',
    move,
    word,
    solved,
    state: {
      ...state,
      revealed,
      selected: word,
      guesses: order,
      solved,
      log,
    },
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
export function useHint(state: GameState, word: string): GameState {
  if (isFront(state, word)) return state;
  const level = state.hints.get(word) ?? 0;
  const wanted = Math.min(level + 1, hintLevels(word));
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
export function useMoveHint(state: GameState, word: string, near: readonly string[]): GameState {
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
      !state.edgeHints.has(moveKey(word, other)) && !state.edgeHints.has(moveKey(other, word)),
  );
  if (next === undefined) return state;
  return { ...state, edgeHints: new Set(state.edgeHints).add(moveKey(word, next)) };
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
): { at: string; other: string; kind: 'add' | 'remove' } | null {
  const at = state.edgeHints.has(moveKey(a, b)) ? a : state.edgeHints.has(moveKey(b, a)) ? b : null;
  if (at === null) return null;
  const other = at === a ? b : a;
  return { at, other, kind: at.length > other.length ? 'add' : 'remove' };
}

/**
 * A game in progress, in a form that survives being written down.
 *
 * Only what cannot be derived. `revealed` is the source plus whatever the logged moves
 * landed on, `guesses` is the log's length, and `solved` is whether those moves join the
 * source to the goal — so storing those too would be storing the same facts twice and
 * inviting them to disagree. What is left is the log, where the cursor is (moving it costs
 * nothing, so it leaves no trace in the log), and the two tallies that are not about words
 * at all.
 */
export interface GameSnapshot {
  log: LogEntry[];
  selected: string;
  misses: number;
  /** Word and level, as pairs. The tally is derived from the levels. */
  hints: [string, number][];
  /** Moves given away, as `"from to"`. Absent in games saved before they existed. */
  edgeHints?: string[];
}

export function snapshot(state: GameState): GameSnapshot {
  return {
    log: state.log,
    selected: state.selected,
    misses: state.misses,
    hints: [...state.hints],
    edgeHints: [...state.edgeHints],
  };
}

function isMove(value: unknown): value is Move {
  const move = value as Move | null;
  return (
    typeof move === 'object' &&
    move !== null &&
    typeof move.sub === 'string' &&
    typeof move.pos === 'number' &&
    (move.kind === 'add' || move.kind === 'remove')
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
 */
export function restore(puzzle: Puzzle, saved: GameSnapshot | null | undefined): GameState {
  const fresh = newGame(puzzle);
  if (!saved) return fresh;

  const revealed = new Map(fresh.revealed);
  const log: LogEntry[] = [];
  const made = new Set<string>();
  for (const entry of Array.isArray(saved.log) ? saved.log : []) {
    if (!entry || typeof entry.to !== 'string' || !isMove(entry.move)) continue;
    // A move from a word to itself is not a move. It cannot be typed — an empty edit is
    // refused — but a hand-edited snapshot could claim one, and it would cost a guess.
    if (entry.from === entry.to) continue;
    if (!revealed.has(entry.from) && entry.from !== puzzle.target) continue;
    const key = edgeKey(entry.from, entry.to);
    if (made.has(key)) continue;
    made.add(key);
    const order = log.length + 1;
    if (!revealed.has(entry.to)) {
      revealed.set(entry.to, { word: entry.to, via: entry.from, move: entry.move, order });
    }
    // Renumbered, not trusted: a dropped entry must not leave a gap in the count.
    log.push({ from: entry.from, to: entry.to, move: entry.move, order });
  }

  // Levels are clamped to what the word can actually give: a stored 40 on a
  // five-letter word would otherwise inflate the hint tally for ever.
  const hints = new Map<string, number>();
  for (const pair of Array.isArray(saved.hints) ? saved.hints : []) {
    const [word, level] = Array.isArray(pair) ? pair : [];
    if (typeof word !== 'string' || !Number.isFinite(level)) continue;
    const wanted = Math.min(Math.max(1, Math.trunc(level as number)), hintLevels(word));
    hints.set(word, wanted);
  }

  // A given-away move, as written down: two words with a space between them. Nothing here
  // checks that the pair is a move — the board decides what it can draw a mark on, and a pair
  // that is no longer an edge simply never gets drawn.
  const edgeHints = new Set<string>();
  for (const key of Array.isArray(saved.edgeHints) ? saved.edgeHints : []) {
    if (typeof key !== 'string') continue;
    const [from, to] = key.split(' ');
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
    guesses: log.length,
    misses: Number.isFinite(saved.misses) ? Math.max(0, Math.trunc(saved.misses)) : 0,
    solved: joins(puzzle.source, puzzle.target, log),
    hints,
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
