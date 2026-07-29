/**
 * Which puzzle belongs to which day, and which puzzle a URL is asking for.
 *
 * Deliberately kept trivial and offline: puzzle N is entry `N mod bank.length`,
 * where N counts days since the epoch in the player's *local* time. Local time
 * means everyone gets a new puzzle at their own midnight, which is what people
 * expect from a daily game.
 *
 * The calendar and the address are separate things now. A puzzle is *reached* by
 * its id (see route.ts), which is what a shared link carries; the day number is
 * what the game calls it, and belongs to the share text and the streak rather than
 * to the URL. Nothing enumerable addresses a board, or a link to today would also
 * be a link to every puzzle after it.
 */

import { idFromPath } from './route';
import type { Puzzle } from './types';

/**
 * Day 0 of the game.
 *
 * Moving this reassigns every date, so it is set once, at launch, and then left
 * alone: a player's day number and their streak both count from here. It was a
 * placeholder in the past for a while, which meant the first two hundred puzzles
 * in the bank were spent on days nobody played.
 */
export const EPOCH = '2026-07-26';

const MS_PER_DAY = 86_400_000;

/** Local midnight of the given instant. Days turn over where the player is. */
function localMidnight(at: Date): number {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
}

/** Whole days from EPOCH to `at`, in local time. Negative before the epoch. */
export function dayNumber(at: Date = new Date(), epoch: string = EPOCH): number {
  const [y, m, d] = epoch.split('-').map(Number);
  const start = new Date(y!, (m ?? 1) - 1, d ?? 1).getTime();
  // Rounded, not floored: a DST boundary between here and the epoch shifts the
  // difference by an hour, which would otherwise lose or repeat a day.
  return Math.round((localMidnight(at) - start) / MS_PER_DAY);
}

/**
 * The date a day number falls on, as `YYYY-MM-DD`.
 *
 * ISO rather than anything friendlier because this goes into the share text, where
 * it is read by people in every locale — `07/03` is two different days depending on
 * who is holding it. Built by walking the local calendar, so it agrees with
 * `dayNumber`, which counts local midnights.
 */
export function dateForDay(day: number, epoch: string = EPOCH): string {
  const [y, m, d] = epoch.split('-').map(Number);
  const at = new Date(y!, (m ?? 1) - 1, (d ?? 1) + day);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

export interface DailyPuzzle {
  puzzle: Puzzle;
  /** Days since epoch; the number shown to players and used for streaks. */
  day: number;
}

/**
 * Wrap a day number into the calendar. Works for negatives too, unlike a bare `%`.
 *
 * `days` is the manifest's calendar length rather than the number of puzzles loaded:
 * only one shard is in memory, so the bank's own size says nothing about the calendar.
 * This is the definition the builder's shard alignment is stated in, so it is also what
 * data.ts uses to decide which shard to fetch.
 */
export function dayIndex(day: number, days: number): number {
  if (days <= 0) throw new Error('the calendar is empty');
  return ((day % days) + days) % days;
}

/**
 * The puzzle for a band on a day, from the shard that band and day name.
 *
 * A puzzle carries its own day *and* its own band, assigned by the builder, so this is a
 * lookup rather than arithmetic over an array — `bank` holds the ~450 puzzles of one shard,
 * in no particular order, and 114,000 others are not in memory. Null when that day is not in
 * this shard, which means the wrong shard was fetched.
 *
 * `days` is the length of *that band's* calendar, not the bank's: every day offers one board
 * of each length and the three bands run out at different points, so each wraps on its own.
 */
export function puzzleForDay(
  bank: readonly Puzzle[],
  band: number,
  day: number,
  days: number,
): DailyPuzzle | null {
  const wanted = dayIndex(day, days);
  const puzzle = bank.find(
    (candidate) => candidate.day === wanted && candidate.band === band,
  );
  return puzzle ? { puzzle, day: wanted } : null;
}

/** The puzzle with this id, or null when the loaded shard has no such puzzle. */
export function puzzleById(bank: readonly Puzzle[], id: string): DailyPuzzle | null {
  const puzzle = bank.find((candidate) => candidate.id === id);
  return puzzle ? { puzzle, day: puzzle.day } : null;
}

/**
 * Which puzzle a URL is asking for: `path` is `window.location.pathname`.
 *
 * Today's, unless the path names a puzzle in the loaded shard. An id that names nothing
 * — a link shared before a rebuild changed that answer — gets today rather than an
 * error, and the caller rewrites the URL to say so.
 *
 * `band` is which length "today" means, since a day offers three. It is the band the player
 * last chose; the fallback only reaches for it when the path names nothing.
 */
export function resolvePuzzle(
  bank: readonly Puzzle[],
  path: string,
  band: number,
  days: number,
  now: Date = new Date(),
): DailyPuzzle | null {
  const id = idFromPath(path);
  const asked = id === null ? null : puzzleById(bank, id);
  return asked ?? puzzleForDay(bank, band, dayNumber(now), days);
}
