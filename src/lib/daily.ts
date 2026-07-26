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

/** Day 0 of the game. */
export const EPOCH = '2026-01-01';

const MS_PER_DAY = 86_400_000;

/** Parse `YYYY-MM-DD` as local midnight, not UTC. */
export function parseLocalDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

/** Local midnight of the given instant. */
export function localMidnight(at: Date): Date {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate());
}

/** Whole days from EPOCH to `at`, in local time. Negative before the epoch. */
export function dayNumber(at: Date = new Date(), epoch: string = EPOCH): number {
  const start = parseLocalDate(epoch).getTime();
  return Math.round((localMidnight(at).getTime() - start) / MS_PER_DAY);
}

/** `YYYY-MM-DD` for a date, in local time. */
export function isoDate(at: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

export interface DailyPuzzle {
  puzzle: Puzzle;
  /** Index into the bank. */
  index: number;
  /** Days since epoch; the number shown to players and used for streaks. */
  day: number;
  date: string;
}

export function puzzleForDay(bank: readonly Puzzle[], day: number): DailyPuzzle {
  if (bank.length === 0) throw new Error('puzzle bank is empty');
  // Works for negative days too, unlike a bare `%`.
  const index = ((day % bank.length) + bank.length) % bank.length;
  return { puzzle: bank[index]!, index, day, date: '' };
}

export function puzzleForDate(bank: readonly Puzzle[], at: Date = new Date()): DailyPuzzle {
  const day = dayNumber(at);
  return { ...puzzleForDay(bank, day), date: isoDate(at) };
}

/**
 * Which puzzle to show, honouring `?day=N` and `?puzzle=N` overrides.
 *
 * `day` is the player-facing number, and is what the archive will eventually
 * link to. `puzzle` addresses the bank directly and exists so tests can pin a
 * known board without depending on today's date.
 */
export function resolvePuzzle(
  bank: readonly Puzzle[],
  search: string,
  now: Date = new Date(),
): DailyPuzzle {
  const params = new URLSearchParams(search);

  const dayParam = params.get('day');
  if (dayParam !== null && Number.isFinite(Number(dayParam))) {
    return { ...puzzleForDay(bank, Number(dayParam)), date: isoDate(now) };
  }

  const index = params.get('puzzle');
  if (index !== null && Number.isFinite(Number(index))) {
    const i = ((Number(index) % bank.length) + bank.length) % bank.length;
    return { puzzle: bank[i]!, index: i, day: i, date: isoDate(now) };
  }

  return puzzleForDate(bank, now);
}
