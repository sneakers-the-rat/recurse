/**
 * The record of every round finished, and every figure read off it.
 *
 * A log, not a set of counters. One record per puzzle, appended when a round ends, and
 * every number the stats screen shows is computed from the whole log at read time. That
 * costs a walk over a few hundred small objects, which is nothing, and it buys the thing
 * that matters: a stat nobody thought of yet is a new function here rather than a
 * migration of everybody's stored counters.
 *
 * **Why a store of its own, rather than reading the game store.** `recurse.games.v2` keeps
 * snapshots of games, and a snapshot has no par, no band, no day, no date and no shortcut
 * count — none of which can be recovered later, because the bank is rebuilt and a puzzle's
 * id changes with its answer. It also evicts at thirty entries, about ten days of play, so
 * a timeline built on it would quietly end ten days ago.
 *
 * **A record is dated by the puzzle, never by the clock.** The date written down is the day
 * the board belongs to, so a puzzle from the archive played this evening lands on its own
 * date and the timeline stays the calendar rather than a diary of when the effect happened
 * to fire. That is also what makes it safe to record a board finished before any of this
 * existed: opening it writes its round down where it actually happened.
 *
 * Those recovered rounds are marked `backfilled`, and exactly one figure ignores them:
 * **streaks**. Every other stat is about puzzles solved and is as true of a round recovered
 * as of one watched; a streak is about which days somebody turned up, and a record salvaged
 * from a board finished at an unknown time is not evidence of that.
 *
 * Pure, so the merge rule and the version gate can be tested without a browser. What is
 * *stored* belongs to storage.ts, which is the only module that touches `localStorage`.
 */

import type { Phrase } from '../i18n/format';
import { stats as says } from '../i18n/messages/stats';
import type { RawManifest } from './data';
import { guessedWords, type GameState } from './game';
import type { Mark } from './share';

/**
 * One finished round.
 *
 * Field names are the stored format, so renaming one retires everybody's history — see
 * `EXPORT_VERSION` and `readCompletions`, which is what makes that survivable.
 */
export interface Completion {
  /**
   * The puzzle this round was played on: `letters-short:source>target` — what `gameKey` builds.
   *
   * The word pair is the identifier because it is the only one that survives a rebuild: an id
   * is a digest of the answer and changes when the answer does. Merging and "first write per
   * pair wins" are both keyed on this.
   *
   * The band is in front of it because a pair is only unique within one alphabet, and it is
   * there **by name and not by index** — an index is a position in the manifest's list and
   * means a different game the moment that list changes. A record written in either older
   * form, the bare pair or the index, is repaired on the way in by `readCompletion`.
   */
  key: string;
  /** The address the round was played at. A convenience for reopening it, and may go stale. */
  id: string;
  /** Days since the epoch — the day the *board* belongs to, not the day it was recorded. */
  day: number;
  /**
   * That day's date, `YYYY-MM-DD`.
   *
   * Stored as well as the day number because moving the epoch reassigns every day number,
   * and then the dates are what the timeline still agrees about. See `EPOCH` in daily.ts.
   */
  date: string;
  /**
   * Which band, indexing the manifest's flattened list: the letters game's three lengths are
   * 0, 1, 2 and the phonemes game's are 3, 4, 5.
   *
   * Kept as well as the name in `key` because every figure that splits by band — the chart's
   * mark shapes, ±par, the sweeps — is looking one up in the manifest, and an index is what
   * that takes. `readCompletion` re-derives it from the record's own par, so a record written
   * under an older list is right rather than merely readable.
   */
  band: number;
  par: number;
  /**
   * The shorter legal distance this puzzle allowed, 0 when par could not be beaten.
   *
   * The honest denominator for "shortcuts found": a round on a board with no shortcut is not
   * a shortcut missed.
   */
  secret: number;
  guesses: number;
  /** Guesses the game refused. Not part of the score, and counted anyway. */
  misses: number;
  /**
   * Hint clicks spent on letters, and hint clicks spent on the shape of a move.
   *
   * Two numbers rather than the one `hintCount` gives, because they are two different
   * purchases: a letter is help naming a word, a `+` or `−` is help seeing a move, and a
   * player who only ever buys one of them has a habit worth showing them.
   */
  letters: number;
  shapes: number;
  /** One character per guess, in order. See `MARK_CODE`. */
  marks: string;
  /** The words guessed, in order — what the word-frequency table is built from. */
  words: string[];
  /**
   * Recovered from a board that was already finished when it was opened, rather than watched
   * being finished. Counts towards everything except streaks; see the header.
   */
  backfilled: boolean;
}

/**
 * A mark as one character, because a trail is stored once per round and read rarely.
 *
 * The emoji themselves would be four bytes each and would tie the store to share.ts's
 * choice of picture; these are the four facts, and `emojiTrail` still draws them.
 */
const MARK_CODE: Record<Mark, string> = {
  shortcut: '*',
  route: 'g',
  alternate: 'a',
  stray: 'x',
};

const MARK_OF: Record<string, Mark> = {
  '*': 'shortcut',
  g: 'route',
  a: 'alternate',
  x: 'stray',
};

export function packMarks(marks: readonly Mark[]): string {
  return marks.map((mark) => MARK_CODE[mark]).join('');
}

/** Anything unrecognised is dropped rather than guessed at, the way `restore` drops a move. */
export function unpackMarks(packed: string): Mark[] {
  return [...packed].map((code) => MARK_OF[code]).filter((mark): mark is Mark => mark !== undefined);
}

/**
 * A finished round, written down.
 *
 * `key` is passed in rather than built here: `gameKey` lives in storage.ts, which reads this
 * module's `readCompletions`, and a module cannot be both above and below another one.
 */
export function recordOf(
  key: string,
  state: GameState,
  where: {
    day: number;
    date: string;
    marks: readonly Mark[];
    backfilled: boolean;
    /**
     * How to write a token down. `PLAIN.label` in the letters game.
     *
     * The record stores **labels, not tokens**, and it is the only part of a round that does.
     * `/stats` spans every mode at once and has no lexicon in hand — it cannot, since it is a
     * list of rounds from different games — so a token stored here is a row of phoneme codes
     * nothing on that screen can read. The same reasoning as the pair index: a screen that
     * crosses modes gets words.
     */
    label: (token: string) => string;
  },
): Completion {
  let letters = 0;
  for (const level of state.hints.values()) letters += level;

  return {
    key,
    id: state.puzzle.id,
    day: where.day,
    date: where.date,
    band: state.puzzle.band,
    par: state.puzzle.par,
    secret: state.puzzle.secret,
    guesses: state.guesses,
    misses: state.misses,
    letters,
    shapes: state.edgeHints.size,
    marks: packMarks(where.marks),
    // One per *guess*, not per move: a typed word naming two pronunciations is one word the
    // player met, and both readings label back to the same spelling — so counting the log
    // would put it in this table twice for having been typed once.
    words: guessedWords(state.log).map((word) => where.label(word)),
    backfilled: where.backfilled,
  };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function whole(value: unknown, least = 0): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= least
    ? Math.trunc(value)
    : null;
}

/**
 * One record, or null if it cannot be read.
 *
 * Total by construction, like `restore`: this is a string that has sat in a browser, or one
 * a player pasted in from somewhere. A record that does not make sense is dropped, because a
 * screen of figures computed from half a record is worse than a screen missing a round.
 */
/**
 * Which band of its own game a round at this par belongs to, and what that band is called.
 *
 * The mode comes from the index the record carries and the band comes from its par, because
 * those are the two halves that age differently: a mode keeps its place in the list when a
 * band is added to it, while the band's own position does not. Null when the index names no
 * mode this manifest has, or when no band of that mode holds that par — a record from a bank
 * whose par range has since moved, which is left exactly as it was stored rather than filed
 * under the nearest guess.
 */
function bandForPar(
  band: number,
  par: number,
  manifest: RawManifest,
): { at: number; name: string } | null {
  const mode = manifest.bands[band]?.mode;
  if (mode === undefined) return null;
  const at = manifest.bands.findIndex(
    (one) => one.mode === mode && par >= one.minPar && par <= one.maxPar,
  );
  const found = manifest.bands[at];
  return found ? { at, name: found.name } : null;
}

export function readCompletion(value: unknown, manifest?: RawManifest): Completion | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;

  const stored = typeof raw.key === 'string' && raw.key.length > 0 ? raw.key : null;
  const date = typeof raw.date === 'string' && DATE.test(raw.date) ? raw.date : null;
  const day = whole(raw.day, Number.NEGATIVE_INFINITY);
  const stamped = whole(raw.band);
  const par = whole(raw.par, 1);
  const guesses = whole(raw.guesses);
  if (stored === null || date === null || day === null || stamped === null) return null;
  if (par === null || guesses === null) return null;

  // The key has been written three ways: the bare pair, then the band's *index* in front of
  // it, and now the band's name. Left alone, an older one would never match the key the same
  // board produces today — so replaying an already-finished round would file a second record
  // of it and every figure on the screen would count it twice.
  //
  // Repaired here rather than migrated, because a record carries its own band, par and pair,
  // which is everything the current key needs. `readCompletion` is where every record enters,
  // whether from this browser or from a pasted export, so there is one place that knows.
  //
  // **The repair goes through par, which is what makes it exact and idempotent.** An index
  // written under an older manifest cannot simply be looked up — the phonemes game was one
  // band spanning par 3–10 before it was three, so index 3 alone does not say which of them a
  // round belongs to. Its *mode* is what the index still reliably gives, and within a mode the
  // par says the band. A record already in the current form asks the same question and gets
  // the same answer back.
  const repaired = manifest ? bandForPar(stamped, par, manifest) : null;
  const band = repaired?.at ?? stamped;
  const pair = stored.slice(stored.lastIndexOf(':') + 1);
  const key = repaired ? `${repaired.name}:${pair}` : stored;

  return {
    key,
    id: typeof raw.id === 'string' ? raw.id : '',
    day,
    date,
    band,
    par,
    secret: whole(raw.secret) ?? 0,
    guesses,
    misses: whole(raw.misses) ?? 0,
    letters: whole(raw.letters) ?? 0,
    shapes: whole(raw.shapes) ?? 0,
    marks: typeof raw.marks === 'string' ? raw.marks : '',
    words: Array.isArray(raw.words) ? raw.words.filter((w): w is string => typeof w === 'string') : [],
    backfilled: raw.backfilled === true,
  };
}

/**
 * Every readable record in whatever this is, in the order they were written.
 *
 * The manifest is optional and its absence is not an error: it is what the band repair reads,
 * and without one every record keeps the key and band it was stored with. That is the right
 * answer while the bank is still being fetched — the alternative is re-keying a history
 * against a list of bands nobody has seen yet.
 */
export function readCompletions(value: unknown, manifest?: RawManifest): Completion[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((one) => readCompletion(one, manifest))
    .filter((one): one is Completion => one !== null);
}

/* ---------------------------------------------------------------- the figures */

export interface Summary {
  played: number;
  /** Guesses per round, and the par those rounds were against. */
  guesses: number;
  par: number;
  /** Guesses minus par, averaged. Negative is the good direction. */
  diff: number;
  hints: number;
  misses: number;
}

const mean = (total: number, count: number) => (count === 0 ? 0 : total / count);

export function summary(records: readonly Completion[]): Summary {
  let guesses = 0;
  let par = 0;
  let hints = 0;
  let misses = 0;
  for (const one of records) {
    guesses += one.guesses;
    par += one.par;
    hints += one.letters + one.shapes;
    misses += one.misses;
  }
  const played = records.length;
  return {
    played,
    guesses: mean(guesses, played),
    par: mean(par, played),
    diff: mean(guesses - par, played),
    hints: mean(hints, played),
    misses: mean(misses, played),
  };
}

/**
 * ±par per length, always all three, never one blended number.
 *
 * The bands are out of tune — the build reports 44 / 37 / 19 for the letters game — so a
 * single average is mostly a statement about which lengths the player happens to have been
 * offered. Three numbers is the smallest honest answer, and a band with nothing in it says so
 * rather than being left out.
 *
 * `bands` names them by their index in the manifest, so this asks about one game's lengths and
 * the answer comes back in the order asked. Blending two games would be the same mistake one
 * level up: their banks are different sizes and their par distributions are different shapes.
 */
export function byBand(records: readonly Completion[], bands: readonly number[]): Summary[] {
  return bands.map((band) => summary(records.filter((one) => one.band === band)));
}

/**
 * Shortcuts, with the denominator that makes the numerator mean anything.
 *
 * `offered` is rounds on a board that had a way through shorter than par; `found` is rounds
 * that actually came in under it. Rounds on boards with no shortcut are in neither, because
 * they were never a chance to miss.
 */
export function secrets(records: readonly Completion[]): { offered: number; found: number } {
  let offered = 0;
  let found = 0;
  for (const one of records) {
    if (one.secret <= 0) continue;
    offered += 1;
    if (one.guesses < one.par) found += 1;
  }
  return { offered, found };
}

/**
 * How much of the wandering was wandering: guesses that landed on a shortest route or a
 * shortcut, against all guesses made.
 *
 * Read off the marks, which is the same trail the share text draws, so this and a player's
 * posted result cannot disagree about what a round looked like.
 */
export function directness(records: readonly Completion[]): { on: number; guesses: number } {
  let on = 0;
  let guesses = 0;
  for (const one of records) {
    for (const mark of unpackMarks(one.marks)) {
      guesses += 1;
      if (mark === 'route' || mark === 'shortcut') on += 1;
    }
  }
  return { on, guesses };
}

/** Hint clicks by what they bought. */
export function hintsByKind(records: readonly Completion[]): { letters: number; shapes: number } {
  let letters = 0;
  let shapes = 0;
  for (const one of records) {
    letters += one.letters;
    shapes += one.shapes;
  }
  return { letters, shapes };
}

/**
 * Streaks: **consecutive days on which some puzzle of that day was finished**, in any band.
 *
 * One streak and not three. Three parallel streaks — one per length — is three ways to feel
 * bad on a day somebody played one board and enjoyed it, and the game offers three lengths
 * so that a player can pick, not so that they owe all of them.
 *
 * A day counts by the *puzzle's* day, not by when it was played, so catching up on Tuesday's
 * board on Wednesday fills Tuesday in. Backfilled records are ignored outright: a board that
 * was already finished when stats first saw it says nothing about when anyone showed up.
 *
 * `today` is the current day number. The current streak is allowed to end yesterday, because
 * a day is not a failure until it is over.
 */
export function streaks(
  records: readonly Completion[],
  today: number,
): { current: number; longest: number } {
  const days = new Set<number>();
  for (const one of records) {
    if (!one.backfilled) days.add(one.day);
  }
  if (days.size === 0) return { current: 0, longest: 0 };

  const sorted = [...days].sort((a, b) => a - b);
  let longest = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    run = sorted[i]! === sorted[i - 1]! + 1 ? run + 1 : 1;
    if (run > longest) longest = run;
  }

  let at = days.has(today) ? today : today - 1;
  let current = 0;
  while (days.has(at)) {
    current += 1;
    at -= 1;
  }

  return { current, longest };
}

/**
 * Days every band of one game fell.
 *
 * Counted over every record, backfilled ones included, because a clean sweep is a fact about
 * a day's boards being solved rather than about turning up on that day — which is what
 * `streaks` is for, and the reason the two are separate functions.
 *
 * **One game's bands, not the manifest's.** Asked across every mode, this was "all of today's
 * boards in all of the games", which is a different and much harder thing to have done — and
 * one that would get harder every time a game was added, so a figure somebody had earned would
 * quietly stop being reachable. Per game it asks the question it always meant, and the day a
 * game nobody plays daily is added it says nothing about the games they do play.
 */
export function sweeps(records: readonly Completion[], bands: readonly number[]): number {
  if (bands.length === 0) return 0;
  const wanted = new Set(bands);
  const byDay = new Map<number, Set<number>>();
  for (const one of records) {
    if (!wanted.has(one.band)) continue;
    const had = byDay.get(one.day) ?? new Set<number>();
    had.add(one.band);
    byDay.set(one.day, had);
  }
  let swept = 0;
  for (const found of byDay.values()) if (found.size >= wanted.size) swept += 1;
  return swept;
}

/**
 * How often each score against par came up, over the range that actually occurred.
 *
 * Every step between the extremes is present even where nothing landed on it, because a gap
 * in a histogram has to be drawn as a gap rather than closed up. Zero is always in range: it
 * is the line everything is read against.
 */
export function parBuckets(records: readonly Completion[]): { diff: number; count: number }[] {
  if (records.length === 0) return [];
  const diffs = records.map((one) => one.guesses - one.par);
  const low = Math.min(0, ...diffs);
  const high = Math.max(0, ...diffs);
  const counts = new Map<number, number>();
  for (const diff of diffs) counts.set(diff, (counts.get(diff) ?? 0) + 1);
  return Array.from({ length: high - low + 1 }, (_, i) => ({
    diff: low + i,
    count: counts.get(low + i) ?? 0,
  }));
}

/**
 * The words the player keeps meeting, commonest first.
 *
 * Over the words guessed on finished rounds, which is what they actually walked through
 * rather than what the board offered. Ties break alphabetically, so the table does not
 * reshuffle itself between two visits that saw the same rounds.
 */
export function wordCounts(
  records: readonly Completion[],
  limit: number,
): { word: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const one of records) {
    for (const word of one.words) counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts]
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
    .slice(0, limit);
}

/* ---------------------------------------------------------- carrying it about */

/**
 * The version of the *file*, bumped on any change a reader of an older one could not cope
 * with.
 *
 * An integer rather than a date or a semver string, because the only question ever asked of
 * it is "is this newer than me". Older is upgraded; newer is refused in a sentence, which is
 * the one place this feature says no rather than doing its best — a file from a later
 * release may say things this one would silently misread, and a wrong history is worse than
 * an import that did not happen.
 */
export const EXPORT_VERSION = 1;

export interface StatsFile {
  app: 'recurse';
  kind: 'stats';
  version: number;
  /** When the file was written, as an ISO instant. Diagnostic; nothing reads it back. */
  exported: string;
  /**
   * The epoch and the bank the exporting device was on.
   *
   * Diagnostics, and worth carrying: if the epoch differs, the two devices number their days
   * differently and only the dates are comparable. Nothing is refused over either — a
   * player's history is theirs whatever the build.
   */
  epoch: string;
  bank: string;
  records: Completion[];
}

export function exportStats(
  records: readonly Completion[],
  about: { epoch: string; bank: string; exported: string },
): StatsFile {
  return {
    app: 'recurse',
    kind: 'stats',
    version: EXPORT_VERSION,
    exported: about.exported,
    epoch: about.epoch,
    bank: about.bank,
    records: [...records],
  };
}

export type Import =
  | { ok: true; file: StatsFile; records: Completion[]; dropped: number }
  | { ok: false; reason: Phrase };

/**
 * Read a file somebody pasted or picked, and say what is wrong with it if anything is.
 *
 * The refusals are the interesting part. A file from a *later* version is turned away with a
 * sentence, because reading it would mean guessing at fields that did not exist here. Every
 * other problem is survivable: a record that cannot be read is dropped and counted, and the
 * rest of the file is imported, exactly as a stored game drops a move it cannot replay.
 */
export function parseStats(value: unknown, manifest?: RawManifest): Import {
  if (typeof value !== 'object' || value === null) {
    return { ok: false, reason: { message: says.notOurs } };
  }
  const raw = value as Record<string, unknown>;
  if (raw.app !== 'recurse' || raw.kind !== 'stats') {
    return { ok: false, reason: { message: says.notOurs } };
  }
  const version = typeof raw.version === 'number' ? Math.trunc(raw.version) : 0;
  if (version > EXPORT_VERSION) {
    return {
      ok: false,
      reason: {
        message: says.tooNew,
        values: { version: String(version), reads: EXPORT_VERSION },
      },
    };
  }
  const offered = Array.isArray(raw.records) ? raw.records : [];
  // An import is a history from another device, so it is exactly where a record written under
  // a different list of bands turns up. Same repair as a record read out of this browser.
  const records = readCompletions(offered, manifest);
  return {
    ok: true,
    file: {
      app: 'recurse',
      kind: 'stats',
      version,
      exported: typeof raw.exported === 'string' ? raw.exported : '',
      epoch: typeof raw.epoch === 'string' ? raw.epoch : '',
      bank: typeof raw.bank === 'string' ? raw.bank : '',
      records,
    },
    records,
    dropped: offered.length - records.length,
  };
}

/**
 * Two histories into one: **a pair already here wins whole**.
 *
 * Whole, and never field by field. The two records of one puzzle are two accounts of one
 * round, and taking the guesses from one and the hints from the other describes a round
 * nobody played. So the local one is kept entire and the imported one is dropped entire,
 * which also makes the rule something a player can be told in six words.
 *
 * Local first is the safe direction for the same reason it is in `saveGame`: an import is a
 * thing that can be repeated, and one that quietly overwrote what was already here could not
 * be undone.
 */
export function mergeStats(
  local: readonly Completion[],
  imported: readonly Completion[],
): { records: Completion[]; added: number; kept: number } {
  const here = new Set(local.map((one) => one.key));
  const records = [...local];
  let added = 0;
  let kept = 0;
  for (const one of imported) {
    if (here.has(one.key)) {
      kept += 1;
      continue;
    }
    here.add(one.key);
    records.push(one);
    added += 1;
  }
  return { records, added, kept };
}
