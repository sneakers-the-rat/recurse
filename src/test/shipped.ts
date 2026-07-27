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
import { decodeGameData, type GameData, type RawCommon, type RawDictionary, type RawGraph, type RawPuzzles } from '../lib/data';
import type { PlateOptions } from '../lib/plate';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'data');

const read = <T,>(name: string): T =>
  JSON.parse(readFileSync(join(dataDir, name), 'utf8')) as T;

let cached: GameData | null = null;

export function shippedData(): GameData {
  cached ??= decodeGameData({
    dictionary: read<RawDictionary>('dictionary.json'),
    graph: read<RawGraph>('graph.json'),
    puzzles: read<RawPuzzles>('puzzles.json'),
    common: read<RawCommon>('common.json'),
  });
  return cached;
}

/** The budget the client actually draws with, not selection's wider measure. */
export function drawOptions(data: GameData): PlateOptions {
  return { slack: data.drawSlack, maxDrawn: data.drawMax };
}
