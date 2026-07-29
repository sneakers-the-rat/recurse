/**
 * The real shipped data, read off disk.
 *
 * Both the unit tests and the end-to-end fixtures need the board the app
 * actually draws, and the only way to be sure of that is to build it the way the
 * app does — same files, same decoder, `common.json` included. Each of them used
 * to do it for itself, which is how one of them ended up testing a graph in which
 * every word counted as ordinary.
 *
 * Memoised, because building the graph costs about a second and every test in a
 * file wants the same one.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  decodeGameData,
  decodeShard,
  shardName,
  type GameData,
  type RawCommon,
  type RawDictionary,
  type RawGraph,
  type RawManifest,
} from '../lib/data';
import type { Puzzle } from '../lib/types';
import type { PlateOptions } from '../lib/plate';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'data');

const read = <T,>(name: string): T =>
  JSON.parse(readFileSync(join(dataDir, name), 'utf8')) as T;

let cached: GameData | null = null;

/**
 * Every shard, read off disk.
 *
 * The browser fetches one; a test asking whether *every* puzzle in the bank draws a
 * sound board needs all of them, and reading 10MB from a local disk is a fraction of
 * the second the graph costs anyway.
 */
export function shippedBank(): Puzzle[] {
  const manifest = read<RawManifest>(join('puzzles', 'manifest.json'));
  const puzzles: Puzzle[] = [];
  for (let index = 0; index < manifest.shards; index++) {
    const path = join(dataDir, 'puzzles', shardName(index, manifest.version));
    puzzles.push(...decodeShard(readFileSync(path, 'utf8')));
  }
  return puzzles;
}

/**
 * The shipped graph, with one shard's puzzles.
 *
 * One shard rather than the bank, because that is what the app has in memory and a
 * test that quietly had all 174,536 would not be testing the same thing. Use
 * `shippedBank` where the whole calendar is genuinely the subject.
 */
export function shippedData(): GameData {
  if (!cached) {
    const manifest = read<RawManifest>(join('puzzles', 'manifest.json'));
    // Shard 00 holds day 0, so this is the board a fresh calendar opens on.
    const shard = readFileSync(join(dataDir, 'puzzles', shardName(0, manifest.version)), 'utf8');
    cached = decodeGameData({
      dictionary: read<RawDictionary>('dictionary.json'),
      graph: read<RawGraph>('graph.json'),
      manifest,
      common: read<RawCommon>('common.json'),
      puzzles: decodeShard(shard),
    });
  }
  return cached;
}

/**
 * How a puzzle asks to be drawn: the words it declares, and nothing else.
 *
 * Takes the puzzle rather than the data, because the board is a property of the puzzle now
 * rather than a budget shared by all of them.
 */
export function drawOptions(puzzle: Puzzle): PlateOptions {
  return { board: puzzle.board };
}
