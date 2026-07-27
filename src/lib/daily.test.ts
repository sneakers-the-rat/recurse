/**
 * Which puzzle belongs to which day. Untested until now, which is a poor bet for
 * arithmetic that has to survive time zones, DST and a bank shorter than the
 * calendar.
 */

import { describe, expect, it } from 'vitest';
import { EPOCH, dayNumber, puzzleForDay, resolvePuzzle } from './daily';
import type { Puzzle } from './types';

const bank: Puzzle[] = ['a', 'b', 'c'].map((source) => ({
  source,
  target: 'z',
  par: 3,
  secret: 0,
  corridorSize: 10,
  altNodes: 4,
  shortestPaths: 1,
  maxRank: 0,
}));

const local = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d!, 12, 0, 0);
};

/**
 * A fixed epoch of this file's own. These test the arithmetic, not the launch
 * date — pinning them to whatever `EPOCH` happens to be meant that moving the
 * launch date broke four unrelated assertions about leap years and DST.
 */
const FROM = '2026-01-01';

describe('dayNumber', () => {
  it('counts from the epoch, in local time', () => {
    expect(dayNumber(local(FROM), FROM)).toBe(0);
    expect(dayNumber(local('2026-01-02'), FROM)).toBe(1);
    // 2026 is not a leap year.
    expect(dayNumber(local('2027-01-01'), FROM)).toBe(365);
  });

  it('is negative before the epoch', () => {
    expect(dayNumber(local('2025-12-31'), FROM)).toBe(-1);
  });

  it('starts the real game on its own epoch', () => {
    expect(dayNumber(local(EPOCH))).toBe(0);
  });

  it('turns over at local midnight, not UTC', () => {
    // A minute either side of midnight is a different day wherever you are.
    const midnight = new Date(2026, 0, 2, 0, 0, 0);
    const before = new Date(2026, 0, 1, 23, 59, 0);
    expect(dayNumber(midnight, FROM)).toBe(1);
    expect(dayNumber(before, FROM)).toBe(0);
  });

  it('does not lose a day across a DST boundary', () => {
    // Consecutive dates must differ by exactly one, whatever the clocks did.
    for (const [a, b] of [
      ['2026-03-07', '2026-03-08'],
      ['2026-03-08', '2026-03-09'],
      ['2026-10-31', '2026-11-01'],
      ['2026-11-01', '2026-11-02'],
    ]) {
      expect(dayNumber(local(b!), FROM) - dayNumber(local(a!), FROM)).toBe(1);
    }
  });
});

describe('puzzleForDay', () => {
  it('wraps around a bank shorter than the calendar', () => {
    expect(puzzleForDay(bank, 4)).toMatchObject({ index: 1, day: 4 });
  });

  it('wraps negatives forward rather than off the end', () => {
    expect(puzzleForDay(bank, -1)).toMatchObject({ index: 2, day: -1 });
  });

  it('refuses an empty bank rather than serving undefined', () => {
    expect(() => puzzleForDay([], 0)).toThrow(/empty/);
  });
});

describe('resolvePuzzle', () => {
  // Whatever the epoch is, an unqualified visit gets that date's puzzle.
  const someday = local('2027-03-05');

  it('serves today by default', () => {
    expect(resolvePuzzle(bank, '', someday)).toEqual(puzzleForDay(bank, dayNumber(someday)));
  });

  it('starts the game on day 0 of its epoch', () => {
    expect(resolvePuzzle(bank, '', local(EPOCH))).toMatchObject({ day: 0, index: 0 });
  });

  it('honours ?day as the player-facing number', () => {
    expect(resolvePuzzle(bank, '?day=7', someday)).toMatchObject({ day: 7, index: 1 });
  });

  it('honours ?puzzle as a direct index into the bank', () => {
    // This is what `№N` in the survey means, so it must not be day arithmetic.
    expect(resolvePuzzle(bank, '?puzzle=2', someday)).toMatchObject({ index: 2, day: 2 });
  });

  it('ignores a parameter that is not a number', () => {
    expect(resolvePuzzle(bank, '?day=soon', someday)).toEqual(
      puzzleForDay(bank, dayNumber(someday)),
    );
  });
});
