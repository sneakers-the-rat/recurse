/**
 * The calendar the archive is browsed by: which dates a month holds, and which of them have
 * happened.
 *
 * All of it arithmetic over local dates, and none of it about puzzles — the archive page turns a
 * date into a board by asking the year file for its ids, the same way playing today does (see
 * `idForDay` in data.ts). This is only the grid.
 *
 * **Local dates throughout**, like `dayNumber`: a day turns over at the player's own midnight,
 * so "today" on the calendar has to be their today. Dates are the `YYYY-MM-DD` strings the rest
 * of the client passes around, and a month is a year and a 1-based month because that is what a
 * person reading a calendar means by one.
 */

import { dayNumber } from './daily';

/** A month of the calendar. `month` is 1-12, as a human writes it. */
export interface Month {
  year: number;
  month: number;
}

/** One square of the grid: a date, its day number, and whether it can be played. */
export interface Square {
  /** `YYYY-MM-DD`, local. */
  date: string;
  /** Days since the epoch. Negative before the game began. */
  day: number;
  /**
   * Between the epoch and today inclusive.
   *
   * The upper bound is why the archive is an archive: a future board exists in the data and
   * nothing stops a determined reader finding it, but the page does not hand it over. Not
   * security — there is nothing to secure — just the difference between an archive and a spoiler.
   */
  played: boolean;
  /** Today, which the grid marks. */
  today: boolean;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The month a `YYYY-MM-DD` date is in. */
export function monthOf(date: string): Month {
  const [year, month] = date.split('-').map(Number);
  return { year: year ?? 1970, month: month ?? 1 };
}

/** `by` months later, or earlier. Carries the year over in both directions. */
export function stepMonth(at: Month, by: number): Month {
  const zero = at.year * 12 + (at.month - 1) + by;
  return { year: Math.floor(zero / 12), month: (((zero % 12) + 12) % 12) + 1 };
}

/** Negative when `a` is earlier, so months sort and clamp like numbers. */
export function compareMonths(a: Month, b: Month): number {
  return a.year * 12 + a.month - (b.year * 12 + b.month);
}

/** Held between the first month and the last, so navigation cannot leave the archive. */
export function clampMonth(at: Month, first: Month, last: Month): Month {
  if (compareMonths(at, first) < 0) return first;
  if (compareMonths(at, last) > 0) return last;
  return at;
}

/**
 * The twelve months, as the numbers a person writes them with.
 *
 * Numbers rather than names, because this module is arithmetic over dates and a month's
 * *name* is language. What a month is called lives in the catalog — `archive.monthName`
 * and `archive.monthShort` — where a translator can reach it and where the year can go
 * before the month if that is what the language does. This used to be a list of English
 * strings and a `monthName` that glued the year onto the end of one, which is the one
 * shape of sentence some languages cannot be written in.
 */
export const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

/** Days in a month, from the local calendar rather than a table with a leap-year rule in it. */
export function daysInMonth(at: Month): number {
  return new Date(at.year, at.month, 0).getDate();
}

/**
 * The days of a month, in order, with what is known about each.
 *
 * A flat list rather than a grid of weeks. The archive draws every day as a row of three boards —
 * one per length — because a seven-column month is never wide enough to read three word pairs in
 * a square, on any screen: a desktop column is about 100px and a phone's is 58, and the words are
 * longer than either. So there is no week structure to build, no leading blanks, and no
 * first-day-of-week question to get wrong.
 */
export function monthDays(at: Month, today: number, epoch: string): Square[] {
  const days: Square[] = [];
  for (let day = 1; day <= daysInMonth(at); day++) {
    const date = `${at.year}-${pad(at.month)}-${pad(day)}`;
    const number = dayNumber(new Date(at.year, at.month - 1, day), epoch);
    days.push({
      date,
      day: number,
      played: number >= 0 && number <= today,
      today: number === today,
    });
  }
  return days;
}

/**
 * Which months the archive covers: the epoch's, through the one today is in.
 *
 * Not the whole calendar the builder wrote — that runs decades ahead — because the archive is
 * what has happened. The year view offers the months of one year, held to the same range.
 */
export function archiveRange(epoch: string, today: number): { first: Month; last: Month } {
  const first = monthOf(epoch);
  const [year, month, day] = epoch.split('-').map(Number);
  const at = new Date(year ?? 1970, (month ?? 1) - 1, (day ?? 1) + today);
  return { first, last: { year: at.getFullYear(), month: at.getMonth() + 1 } };
}
