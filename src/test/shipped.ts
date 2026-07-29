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
  shardForDay,
  shardName,
  type GameData,
  type RawCommon,
  type RawDictionary,
  type RawGraph,
  type RawManifest,
} from '../lib/data';
import { dayNumber } from '../lib/daily';
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

/** One shard, read off disk, decoded. */
export function shippedShard(index: number): Puzzle[] {
  const manifest = read<RawManifest>(join('puzzles', 'manifest.json'));
  const path = join(dataDir, 'puzzles', shardName(index, manifest.version));
  return decodeShard(readFileSync(path, 'utf8'));
}

/**
 * The shipped graph, with one shard's puzzles: **the shard the app has in memory today**.
 *
 * One shard rather than the bank, because that is what the app has and a test that quietly
 * had all 167,860 would not be testing the same thing. Use `shippedBank` where the whole
 * calendar is genuinely the subject.
 *
 * Which shard is not a constant, and taking it for one is what made every fixture that
 * mentions today wrong. This said shard 0, on the grounds that shard 0 holds day 0 — true,
 * and irrelevant, because shards are named by *id prefix* and `spread` put day N in shard
 * `N % 256`. So the shard holding today's board changes daily, a test asking this for
 * today's puzzle got a shard that does not contain it, and `puzzleForDay` correctly
 * answered null.
 */
export function shippedData(): GameData {
  if (!cached) {
    const manifest = read<RawManifest>(join('puzzles', 'manifest.json'));
    const shard = readFileSync(
      join(dataDir, 'puzzles', shardName(shardForDay(dayNumber(), manifest), manifest.version)),
      'utf8',
    );
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
