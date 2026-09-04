/**
 * The archive's calendar arithmetic. Worth testing directly: it is the only place in the client
 * that reasons about months, and a grid that is one column out is wrong in a way that looks
 * plausible.
 */

import { describe, expect, it } from 'vitest';
import {
  MONTHS,
  archiveRange,
  clampMonth,
  compareMonths,
  daysInMonth,
  monthDays,
  monthOf,
  stepMonth,
} from './archive';

const EPOCH = '2026-07-26';

describe('months', () => {
  it('reads the month off a date', () => {
    expect(monthOf('2026-07-26')).toEqual({ year: 2026, month: 7 });
    expect(monthOf('2027-01-01')).toEqual({ year: 2027, month: 1 });
  });

  it('steps across a year boundary in both directions', () => {
    expect(stepMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(stepMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
    expect(stepMonth({ year: 2026, month: 7 }, 18)).toEqual({ year: 2028, month: 1 });
    expect(stepMonth({ year: 2026, month: 7 }, -18)).toEqual({ year: 2025, month: 1 });
  });

  it('orders and clamps', () => {
    const first = { year: 2026, month: 7 };
    const last = { year: 2026, month: 9 };
    expect(compareMonths(first, last)).toBeLessThan(0);
    expect(compareMonths(last, first)).toBeGreaterThan(0);
    expect(compareMonths(first, { ...first })).toBe(0);
    expect(clampMonth({ year: 2020, month: 1 }, first, last)).toEqual(first);
    expect(clampMonth({ year: 2030, month: 1 }, first, last)).toEqual(last);
    expect(clampMonth({ year: 2026, month: 8 }, first, last)).toEqual({ year: 2026, month: 8 });
  });

  it('counts days, leap years included', () => {
    expect(daysInMonth({ year: 2026, month: 2 })).toBe(28);
    expect(daysInMonth({ year: 2028, month: 2 })).toBe(29);
    expect(daysInMonth({ year: 2026, month: 7 })).toBe(31);
    expect(daysInMonth({ year: 2026, month: 9 })).toBe(30);
  });

  // What a month is *called* is not here any more: the heading is formatted from the
  // catalog, so this module holds date arithmetic and no English at all.
  it('offers the twelve months as numbers', () => {
    expect(MONTHS).toHaveLength(12);
    expect(MONTHS[0]).toBe(1);
    expect(MONTHS[11]).toBe(12);
  });
});

describe('monthDays', () => {
  it('lists a month in order, and nothing from its neighbours', () => {
    const days = monthDays({ year: 2026, month: 7 }, 5, EPOCH);
    expect(days).toHaveLength(31);
    expect(days[0]!.date).toBe('2026-07-01');
    expect(days.at(-1)!.date).toBe('2026-07-31');
    expect(days.every((day) => day.date.startsWith('2026-07'))).toBe(true);
  });

  it('numbers days from the epoch and marks what has been played', () => {
    // Epoch is 26 July, so that is day 0 and 29 July is day 3.
    const days = monthDays({ year: 2026, month: 7 }, 3, EPOCH);
    const on = (date: string) => days.find((day) => day.date === date)!;
    expect(on('2026-07-26').day).toBe(0);
    expect(on('2026-07-29').day).toBe(3);
    expect(on('2026-07-25').day).toBe(-1);

    // Before the game began, and after today, are both unplayable — for opposite reasons.
    expect(on('2026-07-25').played).toBe(false);
    expect(on('2026-07-26').played).toBe(true);
    expect(on('2026-07-29').played).toBe(true);
    expect(on('2026-07-30').played).toBe(false);
    expect(on('2026-07-29').today).toBe(true);
    expect(on('2026-07-28').today).toBe(false);
  });

  it('counts a short month and a leap February', () => {
    expect(monthDays({ year: 2026, month: 9 }, 0, EPOCH)).toHaveLength(30);
    expect(monthDays({ year: 2028, month: 2 }, 0, EPOCH)).toHaveLength(29);
  });
});

describe('archiveRange', () => {
  it('runs from the epoch to the month today is in', () => {
    expect(archiveRange(EPOCH, 0)).toEqual({
      first: { year: 2026, month: 7 },
      last: { year: 2026, month: 7 },
    });
    // 100 days on from 26 July is 3 November.
    expect(archiveRange(EPOCH, 100).last).toEqual({ year: 2026, month: 11 });
    // And well over a year.
    expect(archiveRange(EPOCH, 500).last).toEqual({ year: 2027, month: 12 });
  });
});
