/**
 * The shipped data files, and the only place that knows their shape.
 *
 * Four files, written by tools/graphgen and fetched together, ~850KB gzipped in
 * total and then cached by the browser for good — they are immutable until the
 * data is rebuilt.
 *
 *   dictionary.json  every word a player may guess, newline-joined and sorted.
 *                    Also the canonical index the other two files refer to, so
 *                    no word is ever stored twice.
 *   graph.json       269k edges as delta-encoded index pairs into it.
 *   common.json      which of those words are ordinary ones. The board is drawn
 *                    from these alone; a guess may be any word at all.
 *   puzzles.json     the bank.
 *
 * All four are needed before the first guess can be judged, so there is nothing
 * to gain from staging them.
 *
 * Decoding is kept here, apart from `loadGameData`, because the browser is not
 * the only reader: the unit tests and the end-to-end fixtures read the same files
 * off disk and must build the same graph the app does. When each of them decoded
 * for itself they drifted — one forgot the common list, and its board was not the
 * board that ships.
 */

import { buildGraph } from './graph';
import type { Graph, GraphParams, Puzzle } from './types';

/** `dictionary.json`. */
export interface RawDictionary {
  words: string;
}

/**
 * `graph.json`.
 *
 * `edges` is a flat array of index pairs into the dictionary, with the first of
 * each pair delta-encoded. Subwords and positions are not stored; they are
 * derived from a word pair on demand. That keeps the edge list to 352KB gzipped
 * rather than 1,278KB.
 */
export interface RawGraph {
  params: GraphParams;
  edges: number[];
}

/** `common.json`: delta-encoded indices into the dictionary. */
export interface RawCommon {
  common: number[];
}

/** `puzzles.json`. */
export interface RawPuzzles {
  params: {
    /** Selection's neighbourhood measure on the common graph. Not a draw budget. */
    slack: number;
    /** What the board draws, on the legal graph. See .env. */
    drawSlack: number;
    drawMax: number;
    minPar: number;
    maxPar: number;
  };
  puzzles: Puzzle[];
}

/** The four files, however they were obtained. */
export interface RawFiles {
  dictionary: RawDictionary;
  graph: RawGraph;
  puzzles: RawPuzzles;
  common: RawCommon;
}

export interface GameData {
  graph: Graph;
  puzzles: Puzzle[];
  /** How far off optimal a drawn route may be, and how many words may be drawn. */
  drawSlack: number;
  drawMax: number;
}

/**
 * Undo a running-sum encoding: each number is the step from the one before.
 *
 * Sorted indices delta-encode to small repeated integers, which gzip handles far
 * better than the absolute values. Both the common list and the first half of
 * each edge pair are written this way.
 */
export function decodeDeltas(flat: readonly number[]): number[] {
  const values: number[] = [];
  let at = 0;
  for (const delta of flat) {
    at += delta;
    values.push(at);
  }
  return values;
}

/** Undo the edge encoding: pairs of indices, first element as a running sum. */
export function decodeEdges(flat: readonly number[]): [number, number][] {
  const pairs: [number, number][] = [];
  let big = 0;
  for (let i = 0; i + 1 < flat.length; i += 2) {
    big += flat[i]!;
    pairs.push([big, flat[i + 1]!]);
  }
  return pairs;
}

/** Build the game's view of the data. The one definition every reader shares. */
export function decodeGameData(files: RawFiles): GameData {
  const words = files.dictionary.words.split('\n');
  const common = new Set<string>();
  for (const at of decodeDeltas(files.common.common)) {
    const word = words[at];
    if (word !== undefined) common.add(word);
  }
  return {
    graph: buildGraph(files.graph.params, words, decodeEdges(files.graph.edges), common),
    puzzles: files.puzzles.puzzles,
    drawSlack: files.puzzles.params.drawSlack,
    drawMax: files.puzzles.params.drawMax,
  };
}

async function getJson<T>(name: string): Promise<T> {
  // Read here rather than at module scope. Everything above this line has to work
  // outside a bundler — the Playwright fixtures import this module in plain Node
  // to read the shipped files off disk, and a top-level `import.meta.env.BASE_URL`
  // made the whole end-to-end suite die on load with "cannot read BASE_URL of
  // undefined", in a module it never actually calls.
  const base = import.meta.env?.BASE_URL ?? '/';
  const res = await fetch(`${base}data/${name}`);
  if (!res.ok) throw new Error(`could not load ${name}: ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

export async function loadGameData(): Promise<GameData> {
  const [dictionary, graph, puzzles, common] = await Promise.all([
    getJson<RawDictionary>('dictionary.json'),
    getJson<RawGraph>('graph.json'),
    getJson<RawPuzzles>('puzzles.json'),
    getJson<RawCommon>('common.json'),
  ]);
  return decodeGameData({ dictionary, graph, puzzles, common });
}
