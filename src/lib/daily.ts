/**
 * Which puzzle belongs to which day.
 *
 * Deliberately kept trivial and offline: puzzle N is entry `N mod bank.length`,
 * where N counts days since the epoch in the player's *local* time. Local time
 * means everyone gets a new puzzle at their own midnight, which is what people
 * expect from a daily game.
 *
 * Stage 3 (streaks, share strings) will build on `dayNumber`, so it lives here
 * rather than inline in a component.
 */

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

export interface DailyPuzzle {
  puzzle: Puzzle;
  /** Index into the bank. */
  index: number;
  /** Days since epoch; the number shown to players and used for streaks. */
  day: number;
}

/** Wrap a number into the bank. Works for negatives too, unlike a bare `%`. */
function wrap(bank: readonly Puzzle[], n: number): number {
  if (bank.length === 0) throw new Error('puzzle bank is empty');
  return ((n % bank.length) + bank.length) % bank.length;
}

export function puzzleForDay(bank: readonly Puzzle[], day: number): DailyPuzzle {
  const index = wrap(bank, day);
  return { puzzle: bank[index]!, index, day };
}

/**
 * Which puzzle to show, honouring `?day=N` and `?puzzle=N` overrides.
 *
 * `day` is the player-facing number, and is what the archive will eventually
 * link to. `puzzle` addresses the bank directly and exists so tests can pin a
 * known board without depending on today's date — so its number *is* the index,
 * which is what the survey's `№N` quotes.
 */
export function resolvePuzzle(
  bank: readonly Puzzle[],
  search: string,
  now: Date = new Date(),
): DailyPuzzle {
  const params = new URLSearchParams(search);
  const asked = (name: string): number | null => {
    const raw = params.get(name);
    return raw !== null && Number.isFinite(Number(raw)) ? Number(raw) : null;
  };

  const day = asked('day');
  if (day !== null) return puzzleForDay(bank, day);

  const index = asked('puzzle');
  if (index !== null) {
    const at = wrap(bank, index);
    return { puzzle: bank[at]!, index: at, day: at };
  }

  return puzzleForDay(bank, dayNumber(now));
}
