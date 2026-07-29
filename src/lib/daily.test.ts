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
import { bandOf, shardForDay, shardOf } from './data';
import { DEFAULT_BAND, shippedData } from '../test/shipped';
import type { Puzzle } from './types';

/**
 * One shard's worth of puzzles.
 *
 * Days are not the array positions and the ids are not in order, so nothing here can
 * pass by treating either as the other — which is the whole point of the puzzles
 * carrying their own day now that only a slice of the bank is ever in memory.
 *
 * Two bands' worth, on the same days, because that is the shape a real day has: three
 * lengths, one board each. A lookup that ignores the band finds the wrong one.
 */
const bank: Puzzle[] = [
  ['a', 0, 0, 'c0ffee11'],
  ['b', 1, 0, 'ba5eba11'],
  ['c', 2, 0, 'decafbad'],
  ['aa', 0, 1, 'facef00d'],
  ['bb', 1, 1, 'cafed00d'],
  ['cc', 2, 1, 'badc0ffe'],
].map(([source, day, band, id]) => ({
  id: id as string,
  day: day as number,
  band: band as number,
  source: source as string,
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
    expect(puzzleForDay(bank, 0, 4, DAYS)).toMatchObject({ day: 1 });
    expect(puzzleForDay(bank, 0, 4, DAYS)?.puzzle.id).toBe('ba5eba11');
  });

  it('wraps negatives forward rather than off the end', () => {
    expect(puzzleForDay(bank, 0, -1, DAYS)).toMatchObject({ day: 2 });
  });

  it('finds the length asked for, not whichever board that day has first', () => {
    // A day offers one board of each length, so the day alone does not name a puzzle.
    expect(puzzleForDay(bank, 0, 1, DAYS)?.puzzle.id).toBe('ba5eba11');
    expect(puzzleForDay(bank, 1, 1, DAYS)?.puzzle.id).toBe('cafed00d');
  });

  it('knows nothing of a day this shard does not hold', () => {
    // Which is what fetching the wrong shard looks like, rather than a bad day number.
    expect(puzzleForDay([bank[0]!], 0, 1, DAYS)).toBeNull();
  });

  it('knows nothing of a length this shard does not hold', () => {
    // The same thing from the other side: the day's three boards are in three shards, so a
    // shard that holds day 1 need not hold day 1 of the band being asked about.
    expect(puzzleForDay(bank, 2, 1, DAYS)).toBeNull();
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
  const short = 0;

  it('serves today at the root', () => {
    expect(resolvePuzzle(bank, '/', short, DAYS, someday)).toEqual(
      puzzleForDay(bank, short, dayNumber(someday), DAYS),
    );
  });

  it('starts the game on day 0 of its epoch', () => {
    expect(resolvePuzzle(bank, '/', short, DAYS, local(EPOCH))).toMatchObject({ day: 0 });
  });

  it('serves the puzzle a path names, whether or not it is today', () => {
    expect(resolvePuzzle(bank, '/ba5eba11', short, DAYS, someday)).toMatchObject({ day: 1 });
  });

  it('serves the length the path names, not the one asked for as a fallback', () => {
    // An id is the whole address, so it decides the length too — a link to a long board opens
    // a long board however the player last left the switch.
    expect(resolvePuzzle(bank, '/cafed00d', short, DAYS, someday)?.puzzle.band).toBe(1);
  });

  it('falls back to today in the length asked for', () => {
    // A link from before a rebuild. Today's board beats an error page, and which of the day's
    // three it is comes from the switch rather than from the dead id.
    for (const band of [0, 1]) {
      expect(resolvePuzzle(bank, '/deadbeef', band, DAYS, someday)).toEqual(
        puzzleForDay(bank, band, dayNumber(someday), DAYS),
      );
    }
  });

  it('falls back to today for a path that names no puzzle at all', () => {
    for (const path of ['/about', '/zzz', '/12', '']) {
      expect(resolvePuzzle(bank, path, short, DAYS, someday)).toEqual(
        puzzleForDay(bank, short, dayNumber(someday), DAYS),
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
  /**
   * Which shard this is: the one holding today's *short* board, because that is the one the
   * app has in memory on a fresh visit. Not a constant — `shippedData` used to take it for
   * shard 00 and everything about today was wrong on any day but the first.
   */
  const index = shardForDay(DEFAULT_BAND, dayNumber(), manifest);

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
    // digits of the id are the file it lives in.
    for (const puzzle of puzzles) {
      expect(shardOf(puzzle.id)).toBe(index);
    }
  });

  it('puts every board in the shard its band and day name', () => {
    // What lets a board be found without an index, checked on real data: band B on day N is
    // in shard `(N * 3 + B) % shards`, so every dated board in this file agrees with the
    // arithmetic the client uses to have asked for it.
    for (const puzzle of puzzles) {
      if (puzzle.day < bandOf(puzzle.band, manifest).days) {
        expect(shardForDay(puzzle.band, puzzle.day, manifest)).toBe(index);
      }
    }
  });

  it('gives no two puzzles the same address', () => {
    expect(new Set(puzzles.map((p) => p.id)).size).toBe(puzzles.length);
  });

  it('resolves every id back to the puzzle it names', () => {
    // The round trip a shared link makes: id -> path -> the board on screen. The band asked
    // for is the fallback's business only, so an id resolves the same whatever it is.
    for (const puzzle of puzzles) {
      const path = pathFor(puzzle.id, '', '/');
      const found = resolvePuzzle(puzzles, path, DEFAULT_BAND, bandOf(DEFAULT_BAND, manifest).days);
      expect(found?.puzzle).toBe(puzzle);
    }
  });
});
