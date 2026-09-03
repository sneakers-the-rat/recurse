/**
 * Remembering games across reloads.
 *
 * A daily word game is played on a phone, in bursts, between other things — the
 * page gets backgrounded, reloaded, returned to an hour later, and the browser
 * may throw the tab away in between. Losing a half-finished board to any of that
 * reads as the game being broken, so progress is written down after every move.
 *
 * Games are kept per *puzzle*, not one "current game", because the player moves
 * between puzzles: today's, one from the archive, whatever dev mode is pointed
 * at. Each keeps its own progress and gets it back on return.
 *
 * Two decisions worth knowing:
 *
 * - Keyed by the two words, not by the puzzle's index. The index is a position in
 *   a bank that gets rebuilt, so `?puzzle=40` is not the same puzzle from one
 *   rebuild to the next, and a stored game would be restored onto a board it has
 *   nothing to do with. The word pair is unique within a bank and means the same
 *   thing across rebuilds; a key that no longer matches anything simply ages out.
 *
 * - Nothing here may ever throw. `localStorage` is not always available — Safari
 *   in private browsing, an iframe with third-party storage blocked, a full quota
 *   — and in every one of those cases the right behaviour is to play the game
 *   without remembering it, not to fail to start.
 */

import type { GameSnapshot } from './game';
import { readCompletions, type Completion } from './stats';
import type { Puzzle } from './types';

/**
 * Bumped when the stored shape changes, which retires every old entry at once.
 *
 * v2: hints stopped being a set of words and became a level per word, so a v1
 * entry's `hinted` array would restore as no hints at all — silently losing the
 * help someone had already paid for.
 *
 * Exported so the tests can reach the store the code actually uses: they used to
 * write `recurse.games.v1` by hand, and the bump left them poking at a key nothing
 * reads, still passing.
 */
export const KEY = 'recurse.games.v2';

/**
 * How many finished-or-abandoned games to keep. Enough that a week of play and a
 * browse through the archive all survive; small enough never to approach a quota.
 */
const KEEP = 30;

interface Entry {
  key: string;
  game: GameSnapshot;
}

/** The puzzle this game belongs to. Stable across a rebuild of the bank. */
export function gameKey(puzzle: Puzzle): string {
  return `${puzzle.source}>${puzzle.target}`;
}

function store(): Storage | null {
  try {
    // The access itself throws when storage is blocked, so it is inside the try.
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Most recently played first. Anything unrecognisable is treated as absent. */
function read(): Entry[] {
  const raw = store()?.getItem(KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is Entry =>
        typeof entry === 'object' && entry !== null && typeof entry.key === 'string' && !!entry.game,
    );
  } catch {
    return [];
  }
}

function write(entries: Entry[]): void {
  const target = store();
  if (!target) return;
  try {
    target.setItem(KEY, JSON.stringify(entries.slice(0, KEEP)));
  } catch {
    // Out of quota, or storage went away mid-session. The game plays on.
  }
}

export function loadGame(key: string): GameSnapshot | null {
  return read().find((entry) => entry.key === key)?.game ?? null;
}

/**
 * Write a game down, and make it the most recent.
 *
 * A `null` game forgets the key instead — which is what starting over does, and
 * it keeps untouched boards from evicting real progress just by being opened.
 */
export function saveGame(key: string, game: GameSnapshot | null): void {
  const stored = read();
  const rest = stored.filter((entry) => entry.key !== key);
  if (!game) {
    // Nothing stored and nothing to store: leave the store untouched, so merely
    // opening a board neither writes nor reorders anything.
    if (rest.length === stored.length) return;
    write(rest);
    return;
  }
  write([{ key, game }, ...rest]);
}

/**
 * Which of the three lengths the player last chose.
 *
 * Its own key, not part of a game: it is a preference about the game rather than progress in
 * one, and it has to survive the game store being trimmed to `KEEP` entries. Short by
 * default, and anything unreadable is short too — a preference is never a reason a board
 * fails to open.
 */
const BAND_KEY = 'recurse.band.v1';

export function loadBand(bands: number): number {
  try {
    const raw = store()?.getItem(BAND_KEY);
    const band = Number(raw);
    return Number.isInteger(band) && band >= 0 && band < bands ? band : 0;
  } catch {
    return 0;
  }
}

export function saveBand(band: number): void {
  try {
    store()?.setItem(BAND_KEY, String(band));
  } catch {
    // Blocked or full storage means a preference that is not remembered, never a
    // preference that throws. See the note on `write`.
  }
}

/**
 * Every round finished, in the order they were written down.
 *
 * A third key, and a third kind of thing: games are progress, the band is a preference, and
 * this is history. Its own key because it outlives both — the game store keeps thirty
 * entries and evicts the rest, which is about ten days, and a history that ended ten days
 * ago is not a history. See stats.ts for why none of it can be derived from the games.
 *
 * **Nothing is evicted.** A record is a little over a hundred bytes and three boards a day
 * is under a tenth of a megabyte a year, so the quota is not the constraint here; losing the
 * oldest rounds is exactly the failure this store exists to avoid. A player who wants it
 * gone has the clear button, and the export beside it.
 */
const STATS_KEY = 'recurse.stats.v1';

export function loadStats(): Completion[] {
  try {
    const raw = store()?.getItem(STATS_KEY);
    return raw ? readCompletions(JSON.parse(raw)) : [];
  } catch {
    // Unparseable, or storage that threw on being read. An empty history reads as a
    // player who has not played yet, which is wrong but harmless; a screen that will
    // not open is neither.
    return [];
  }
}

export function replaceStats(records: readonly Completion[]): void {
  try {
    store()?.setItem(STATS_KEY, JSON.stringify(records));
  } catch {
    // Out of quota, or no storage at all. The stats are what they were.
  }
}

/**
 * Write a finished round down, unless that puzzle already has one.
 *
 * **First write per pair wins.** A board can be opened again after it is finished — to read
 * the result, to copy the share text — and every one of those visits offers the same round
 * again. Keeping the first is what makes the history a log of rounds rather than of visits,
 * and it is the same rule the import uses, for the same reason.
 *
 * Returns whether anything was written, so a caller can tell "recorded" from "already had it".
 */
export function addCompletion(record: Completion): boolean {
  const records = loadStats();
  if (records.some((one) => one.key === record.key)) return false;
  replaceStats([...records, record]);
  return true;
}

/**
 * The walkthrough: where in it the player got to, and the board they got there on.
 *
 * **Its own key, and that is the whole point.** The tutorial is played on a real puzzle that
 * somebody may want to play properly one day, and the game store is keyed by word pair — so
 * writing the lesson's moves there would hand them that board three quarters solved. Nothing
 * about the tutorial belongs in the record of play either. One slot, holding both halves of
 * where the player is, and a button that empties it.
 *
 * The board it was taught on is stored with it, so a rebuild that changes the lesson's
 * puzzle — or a lesson pointed somewhere new — discards a resume that would otherwise
 * restore one board's moves onto another.
 */
const TUTORIAL_KEY = 'recurse.tutorial.v1';

export interface TutorialSave {
  /** The lesson's board, by id. A save for any other board is not this lesson's. */
  puzzle: string;
  /** Which card, and which beat of it. */
  at: number;
  beat: number;
  /** Beats already answered, as `card#beat`. */
  cleared: string[];
  /** The board as it was left. Null before a move has been made. */
  game: GameSnapshot | null;
}

/** Where the lesson was left, or null if it was not, or was left on another board. */
export function loadTutorial(puzzle: string): TutorialSave | null {
  try {
    const raw = store()?.getItem(TUTORIAL_KEY);
    if (!raw) return null;
    const saved: unknown = JSON.parse(raw);
    if (typeof saved !== 'object' || saved === null) return null;
    const save = saved as Partial<TutorialSave>;
    if (save.puzzle !== puzzle) return null;
    return {
      puzzle,
      // Clamped to something sane rather than trusted: this has sat in a browser across
      // releases, and a card index past the end of the lesson is a tutorial that will not
      // open. Where it lands is bounded again by the lesson itself — see `startAt`.
      at: Number.isInteger(save.at) && save.at! >= 0 ? save.at! : 0,
      beat: Number.isInteger(save.beat) && save.beat! >= 0 ? save.beat! : 0,
      cleared: Array.isArray(save.cleared)
        ? save.cleared.filter((one): one is string => typeof one === 'string')
        : [],
      game: save.game ?? null,
    };
  } catch {
    return null;
  }
}

export function saveTutorial(save: TutorialSave): void {
  try {
    store()?.setItem(TUTORIAL_KEY, JSON.stringify(save));
  } catch {
    // Blocked or full storage means a lesson that starts over, never one that will not start.
  }
}

/** Throw the lesson's progress away, which is what starting it again does. */
export function clearTutorial(): void {
  try {
    store()?.removeItem(TUTORIAL_KEY);
  } catch {
    // See `saveTutorial`.
  }
}

/**
 * Has this browser been offered the tutorial yet?
 *
 * A first visit is greeted with the offer once, and never again whichever way it was
 * answered — taking it and skipping it are both answers. Anyone with a game or a finished
 * round already stored has plainly been here before and is not greeted at all, which is what
 * keeps the prompt from appearing to every existing player the day it ships.
 */
const GREETED_KEY = 'recurse.greeted.v1';

export function isNewcomer(): boolean {
  try {
    const at = store();
    if (!at) return false;
    if (at.getItem(GREETED_KEY)) return false;
    return at.getItem(KEY) === null && at.getItem(STATS_KEY) === null;
  } catch {
    // No storage means no way to remember having asked, and a prompt on every single load
    // is worse than never offering it.
    return false;
  }
}

export function markGreeted(): void {
  try {
    store()?.setItem(GREETED_KEY, '1');
  } catch {
    // See `saveBand`.
  }
}
