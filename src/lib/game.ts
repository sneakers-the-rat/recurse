/**
 * Game state, as pure functions over an immutable snapshot.
 *
 * The rules, as they stand:
 *  - You start with the source word revealed and selected.
 *  - You may guess from *any* revealed word, not just the last one, so the game
 *    is exploring a graph rather than walking a chain.
 *  - A legal move to a new word reveals it and costs one guess.
 *  - A legal move to a word already revealed costs nothing. It tells you nothing
 *    you did not know, and charging for it would punish navigating your own map.
 *  - An illegal guess costs nothing but is counted as a miss, so the cost of
 *    flailing is visible without being punitive.
 *  - Score is the guess count; par is the shortest path.
 *  - Hints are unlimited and counted. Asking is not cheating — this is not a
 *    competitive game, and "10 guesses, 10,000 hints" is a fine thing to post —
 *    but it is the other half of a score, so every click is tallied and shared.
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
  revealed: Map<string, Revealed>;
  /** The revealed word new guesses are made from. */
  selected: string;
  guesses: number;
  misses: number;
  solved: boolean;
  /**
   * How far each unnamed word has been given away, by hint level. Absent means
   * nothing has been asked about it. See `hintLabel` for what each level shows.
   */
  hints: Map<string, number>;
  log: LogEntry[];
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
  let total = 0;
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
    log: [],
  };
}

export type GuessOutcome =
  | { kind: 'revealed'; state: GameState; move: Move; word: string; solved: boolean }
  | { kind: 'already-known'; state: GameState; move: Move; word: string }
  | { kind: 'rejected'; state: GameState; judgement: Extract<Judgement, { ok: false }> };

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

  if (state.revealed.has(word)) {
    // Free: re-deriving a word you already have is navigation, not progress.
    return {
      kind: 'already-known',
      state: { ...state, selected: word },
      move,
      word,
    };
  }

  const order = state.guesses + 1;
  const revealed = new Map(state.revealed);
  revealed.set(word, { word, via: state.selected, move, order });
  const solved = word === state.puzzle.target;

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
      solved: state.solved || solved,
      log: [...state.log, { from: state.selected, to: word, move, order }],
    },
  };
}

/** Move the cursor to another already-revealed word. */
export function select(state: GameState, word: string): GameState {
  if (!state.revealed.has(word) || word === state.selected) return state;
  return { ...state, selected: word };
}

/**
 * Ask for one more hint about an unnamed word.
 *
 * No limit, but no free clicks either: once the word is spelled out there is
 * nothing left to give, so the level stops there rather than running the tally up
 * for nothing. A word already named is not a question.
 */
export function useHint(state: GameState, word: string): GameState {
  if (state.revealed.has(word)) return state;
  const level = state.hints.get(word) ?? 0;
  const wanted = Math.min(level + 1, hintLevels(word));
  if (wanted === level) return state;
  return { ...state, hints: new Map(state.hints).set(word, wanted) };
}

/**
 * A game in progress, in a form that survives being written down.
 *
 * Only what cannot be derived. `revealed` is exactly the source plus one entry
 * per logged move, `guesses` is the log's length, and `solved` is whether the
 * target is among them — so storing those too would be storing the same facts
 * twice and inviting them to disagree. What is left is the log, where the cursor
 * is (moving it costs nothing, so it leaves no trace in the log), and the two
 * tallies that are not about words at all.
 */
export interface GameSnapshot {
  log: LogEntry[];
  selected: string;
  misses: number;
  /** Word and level, as pairs. The tally is derived from the levels. */
  hints: [string, number][];
}

export function snapshot(state: GameState): GameSnapshot {
  return {
    log: state.log,
    selected: state.selected,
    misses: state.misses,
    hints: [...state.hints],
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
 * A move is replayed only if it starts from a word already revealed, so the trail
 * stays a connected chain back to the source however mangled the input.
 */
export function restore(puzzle: Puzzle, saved: GameSnapshot | null | undefined): GameState {
  const fresh = newGame(puzzle);
  if (!saved) return fresh;

  const revealed = new Map(fresh.revealed);
  const log: LogEntry[] = [];
  for (const entry of Array.isArray(saved.log) ? saved.log : []) {
    if (!entry || !revealed.has(entry.from) || revealed.has(entry.to)) continue;
    if (typeof entry.to !== 'string' || !isMove(entry.move)) continue;
    const order = log.length + 1;
    revealed.set(entry.to, { word: entry.to, via: entry.from, move: entry.move, order });
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

  return {
    puzzle,
    revealed,
    log,
    selected: revealed.has(saved.selected) ? saved.selected : puzzle.source,
    guesses: log.length,
    misses: Number.isFinite(saved.misses) ? Math.max(0, Math.trunc(saved.misses)) : 0,
    solved: revealed.has(puzzle.target),
    hints,
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
  return state.log.length > 0 || state.misses > 0 || state.hints.size > 0;
}
