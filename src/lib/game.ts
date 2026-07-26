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

/** Legal next words from the selected node that the player has not found yet. */
export function undiscoveredMoves(state: GameState, graph: Graph): readonly Move[] {
  return graph.movesFrom(state.selected).filter((m) => !state.revealed.has(m.to));
}
