/**
 * Loading the puzzle data.
 *
 * Three files, fetched together, ~850KB gzipped in total and then cached by the
 * browser for good — they are immutable until the data is rebuilt.
 *
 * `dictionary.json` is the ~188k-word list of everything a player may guess. It
 * is also the index the edge list refers to, so the graph never repeats a word.
 * `graph.json` is 269k edges as delta-encoded index pairs into it.
 * `puzzles.json` is the bank.
 * `common.json` says which dictionary words are ordinary ones — the board is drawn
 * from those alone, while a guess may be any word at all.
 *
 * All four are needed before the first guess can be judged, so there is nothing
 * to gain from staging them.
 */

import { buildGraph } from './graph';
import type { Graph, Puzzle, RawDictionary, RawGraph, RawPuzzles } from './types';

const base = import.meta.env.BASE_URL ?? '/';

async function getJson<T>(name: string): Promise<T> {
  const res = await fetch(`${base}data/${name}`);
  if (!res.ok) throw new Error(`could not load ${name}: ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

export interface GameData {
  graph: Graph;
  puzzles: Puzzle[];
  /** How far off optimal a drawn route may be, and how many words may be drawn. */
  drawSlack: number;
  drawMax: number;
}

export async function loadGameData(): Promise<GameData> {
  const [rawDict, rawGraph, rawPuzzles, rawCommon] = await Promise.all([
    getJson<RawDictionary>('dictionary.json'),
    getJson<RawGraph>('graph.json'),
    getJson<RawPuzzles>('puzzles.json'),
    getJson<{ common: number[] }>('common.json'),
  ]);
  const words = rawDict.words.split('\n');
  // Delta-encoded indices into the dictionary, the same trick the edge list uses.
  const common = new Set<string>();
  let at = 0;
  for (const delta of rawCommon.common) {
    at += delta;
    const word = words[at];
    if (word !== undefined) common.add(word);
  }
  return {
    graph: buildGraph(rawGraph, words, common),
    puzzles: rawPuzzles.puzzles,
    drawSlack: rawPuzzles.params.drawSlack,
    drawMax: rawPuzzles.params.drawMax,
  };
}
