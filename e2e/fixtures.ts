/**
 * Real puzzles and their real answers, derived rather than written down.
 *
 * These read the shipped data from disk (see src/test/shipped.ts) and reason
 * about it with the same library the game uses, so a test knows the answer to a
 * real puzzle without hard-coding words that a data rebuild would invalidate.
 */

import { shortestPath, shortestPathNodes } from '../src/lib/graph';
import { shippedData } from '../src/test/shipped';
import type { Puzzle } from '../src/lib/types';

export const gameData = shippedData;

export interface SolvedPuzzle {
  index: number;
  puzzle: Puzzle;
  /** Source first, target last. Length is par + 1. */
  path: string[];
  /**
   * A legal move from the source that is *not* on any shortest path — a real
   * wrong turn, as opposed to revisiting a word already found (which is free).
   */
  wrongTurn: string;
}

/**
 * A puzzle of the given par, with a shortest path and a genuine wrong turn.
 *
 * Both are derived from the shipped data using the game's own library, so tests
 * never hard-code words that a data rebuild would invalidate.
 *
 * Puzzles with a secret are skipped: their shortest path is shorter than par, so
 * walking it scores under par and the round ends in the secret state rather than
 * the ordinary one. `puzzleWithSecret` is for testing that.
 */
export function puzzleWithPar(par: number): SolvedPuzzle {
  const { graph, puzzles } = gameData();
  for (let index = 0; index < puzzles.length; index++) {
    const puzzle = puzzles[index]!;
    if (puzzle.par !== par || puzzle.secret !== 0) continue;
    const path = shortestPath(graph, puzzle.source, puzzle.target);
    if (!path || path.length !== par + 1) continue;
    const onRoute = shortestPathNodes(graph, puzzle.source, puzzle.target, par);
    const wrongTurn = graph.neighbors(puzzle.source).find((w) => !onRoute.has(w));
    if (wrongTurn) return { index, puzzle, path, wrongTurn };
  }
  throw new Error(`no puzzle with par ${par} and a wrong turn available`);
}

/** A puzzle par can be beaten on, with the route that beats it. */
export function puzzleWithSecret(): { index: number; puzzle: Puzzle; path: string[] } {
  const { graph, puzzles } = gameData();
  for (let index = 0; index < puzzles.length; index++) {
    const puzzle = puzzles[index]!;
    if (puzzle.secret === 0) continue;
    const path = shortestPath(graph, puzzle.source, puzzle.target);
    if (path && path.length - 1 === puzzle.secret) return { index, puzzle, path };
  }
  throw new Error('no puzzle with a secret available');
}
