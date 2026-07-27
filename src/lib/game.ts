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
  /** Words whose letter count the player has spent a hint on. */
  hinted: Set<string>;
  log: LogEntry[];
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
    hinted: new Set(),
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

/** Spend a hint to learn how many letters an unrevealed word has. */
export function useHint(state: GameState, word: string): GameState {
  if (state.revealed.has(word) || state.hinted.has(word)) return state;
  return { ...state, hinted: new Set(state.hinted).add(word) };
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
  hinted: string[];
}

export function snapshot(state: GameState): GameSnapshot {
  return {
    log: state.log,
    selected: state.selected,
    misses: state.misses,
    hinted: [...state.hinted],
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

  const hinted = Array.isArray(saved.hinted) ? saved.hinted : [];
  return {
    puzzle,
    revealed,
    log,
    selected: revealed.has(saved.selected) ? saved.selected : puzzle.source,
    guesses: log.length,
    misses: Number.isFinite(saved.misses) ? Math.max(0, Math.trunc(saved.misses)) : 0,
    solved: revealed.has(puzzle.target),
    hinted: new Set(hinted.filter((word) => typeof word === 'string')),
  };
}

/** Has anything happened here worth remembering? */
export function inProgress(state: GameState): boolean {
  return state.log.length > 0 || state.misses > 0 || state.hinted.size > 0;
}
