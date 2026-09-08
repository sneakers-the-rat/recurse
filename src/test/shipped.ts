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
  calendarName,
  idOnDay,
  shardOf,
  type GameData,
  type RawCommon,
  type RawDictionary,
  type RawGraph,
  type RawCalendar,
  type RawManifest,
} from '../lib/data';
import { dateForDay, dayIndex, dayNumber, dayOfYear } from '../lib/daily';
import type { RawLexicon } from '../lib/lexicon';
import type { Puzzle } from '../lib/types';
import type { PlateOptions } from '../lib/plate';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'data');

const read = <T,>(name: string): T =>
  JSON.parse(readFileSync(join(dataDir, name), 'utf8')) as T;

/** One entry per band asked for; a run of tests touches one or two. */
const cached = new Map<number, GameData>();

/**
 * Every shard, read off disk.
 *
 * The browser fetches one; a test asking whether *every* puzzle in the bank draws a
 * sound board needs all of them, and reading 10MB from a local disk is a fraction of
 * the second the graph costs anyway.
 */
export function shippedBank(mode?: number): Puzzle[] {
  const manifest = read<RawManifest>(join('puzzles', 'manifest.json'));
  const puzzles: Puzzle[] = [];
  for (let index = 0; index < manifest.shards; index++) {
    const path = join(dataDir, 'puzzles', shardName(index, manifest.version));
    puzzles.push(...decodeShard(readFileSync(path, 'utf8')));
  }
  // A shard holds every mode's puzzles, so anything measuring a *graph* has to say which game
  // it means — the letters graph knows nothing of a phonemes puzzle's endpoints, and asking it
  // about them quietly counts nothing rather than failing.
  if (mode === undefined) return puzzles;
  return puzzles.filter((puzzle) => manifest.bands[puzzle.band]?.mode === mode);
}

/** The bank the shipped files currently hold: its version, and how big it is. */
export function shippedVersion(): { version: string; puzzles: number } {
  const manifest = read<RawManifest>(join('puzzles', 'manifest.json'));
  return { version: manifest.version, puzzles: manifest.puzzles };
}

/** The modes the bank holds, in manifest order, with the first band of each. */
export function shippedModes(): { mode: number; name: string; band: number }[] {
  const manifest = read<RawManifest>(join('puzzles', 'manifest.json'));
  return manifest.modes.map((one, mode) => ({
    mode,
    name: one.name,
    band: manifest.bands.findIndex((band) => band.mode === mode),
  }));
}

/** One shard, read off disk, decoded. */
export function shippedShard(index: number): Puzzle[] {
  const manifest = read<RawManifest>(join('puzzles', 'manifest.json'));
  const path = join(dataDir, 'puzzles', shardName(index, manifest.version));
  return decodeShard(readFileSync(path, 'utf8'));
}

/** The manifest on its own, for tests that only want to know the shape of the calendar. */
export function shippedManifest(): RawManifest {
  return read<RawManifest>(join('puzzles', 'manifest.json'));
}

/** One calendar year, read off disk. See `RawCalendar`. */
export function shippedCalendar(year: number): RawCalendar {
  const manifest = shippedManifest();
  return read<RawCalendar>(join('puzzles', calendarName(year, manifest.version)));
}

/**
 * The id a band and day name, read off disk rather than fetched.
 *
 * `idForDay` in data.ts is the app's version and does the same arithmetic; it returns a promise
 * because in a browser the year file is a request. Tests want it synchronously.
 */
export function shippedIdForDay(band: number, day: number): string | null {
  const manifest = shippedManifest();
  const wrapped = dayIndex(day, manifest.days);
  const date = dateForDay(wrapped, manifest.epoch);
  const year = Number(date.slice(0, 4));
  if (year < manifest.years[0] || year > manifest.years[1]) return null;
  return idOnDay(shippedCalendar(year), band, dayOfYear(date));
}

/**
 * The shipped graph, with one shard's puzzles: **the shard the app has in memory today**,
 * for the length a fresh visit opens.
 *
 * One shard rather than the bank, because that is what the app has and a test that quietly
 * had all 115,145 would not be testing the same thing. Use `shippedBank` where the whole
 * calendar is genuinely the subject, and `shippedShard` for a particular one.
 *
 * Which shard is not a constant, and taking it for one is what made every fixture that
 * mentions today wrong. Shards are named by *id prefix*, and the builder put band `B` on day
 * `N` in shard `(N * 3 + B) % 256` — so the shard holding a board changes daily *and* with
 * the length, and a fixture that guesses gets a shard the puzzle it wants is not in.
 */
export const DEFAULT_BAND = 0;

/**
 * One mode's shipped data, with today's shard of the bank.
 *
 * **Per mode**, because a mode's three files live in a directory of its own and hold that
 * mode's alphabet — see *Modes* in CLAUDE.md. `DEFAULT_BAND` is a letters band, so the default
 * is the letters mode and every test written before there was more than one still means what
 * it did.
 */
export function shippedData(band: number = DEFAULT_BAND): GameData {
  const held = cached.get(band);
  if (held) return held;

  const manifest = read<RawManifest>(join('puzzles', 'manifest.json'));
  const shard = readFileSync(
    join(
      dataDir,
      'puzzles',
      shardName(
        shardOf(shippedIdForDay(band, dayNumber(new Date(), manifest.epoch)) ?? ''),
        manifest.version,
      ),
    ),
    'utf8',
  );
  const mode = manifest.bands[band]?.mode ?? 0;
  const dir = manifest.modes[mode]?.name ?? 'letters';
  const translated = manifest.modes[mode]?.alphabet !== 'letters';
  const built = decodeGameData({
    dictionary: read<RawDictionary>(join(dir, 'dictionary.json')),
    graph: read<RawGraph>(join(dir, 'graph.json')),
    manifest,
    mode,
    common: read<RawCommon>(join(dir, 'common.json')),
    lexicon: translated ? read<RawLexicon>(join(dir, 'lexicon.json')) : undefined,
    puzzles: decodeShard(shard),
  });
  cached.set(band, built);
  return built;
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
