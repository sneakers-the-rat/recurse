/**
 * The shipped data files, and the only place that knows their shape.
 *
 * Four files, written by tools/graphgen and fetched together, ~1.1MB gzipped in
 * total and then cached by the browser for good — they are immutable until the
 * data is rebuilt.
 *
 *   dictionary.json  every word a player may guess, newline-joined and sorted.
 *                    Also the canonical index the other two files refer to, so
 *                    no word is ever stored twice.
 *   graph.json       both graphs, as half of each neighbour row over those ids.
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

import { dateForDay, dayIndex, dayNumber, dayOfYear } from './daily';
import { buildGraph, type Rows } from './graph';
import type { Graph, GraphParams, Puzzle } from './types';

/** `dictionary.json`. */
export interface RawDictionary {
  words: string;
}

/**
 * `graph.json`: both graphs as half of each neighbour list.
 *
 * For every dictionary word, the neighbours whose id is greater than its own — so each
 * undirected edge is written once. Rows rather than an edge list because the browser
 * then has nothing to *assemble*, only to mirror, which is two passes over a typed
 * array. Subwords and positions are still not stored; they are derived from a word pair
 * on demand.
 */
export interface RawRows {
  /** How many neighbours above itself each word has. */
  counts: number[];
  /** Those neighbours, rows concatenated, ascending and delta-encoded within a row. */
  above: number[];
}

export interface RawGraph {
  params: GraphParams;
  legal: RawRows;
  /** The ordinary-word graph, as the builder computed it. Not re-derived here. */
  common: RawRows;
}

/** `common.json`: delta-encoded indices into the dictionary. */
export interface RawCommon {
  common: number[];
}

/**
 * `puzzles/manifest.json`: how to find a shard, and how much calendar there is.
 *
 * The only file whose name is fixed, so the only one a repeat visit has to ask the
 * network about. Everything it points at is immutable.
 */
export interface RawManifest {
  /** Digest of the whole bank, and part of every shard's filename. */
  version: string;
  shards: number;
  /**
   * The three lengths, in order: short, medium, long.
   *
   * The pars are what the band holds, which the header shows and which is
   * `RECURSE_BAND_CUTS` rather than anything the client decides. There is no per-band length
   * any more: every band runs the whole calendar, so the length is `days` below.
   */
  bands: {
    name: string;
    minPar: number;
    maxPar: number;
  }[];
  puzzles: number;
  /**
   * Day 0, as `YYYY-MM-DD`. Written down once, in `RECURSE_EPOCH`, because the builder names
   * its calendar files by calendar year and so counts days from the same place the browser
   * does. The client used to hard-code it; see `EPOCH` in daily.ts.
   */
  epoch: string;
  /** How many days the calendar runs. The longest band's length; every band fills all of it. */
  days: number;
  /** First and last calendar year on disk, inclusive. One file each. */
  years: [number, number];
  params: {
    /** Selection's neighbourhood measure on the common graph. Not a draw budget. */
    slack: number;
    minPar: number;
    maxPar: number;
  };
}

/** The files needed before a board can be drawn, however they were obtained. */
export interface RawFiles {
  dictionary: RawDictionary;
  graph: RawGraph;
  manifest: RawManifest;
  common: RawCommon;
  /** One shard's worth of puzzles: whichever shard the board being opened is in. */
  puzzles: Puzzle[];
}

export interface GameData {
  graph: Graph;
  /** The puzzles in the loaded shard, not the whole bank. */
  puzzles: Puzzle[];
  manifest: RawManifest;
}

// Nothing here bounds what a board draws. A puzzle carries the words it is drawn from, and a
// player who explores past them extends the figure as far as they like — see `Puzzle.board`.

/** Which shard an id belongs to: its first two hex digits. Mirrors id.rs. */
export function shardOf(id: string): number {
  return Number.parseInt(id.slice(0, 2), 16) || 0;
}

/**
 * The three lengths a day offers, mirrored from the builder's `BANDS`.
 *
 * Needed before the manifest arrives — the band a bare visit opens is read from storage on
 * the first render — and checked against `manifest.bands.length` everywhere after that.
 */
export const BANDS = 3;

/** What a band is called and what pars it holds. */
export function bandOf(band: number, manifest: RawManifest): RawManifest['bands'][number] {
  return (
    manifest.bands[band] ?? manifest.bands[0] ?? { name: 'short', minPar: 0, maxPar: 0 }
  );
}

/**
 * `puzzles/{year}-{version}.json`: which puzzles the days of one calendar year hold.
 *
 * **This is what a date means.** It replaced arithmetic: a day used to name its own shard, so
 * a date cost one fetch and no index — and the price was that a third of the bank had day
 * numbers no shard would ever be asked for, so a third of the bank could not be reached at
 * all. A file costs one more request than a formula and gives every puzzle a date.
 *
 * Keyed by the **real calendar year**, so it is the file a player's own date names and a year
 * that has been and gone is never rewritten. That is what makes these worth caching forever.
 *
 * The ids are one fixed-width run per band rather than an array of strings: a day is a slice at
 * `dayOfYear * idChars`, and a year is about 13 KB instead of 40 KB of commas and quotes. Same
 * trade as the delta-encoded graph rows.
 */
export interface RawCalendar {
  year: number;
  /** Day of the year the file starts at — the first year begins at the epoch, not in January. */
  from: number;
  idChars: number;
  /** One run of concatenated ids per band, in the same order as `manifest.bands`. */
  bands: string[];
}

/**
 * The id a band and day-of-year name, or null when this file does not cover that day.
 *
 * Null rather than a throw because the edges are ordinary: the epoch's own year starts in
 * July, the last year stops when the calendar does, and asking either for a day outside that
 * is what happens at the boundaries rather than a bug.
 */
export function idOnDay(
  calendar: RawCalendar,
  band: number,
  dayOfYear: number,
): string | null {
  const run = calendar.bands[band];
  if (run === undefined) return null;
  const at = (dayOfYear - calendar.from) * calendar.idChars;
  if (at < 0 || at + calendar.idChars > run.length) return null;
  return run.slice(at, at + calendar.idChars);
}

/**
 * Where a shard lives.
 *
 * The version is in the name, so a rebuilt bank is asked for at an address nobody has
 * cached and the client never has to reason about freshness.
 */
export function shardName(index: number, version: string): string {
  return `${index.toString(16).padStart(2, '0')}-${version}.tsv`;
}

/** Where a calendar year lives. Versioned like a shard, and cacheable for the same reason. */
export function calendarName(year: number, version: string): string {
  return `${year}-${version}.json`;
}

/**
 * One shard, as written by `write_puzzle_shards`.
 *
 * Tab-separated because the field names repeated over a bank this size were most of the
 * bytes. Column order is the writer's and the two have to move together.
 */
export function decodeShard(text: string): Puzzle[] {
  const puzzles: Puzzle[] = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    const f = line.split('\t');
    if (f.length < 12) continue;
    puzzles.push({
      id: f[0]!,
      day: Number(f[1]),
      band: Number(f[2]),
      source: f[3]!,
      target: f[4]!,
      par: Number(f[5]),
      secret: Number(f[6]),
      corridorSize: Number(f[7]),
      altNodes: Number(f[8]),
      shortestPaths: Number(f[9]),
      maxRank: Number(f[10]),
      // The words this puzzle draws, chosen by the builder. See board_words in select.rs.
      board: f[11] ? f[11].split(' ') : [],
    });
  }
  return puzzles;
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

/**
 * Mirror the half-rows into whole ones, as typed arrays.
 *
 * Three passes and no allocation per word: count both ends of every edge, prefix-sum
 * that into offsets, then fill. Rows come out ascending for free — a word's neighbours
 * below it arrive in id order from the outer loop, and its own half-row is already
 * ascending — so nothing is sorted.
 *
 * Typed arrays because this is the hot structure of the whole client: a breadth-first
 * search walks it thousands of times per board.
 */
export function decodeRows(raw: RawRows): Rows {
  const size = raw.counts.length;
  const degrees = new Int32Array(size);

  // Decode the halves once, keeping them, since they are read twice below.
  const above = new Int32Array(raw.above.length);
  let at = 0;
  for (let word = 0; word < size; word++) {
    let previous = 0;
    for (let i = 0; i < raw.counts[word]!; i++) {
      const step = raw.above[at]!;
      previous = i === 0 ? step : previous + step;
      // Checked here, once, rather than trusted: a row pointing outside the dictionary
      // means the two files disagree, and the symptom of not noticing is a board with
      // `undefined` on it.
      if (previous <= word || previous >= size) {
        throw new Error(`graph.json references a missing dictionary index: ${previous}`);
      }
      above[at] = previous;
      degrees[word]! += 1;
      degrees[previous]! += 1;
      at += 1;
    }
  }

  const offsets = new Int32Array(size + 1);
  for (let i = 0; i < size; i++) offsets[i + 1] = offsets[i]! + degrees[i]!;

  const targets = new Int32Array(above.length * 2);
  const cursor = Int32Array.from(offsets.subarray(0, size));
  at = 0;
  for (let word = 0; word < size; word++) {
    for (let i = 0; i < raw.counts[word]!; i++) {
      const other = above[at]!;
      targets[cursor[word]!++] = other;
      targets[cursor[other]!++] = word;
      at += 1;
    }
  }
  return { degrees, targets, offsets };
}

/** Build the game's view of the data. The one definition every reader shares. */
export function decodeGameData(files: RawFiles): GameData {
  // Ids are how boards are addressed, and data built before they existed has none:
  // the game would start, then rewrite its URL to `/undefined` and lose the player
  // on the next reload. Say so instead — the loading screen offers `npm run data`.
  if (files.puzzles.some((puzzle) => !puzzle.id)) {
    throw new Error('the puzzle bank has no ids: rebuild it');
  }
  const words = files.dictionary.words.split('\n');
  const common = new Set<string>();
  for (const at of decodeDeltas(files.common.common)) {
    const word = words[at];
    if (word !== undefined) common.add(word);
  }
  return {
    graph: buildGraph(
      files.graph.params,
      words,
      decodeRows(files.graph.legal),
      decodeRows(files.graph.common),
      common,
    ),
    puzzles: files.puzzles,
    manifest: files.manifest,
  };
}

/**
 * Fetch a file from the data directory.
 *
 * `immutable` is for anything whose name carries a version — the shards, and the three
 * files that only change when the whole bank does. `force-cache` on those means a
 * repeat visit does not revalidate: the URL is the freshness. The manifest is the one
 * fixed name, so it is fetched normally and is the only thing a return visit waits on.
 */
async function get(name: string, immutable: boolean): Promise<Response> {
  // Read here rather than at module scope. Everything above this line has to work
  // outside a bundler — the Playwright fixtures import this module in plain Node
  // to read the shipped files off disk, and a top-level `import.meta.env.BASE_URL`
  // made the whole end-to-end suite die on load with "cannot read BASE_URL of
  // undefined", in a module it never actually calls.
  const base = import.meta.env?.BASE_URL ?? '/';
  const res = await fetch(`${base}data/${name}`, immutable ? { cache: 'force-cache' } : undefined);
  if (!res.ok) throw new Error(`could not load ${name}: ${res.status} ${res.statusText}`);
  return res;
}

async function getJson<T>(name: string, immutable = true): Promise<T> {
  return (await (await get(name, immutable)).json()) as T;
}

/**
 * The dictionary and the graph, shared by every caller.
 *
 * Immutable and the better part of a second to fetch and decode, so a second request is
 * always a waste. It happens: React's StrictMode runs effects twice in development,
 * which meant every page load in dev and every one of the hundred-odd end-to-end tests
 * built a 269k-edge graph *twice*.
 *
 * The promise is cached, not the result, so two callers arriving together share one
 * fetch rather than starting two. A failure clears it, so a retry is still possible.
 */
let loading: Promise<GameData> | null = null;

/**
 * Load what a board needs: the graph, the manifest, and one shard.
 *
 * `want` says which shard — an id, or a day whose number names it. Omitted, it loads the
 * shard today's board is in. The first call decides which shard arrives with the graph;
 * `loadShard` fetches any others later, which is what dev mode's stepping needs.
 */
export function loadGameData(
  want?: { id?: string; day?: number; band?: number },
): Promise<GameData> {
  loading ??= fetchGameData(want).catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}

/** Every shard fetched so far, by index. A session touches one or two. */
const shards = new Map<number, Puzzle[]>();

/**
 * One shard, fetched once.
 *
 * The manifest supplies the version, so this is only callable after the first load.
 */
export async function loadShard(index: number, version: string): Promise<Puzzle[]> {
  const cached = shards.get(index);
  if (cached) return cached;
  const text = await (await get(`puzzles/${shardName(index, version)}`, true)).text();
  const puzzles = decodeShard(text);
  shards.set(index, puzzles);
  return puzzles;
}

/**
 * One calendar year, fetched and kept.
 *
 * Cached in memory per year and `force-cache` over the network, because a past year cannot
 * change: its name carries the bank version, so a rebuilt bank asks at a new address.
 */
const calendars = new Map<number, Promise<RawCalendar>>();

export function loadCalendar(year: number, version: string): Promise<RawCalendar> {
  const cached = calendars.get(year);
  if (cached) return cached;
  const wanted = get(`puzzles/${calendarName(year, version)}`, true)
    .then((response) => response.json() as Promise<RawCalendar>)
    .catch((error: unknown) => {
      // Not kept, so a failed fetch can be retried rather than remembered as a failure.
      calendars.delete(year);
      throw error;
    });
  calendars.set(year, wanted);
  return wanted;
}

/**
 * The id a band and day name, fetching that day's calendar year.
 *
 * The day is wrapped into the calendar first, so a date past the last year written comes round
 * to the beginning rather than asking for a file that does not exist. Null when the calendar
 * has no board there, which the caller turns into "show today's" rather than an error.
 */
export async function idForDay(
  band: number,
  day: number,
  manifest: RawManifest,
): Promise<string | null> {
  const wrapped = dayIndex(day, manifest.days);
  const date = dateForDay(wrapped, manifest.epoch);
  const year = Number(date.slice(0, 4));
  if (year < manifest.years[0] || year > manifest.years[1]) return null;
  const calendar = await loadCalendar(year, manifest.version);
  return idOnDay(calendar, band, dayOfYear(date));
}

/** One line of the pair index: which board the puzzle about two words is at. */
export interface Pair {
  source: string;
  target: string;
  id: string;
}

/**
 * Every pair in the bank and the address it lives at.
 *
 * **Fetched only when asked for, and only two screens ask.** A shard is found from an id and an
 * id is a digest of an answer, so there is no way from "the puzzle about these two words" to a
 * board without an index — and the client holds one shard, not the bank.
 *
 * About a megabyte, so nothing on the way to playing today touches it. Dev mode's lookup asks on
 * the first keystroke; the archive asks on arrival, because both halves of that page read it —
 * the calendar to say which words a date holds as well as the search to find a date from words.
 * Playing is unaffected either way.
 */
let pairs: Promise<Pair[]> | null = null;

export function loadPairs(version: string): Promise<Pair[]> {
  pairs ??= (async () => {
    const text = await (await get(`puzzles/pairs-${version}.tsv`, true)).text();
    const out: Pair[] = [];
    for (const line of text.split('\n')) {
      if (!line) continue;
      const [source, target, id] = line.split('\t');
      if (source && target && id) out.push({ source, target, id });
    }
    return out;
  })().catch((error: unknown) => {
    pairs = null;
    throw error;
  });
  return pairs;
}

async function fetchGameData(
  want?: { id?: string; day?: number; band?: number },
): Promise<GameData> {
  // The manifest first and alone: it names everything else, and nothing can be asked for until
  // its version is known.
  const manifest = await getJson<RawManifest>('puzzles/manifest.json', false);

  // Which shard holds the board being opened. An id names its own, in one hop. A date needs the
  // calendar year first — that is the one extra request a date costs, and what it buys is that
  // every puzzle in the bank has a date at all. See `idForDay`.
  const asked =
    want?.id ??
    (await idForDay(want?.band ?? 0, want?.day ?? dayNumber(new Date(), manifest.epoch), manifest));
  // `shardOf` of nothing is shard 0, which is the right shape of failure: the caller looks the
  // board up in what arrived and shows today's when it is not there. `idForDay` only comes back
  // empty if the calendar files and the manifest disagree, which is a broken deploy rather than
  // a state a player can reach.
  const index = shardOf(asked ?? '');

  const [dictionary, graph, common, puzzles] = await Promise.all([
    getJson<RawDictionary>('dictionary.json'),
    getJson<RawGraph>('graph.json'),
    getJson<RawCommon>('common.json'),
    loadShard(index, manifest.version),
  ]);
  return decodeGameData({ dictionary, graph, manifest, common, puzzles });
}
