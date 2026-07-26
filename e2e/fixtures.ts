/**
 * Test fixtures read the shipped data from disk and reason about it with the
 * same library the game uses. That way a test knows the real answer to a real
 * puzzle without hard-coding words that a data rebuild would invalidate.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildGraph, shortestPath, shortestPathNodes } from '../src/lib/graph';
import type { Graph, Puzzle, RawDictionary, RawGraph, RawPuzzles } from '../src/lib/types';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'public', 'data');

function read<T>(name: string): T {
  return JSON.parse(readFileSync(join(dataDir, name), 'utf8')) as T;
}

/**
 * The shipped graph, built the way the app builds it — including the common word
 * list, without which every word counts as ordinary and the board under test is
 * not the board that ships.
 */
function realGraph() {
  const words = read<RawDictionary>('dictionary.json').words.split('\n');
  const common = new Set<string>();
  let at = 0;
  for (const delta of read<{ common: number[] }>('common.json').common) {
    at += delta;
    const word = words[at];
    if (word !== undefined) common.add(word);
  }
  return buildGraph(read<RawGraph>('graph.json'), words, common);
}

let cached: { graph: Graph; puzzles: Puzzle[] } | null = null;

export function gameData() {
  cached ??= {
    graph: realGraph(),
    puzzles: read<RawPuzzles>('puzzles.json').puzzles,
  };
  return cached;
}

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
