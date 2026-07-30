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
 * Day 0 of the game, as a fallback for the handful of pure-arithmetic helpers below.
 *
 * **The manifest is the real answer** — `RECURSE_EPOCH` in .env, shipped in
 * `manifest.json`, because the builder names its calendar files by calendar year and so has
 * to count from the same day the browser does. This constant is only the default for callers
 * that have no manifest in hand, which is tests and nothing else.
 *
 * Moving it reassigns every date, so it is set once, at launch, and then left alone: a
 * player's day number and their streak both count from here.
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

/**
 * Which day of a year a `YYYY-MM-DD` date is, counting from 0.
 *
 * Where a date sits inside its own calendar file. Built from the local calendar like everything
 * else here, so it agrees with `dayNumber` across a DST boundary; the builder's `day_of_year`
 * computes the same thing over civil dates, and the two meet in the year files.
 */
export function dayOfYear(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const at = new Date(y!, (m ?? 1) - 1, d ?? 1).getTime();
  return Math.round((at - new Date(y!, 0, 1).getTime()) / MS_PER_DAY);
}

export interface DailyPuzzle {
  puzzle: Puzzle;
  /** Days since epoch; the number shown to players and used for streaks. */
  day: number;
}

/**
 * Wrap a day number into the calendar. Works for negatives too, unlike a bare `%`.
 *
 * `days` is the manifest's calendar length — one number now, for all three lengths, because
 * every band runs the whole calendar. It used to be per band, and the shortest band's length
 * was where the game started repeating itself; a band shorter than the calendar cycles inside
 * it instead, which the builder does when it writes the year files.
 *
 * The wrap only matters at the far end: the builder writes a file per year up to the calendar's
 * length, about forty-five of them, and a day past the last one comes round to the start.
 */
export function dayIndex(day: number, days: number): number {
  if (days <= 0) throw new Error('the calendar is empty');
  return ((day % days) + days) % days;
}

/** The puzzle with this id, or null when the loaded shard has no such puzzle. */
export function puzzleById(bank: readonly Puzzle[], id: string): DailyPuzzle | null {
  const puzzle = bank.find((candidate) => candidate.id === id);
  return puzzle ? { puzzle, day: puzzle.day } : null;
}

/**
 * Which puzzle a URL is asking for: `path` is `window.location.pathname`.
 *
 * The one named by the path, or the one `today` names when the path names nothing the loaded
 * shard holds. An id that resolves to nothing — a link shared before a rebuild changed that
 * answer — falls back the same way, and the caller rewrites the URL to say so.
 *
 * `today` is the id the calendar gives for the band and day being opened, looked up before
 * this is called: a date is a file lookup now rather than arithmetic, so it cannot be done
 * here without a fetch. See `idOnDay` in data.ts.
 */
export function resolvePuzzle(
  bank: readonly Puzzle[],
  path: string,
  today: string | null,
): DailyPuzzle | null {
  const id = idFromPath(path);
  const asked = id === null ? null : puzzleById(bank, id);
  return asked ?? (today === null ? null : puzzleById(bank, today));
}
