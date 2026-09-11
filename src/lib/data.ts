/**
 * The shipped data files, and the only place that knows their shape.
 *
 * Four files, written by tools/graphgen and fetched together, ~1.1MB gzipped in
 * total and then cached by the browser for good — they are immutable until the
 * data is rebuilt.
 *
 *   dictionary-{d}.json  every word a player may guess, newline-joined and sorted.
 *                        Also the canonical index the other two files refer to, so
 *                        no word is ever stored twice.
 *   graph-{d}.json       both graphs, as half of each neighbour row over those ids.
 *   common-{d}.json      which of those words are ordinary ones. The board is drawn
 *                        from these alone; a guess may be any word at all.
 *   puzzles.json         the bank.
 *
 * All four carry a **digest of their own bytes** in their names, because they are cached by name
 * for good. See `modeFile`. Separately, `RawMode.vocab` is what every puzzle id in the mode was
 * taken over — the part of these files a shared board's code actually indexes into.
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
import { buildLexicon, PLAIN, type Lexicon, type RawLexicon } from './lexicon';
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

/** One game in the bank: an alphabet, a data directory, and the bounds of its search. */
export interface RawMode {
  /** Also the directory its three files live in. */
  name: string;
  /** `letters` or `phonemes`. What a token *is* — see lexicon.ts. */
  alphabet: string;
  /**
   * The digest naming this game's four files, and a digest of their bytes.
   *
   * They are fetched `force-cache`, so a name that cannot change means a browser keeps what it
   * has for ever — which is why the name has to move when the contents do. See `modeFile`.
   */
  data: string;
  /**
   * The digest of this game's vocabulary: its word list and the two lengths that decide which
   * moves exist.
   *
   * **What every puzzle id in this game is a digest of** — see graphgen's id.rs — because a
   * shared board's code indexes into the legal moves from a word and into the dictionary, and
   * both are functions of exactly that. So an id and the lists a code reads against it name the
   * same vocabulary, or the id does not resolve.
   *
   * Nothing is fetched by it: `data` names the files, and covers more (three of the four depend
   * on the common tier too, which the vocabulary deliberately does not). This is here so that
   * what an id pins is written down, and so a test can check the two agree.
   */
  vocab: string;
  slack: number;
  minPar: number;
  maxPar: number;
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
  /** The games this bank holds. A band belongs to exactly one of them. */
  modes: RawMode[];
  /**
   * Every band of every mode, flattened, in order.
   *
   * **One list across every mode**, because a band index is a puzzle's own `band`, the
   * position of a run in a calendar year, and the thing a stored preference names. Each
   * mode's three lengths sit in it in order, so the letters game is 0, 1, 2 and the
   * phonemes game is 3, 4, 5.
   *
   * The pars are what the band holds, which the header shows and which is that mode's
   * `bandCuts` rather than anything the client decides. There is no per-band length: every
   * band runs the whole calendar, so the length is `days` below.
   */
  bands: {
    /**
     * The flat identifier of this game variant: `letters-short`, `phonemes-long`.
     *
     * **This is what a band *is*, and it is what anything storing or comparing one uses** —
     * `gameKey` and the stats record key are both built on it. The index cannot do that job:
     * it is a position in a list, so appending a mode is safe but reordering one silently
     * reassigns every stored game to a different game. The name survives that.
     */
    name: string;
    /**
     * And what a player reads: `short`, `medium`, `long`.
     *
     * Both modes have all three, so a label does not identify a band and is never stored.
     * Which game it belongs to is said by the menu grouping them, not by the word.
     */
    label: string;
    /** Which mode it belongs to: an index into `modes`. */
    mode: number;
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
}

/** The files needed before a board can be drawn, however they were obtained. */
export interface RawFiles {
  dictionary: RawDictionary;
  graph: RawGraph;
  manifest: RawManifest;
  common: RawCommon;
  /** One shard's worth of puzzles: whichever shard the board being opened is in. */
  puzzles: Puzzle[];
  /** The mode these files belong to: an index into `manifest.modes`. */
  mode?: number | undefined;
  /** Present only for a translated alphabet. See lexicon.ts. */
  lexicon?: RawLexicon | undefined;
}

/**
 * One mode's graph and alphabet.
 *
 * Fetched per mode and kept, because a session touches one or two: playing the phonemes board
 * costs its own dictionary and graph, and nothing on the way to today's letters board pays
 * for them.
 */
export interface ModeData {
  /** Index into `manifest.modes`. */
  mode: number;
  graph: Graph;
  lexicon: Lexicon;
}

export interface GameData extends ModeData {
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
 * How many bands there are before the manifest can say.
 *
 * The band a bare visit opens is read from storage on the first render, which happens before
 * any fetch has finished, so the stored number has to be bounded by something. It is checked
 * against `manifest.bands.length` everywhere after that, and a stored band past the end
 * simply falls back to the first — so this being stale costs a preference and never a board.
 */
export const BANDS = 6;

/** What a band is called and what pars it holds. */
export function bandOf(band: number, manifest: RawManifest): RawManifest['bands'][number] {
  return (
    manifest.bands[band] ??
    manifest.bands[0] ?? { name: 'letters-short', label: 'short', mode: 0, minPar: 0, maxPar: 0 }
  );
}

/**
 * A band's flat identifier, which is what a stored game or a stats record is keyed on.
 *
 * Falls back to the index written as a string, for the one case that has to keep working:
 * a record stored before the manifest could be consulted, or a band past the end of a
 * manifest this build has not fetched yet. A key that matches nothing ages out, which is
 * the same thing that happens to any other stale key here.
 */
export function bandId(band: number, manifest: RawManifest): string {
  return manifest.bands[band]?.name ?? String(band);
}

/** Which mode a band belongs to. Out-of-range falls back to the first, like `bandOf`. */
export function modeOfBand(band: number, manifest: RawManifest): number {
  return manifest.bands[band]?.mode ?? 0;
}

/** What a mode is called, which is also the directory its files are in. */
export function modeName(mode: number, manifest: RawManifest): string {
  return manifest.modes[mode]?.name ?? manifest.modes[0]?.name ?? 'letters';
}

/**
 * Where one of a mode's four files lives: `letters/dictionary-1f4c2e8a.json`.
 *
 * **The digest is of their bytes**, so any change to any of the four renames all four. They are
 * fetched immutably — their names promise they cannot change — so an unversioned name let a
 * returning browser pair a fresh shard with a dictionary from a build ago, and a board code's
 * indices would resolve against the wrong list. The same rule the shards follow.
 */
export function modeFile(what: string, mode: number, manifest: RawManifest): string {
  return `${modeName(mode, manifest)}/${what}-${manifest.modes[mode]?.data ?? ''}.json`;
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

/**
 * Build the game's view of one mode's data. The one definition every reader shares.
 *
 * **It has no idea what alphabet it is reading.** The dictionary, the rows and the common
 * list have the same shapes whether their "words" are spellings or pronunciations, which is
 * what makes a second mode cost a lexicon and nothing else here.
 */
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
    mode: files.mode ?? 0,
    graph: buildGraph(
      files.graph.params,
      words,
      decodeRows(files.graph.legal),
      decodeRows(files.graph.common),
      common,
    ),
    lexicon: files.lexicon ? buildLexicon(files.lexicon, words) : PLAIN,
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
 * One mode's dictionary, graph and lexicon, fetched once.
 *
 * Immutable and the better part of a second to fetch and decode, so a second request is
 * always a waste. It happens: React's StrictMode runs effects twice in development, which
 * meant every page load in dev and every one of the hundred-odd end-to-end tests built a
 * 269k-edge graph *twice*.
 *
 * The promise is cached, not the result, so two callers arriving together share one fetch
 * rather than starting two. A failure clears it, so a retry is still possible.
 *
 * **Per mode, and only on demand.** A session touches one mode or two, and the phonemes
 * graph is a second dictionary the size of the first — nothing on the way to today's
 * letters board should pay for it.
 */
const modes = new Map<number, Promise<ModeData>>();

export function loadMode(mode: number, manifest: RawManifest): Promise<ModeData> {
  const cached = modes.get(mode);
  if (cached) return cached;
  const wanted = fetchMode(mode, manifest).catch((error: unknown) => {
    modes.delete(mode);
    throw error;
  });
  modes.set(mode, wanted);
  return wanted;
}

async function fetchMode(mode: number, manifest: RawManifest): Promise<ModeData> {
  const file = (what: string) => modeFile(what, mode, manifest);
  const translated = manifest.modes[mode]?.alphabet !== 'letters';
  const [dictionary, graph, common, lexicon] = await Promise.all([
    getJson<RawDictionary>(file('dictionary')),
    getJson<RawGraph>(file('graph')),
    getJson<RawCommon>(file('common')),
    translated ? getJson<RawLexicon>(file('lexicon')) : Promise.resolve(undefined),
  ]);
  // No puzzles: a shard holds every mode's, so it is fetched separately and joined by the
  // caller. `decodeGameData` is the shared definition and takes both.
  const { mode: at, graph: built, lexicon: read } = decodeGameData({
    dictionary,
    graph,
    common,
    lexicon,
    manifest,
    mode,
    puzzles: [],
  });
  return { mode: at, graph: built, lexicon: read };
}

/**
 * The manifest, fetched once.
 *
 * It names everything else, so nothing can be asked for until its version is known — and it
 * is the one file with a fixed name, so it is the only thing a repeat visit waits on.
 */
let head: Promise<RawManifest> | null = null;

export function loadManifest(): Promise<RawManifest> {
  head ??= getJson<RawManifest>('puzzles/manifest.json', false).catch((error: unknown) => {
    head = null;
    throw error;
  });
  return head;
}

/**
 * Load what a board needs: the manifest, one shard, and the graph of whichever mode that
 * board turns out to belong to.
 *
 * `want` says which board — an id, or a band and day. **The mode is a finding rather than an
 * input**: a shared link carries an id and nothing else, so which game it is can only be
 * known once the shard says which band the puzzle is in. Failing that — a dead id, or a
 * first visit — the band asked for decides, since that is the board about to be shown.
 */
export function loadGameData(
  want?: { id?: string; day?: number; band?: number },
): Promise<GameData> {
  return fetchGameData(want);
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
  const manifest = await loadManifest();

  // Which shard holds the board being opened. An id names its own, in one hop. A date needs
  // the calendar year first — that is the one extra request a date costs, and what it buys is
  // that every puzzle in the bank has a date at all. See `idForDay`.
  const wantedBand = want?.band ?? 0;
  const asked =
    want?.id ??
    (await idForDay(wantedBand, want?.day ?? dayNumber(new Date(), manifest.epoch), manifest));
  // `shardOf` of nothing is shard 0, which is the right shape of failure: the caller looks the
  // board up in what arrived and shows today's when it is not there. `idForDay` only comes back
  // empty if the calendar files and the manifest disagree, which is a broken deploy rather than
  // a state a player can reach.
  const puzzles = await loadShard(shardOf(asked ?? ''), manifest.version);

  // The board's own band if the shard really holds it, and the band asked for otherwise —
  // which covers a link shared before a rebuild, where the fallback is today's board of
  // whatever length the player last chose.
  const found = asked === null ? undefined : puzzles.find((puzzle) => puzzle.id === asked);
  const mode = modeOfBand(found?.band ?? wantedBand, manifest);

  const loaded = await loadMode(mode, manifest);
  return { ...loaded, puzzles, manifest };
}
