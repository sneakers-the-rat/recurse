/**
 * Which puzzle belongs to which day. Untested until now, which is a poor bet for
 * arithmetic that has to survive time zones, DST and a bank shorter than the
 * calendar.
 */

import { describe, expect, it } from 'vitest';
import {
  EPOCH,
  dateForDay,
  dayIndex,
  dayNumber,
  puzzleById,
  puzzleForDay,
  resolvePuzzle,
} from './daily';
import { pathFor } from './route';
import { shardOf } from './data';
import { shippedData } from '../test/shipped';
import type { Puzzle } from './types';

/**
 * One shard's worth of puzzles.
 *
 * Days are not the array positions and the ids are not in order, so nothing here can
 * pass by treating either as the other — which is the whole point of the puzzles
 * carrying their own day now that only a slice of the bank is ever in memory.
 */
const bank: Puzzle[] = ['a', 'b', 'c'].map((source, i) => ({
  id: ['c0ffee11', 'ba5eba11', 'decafbad'][i]!,
  day: [0, 1, 2][i]!,
  source,
  target: 'z',
  par: 3,
  secret: 0,
  corridorSize: 10,
  altNodes: 4,
  shortestPaths: 1,
  maxRank: 0,
  board: [],
}));

/** The calendar these tests pretend to have, which the shard covers all of. */
const DAYS = 3;

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

describe('dateForDay', () => {
  it('names the date a day number falls on', () => {
    expect(dateForDay(0, FROM)).toBe('2026-01-01');
    expect(dateForDay(31, FROM)).toBe('2026-02-01');
    expect(dateForDay(365, FROM)).toBe('2027-01-01');
  });

  it('starts the real game on its own epoch', () => {
    expect(dateForDay(0)).toBe(EPOCH);
  });

  it('agrees with dayNumber, including either side of a DST change', () => {
    // The share text quotes both, so a day that names the wrong date is a score
    // filed under someone else's puzzle.
    for (const day of [0, 66, 67, 303, 304, 365]) {
      expect(dayNumber(local(dateForDay(day, FROM)), FROM)).toBe(day);
    }
  });
});

describe('dayIndex', () => {
  it('wraps a calendar shorter than the run of days', () => {
    expect(dayIndex(4, DAYS)).toBe(1);
  });

  it('wraps negatives forward rather than off the end', () => {
    expect(dayIndex(-1, DAYS)).toBe(2);
  });

  it('refuses an empty calendar rather than dividing by zero', () => {
    expect(() => dayIndex(0, 0)).toThrow(/empty/);
  });
});

describe('puzzleForDay', () => {
  it('finds the puzzle whose own day matches, wrapping the calendar', () => {
    expect(puzzleForDay(bank, 4, DAYS)).toMatchObject({ day: 1 });
    expect(puzzleForDay(bank, 4, DAYS)?.puzzle.id).toBe('ba5eba11');
  });

  it('wraps negatives forward rather than off the end', () => {
    expect(puzzleForDay(bank, -1, DAYS)).toMatchObject({ day: 2 });
  });

  it('knows nothing of a day this shard does not hold', () => {
    // Which is what fetching the wrong shard looks like, rather than a bad day number.
    expect(puzzleForDay([bank[0]!], 1, DAYS)).toBeNull();
  });
});

describe('puzzleById', () => {
  it('finds a puzzle by the id it ships with, and calls it by its own day', () => {
    expect(puzzleById(bank, 'decafbad')).toMatchObject({ day: 2 });
  });

  it('knows nothing of an id the bank does not have', () => {
    // What a link shared before a rebuild changed that answer looks like.
    expect(puzzleById(bank, 'deadbeef')).toBeNull();
  });
});

describe('resolvePuzzle', () => {
  // Whatever the epoch is, an unqualified visit gets that date's puzzle.
  const someday = local('2027-03-05');

  it('serves today at the root', () => {
    expect(resolvePuzzle(bank, '/', DAYS, someday)).toEqual(
      puzzleForDay(bank, dayNumber(someday), DAYS),
    );
  });

  it('starts the game on day 0 of its epoch', () => {
    expect(resolvePuzzle(bank, '/', DAYS, local(EPOCH))).toMatchObject({ day: 0 });
  });

  it('serves the puzzle a path names, whether or not it is today', () => {
    expect(resolvePuzzle(bank, '/ba5eba11', DAYS, someday)).toMatchObject({ day: 1 });
  });

  it('falls back to today for an id the shard no longer has', () => {
    // A link from before a rebuild. Today's board beats an error page.
    expect(resolvePuzzle(bank, '/deadbeef', DAYS, someday)).toEqual(
      puzzleForDay(bank, dayNumber(someday), DAYS),
    );
  });

  it('falls back to today for a path that names no puzzle at all', () => {
    for (const path of ['/about', '/zzz', '/12', '']) {
      expect(resolvePuzzle(bank, path, DAYS, someday)).toEqual(
        puzzleForDay(bank, dayNumber(someday), DAYS),
      );
    }
  });
});

/**
 * The shipped bank, because an id is a promise about the whole of it: every board
 * has an address, no two boards share one, and the address is what a link carries.
 * The builder checks the same thing and refuses to write a bank that fails it —
 * this is the check on the data that actually shipped.
 */
describe('the shipped bank', () => {
  const { puzzles, manifest } = shippedData();

  it('gives every puzzle an id, all of one form', () => {
    expect(puzzles.length).toBeGreaterThan(100);
    // The length is RECURSE_ID_CHARS and is not pinned here: it is a digest parameter,
    // so changing it changes every id, and this asks only that they agree with each
    // other. An id of a different length in the same bank would be the real fault.
    const width = puzzles[0]!.id.length;
    expect(width).toBeGreaterThanOrEqual(8);
    for (const puzzle of puzzles) {
      expect(puzzle.id).toMatch(new RegExp(`^[0-9a-f]{${width}}$`));
    }
  });

  it('puts every puzzle in the shard its id names', () => {
    // The whole of how a shared link is resolved in one fetch: the first two hex
    // digits of the id are the file it lives in. This shard is 00.
    for (const puzzle of puzzles) {
      expect(shardOf(puzzle.id)).toBe(0);
    }
  });

  it('puts every day in the shard its number names', () => {
    // What lets today's board be found without an index, checked on real data: day N
    // is in shard N % shards, so every day in shard 00 is a multiple of 256.
    for (const puzzle of puzzles) {
      if (puzzle.day < manifest.days) {
        expect(puzzle.day % manifest.shards).toBe(0);
      }
    }
  });

  it('gives no two puzzles the same address', () => {
    expect(new Set(puzzles.map((p) => p.id)).size).toBe(puzzles.length);
  });

  it('resolves every id back to the puzzle it names', () => {
    // The round trip a shared link makes: id -> path -> the board on screen.
    for (const puzzle of puzzles) {
      const found = resolvePuzzle(puzzles, pathFor(puzzle.id, '', '/'), manifest.days);
      expect(found?.puzzle).toBe(puzzle);
    }
  });
});
