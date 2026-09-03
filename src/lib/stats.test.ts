/**
 * The history, and the figures read off it.
 *
 * Three things here are worth more than the arithmetic. Streaks have a *definition* rather
 * than a counter, and the definition is where the argument is: one streak and not three, a
 * day counted by its puzzle rather than by when it was played, and backfilled rounds
 * excluded because they are not evidence of anybody turning up. The merge rule is the other:
 * a pair already here wins whole, never field by field. And the version gate is the one
 * place this feature is allowed to refuse a player their own data, so it had better refuse
 * the right file.
 */

import { describe, expect, it } from 'vitest';
import type { GameState } from './game';
import {
  EXPORT_VERSION,
  byBand,
  directness,
  exportStats,
  hintsByKind,
  mergeStats,
  packMarks,
  parBuckets,
  parseStats,
  readCompletions,
  recordOf,
  secrets,
  streaks,
  summary,
  sweeps,
  unpackMarks,
  wordCounts,
  type Completion,
} from './stats';
import type { Puzzle } from './types';

/** A record, with everything not under test set to something unremarkable. */
function done(over: Partial<Completion> = {}): Completion {
  return {
    key: 'base>baseball',
    id: 'aaaa1111',
    day: 0,
    date: '2026-07-26',
    band: 0,
    par: 4,
    secret: 0,
    guesses: 4,
    misses: 0,
    letters: 0,
    shapes: 0,
    marks: 'gggg',
    words: [],
    backfilled: false,
    ...over,
  };
}

const puzzle: Puzzle = {
  id: 'aaaa1111',
  day: 3,
  band: 1,
  source: 'base',
  target: 'cannon',
  par: 5,
  secret: 4,
  corridorSize: 5,
  altNodes: 0,
  shortestPaths: 1,
  maxRank: 0,
  board: [],
};

const move = { to: 'x', sub: 'ball', pos: 4, kind: 'add' } as const;

const state = (over: Partial<GameState> = {}): GameState => ({
  puzzle,
  revealed: new Map(),
  selected: 'base',
  guesses: 2,
  misses: 1,
  solved: true,
  hints: new Map([['cannon', 3]]),
  edgeHints: new Set(['base cannon', 'cannon base']),
  log: [
    { from: 'base', to: 'baseball', move: { ...move, to: 'baseball' }, order: 1 },
    { from: 'baseball', to: 'cannon', move: { ...move, to: 'cannon' }, order: 2 },
  ],
  ...over,
});

describe('marks', () => {
  it('packs a trail into one character per guess, and reads it back', () => {
    const marks = ['shortcut', 'route', 'alternate', 'stray'] as const;
    expect(packMarks(marks)).toBe('*gax');
    expect(unpackMarks('*gax')).toEqual([...marks]);
  });

  it('drops a character it does not recognise rather than inventing a mark', () => {
    expect(unpackMarks('g?g')).toEqual(['route', 'route']);
  });
});

describe('recordOf', () => {
  it('takes the two hint tallies apart, since they are two different purchases', () => {
    const one = recordOf('base>cannon', state(), {
      day: 9,
      date: '2026-08-04',
      marks: ['route', 'stray'],
      backfilled: false,
    });
    // Three letters bought on one word, and two move shapes.
    expect(one.letters).toBe(3);
    expect(one.shapes).toBe(2);
  });

  it('dates the round by the puzzle it was, not by the puzzle`s own first day', () => {
    // A band shorter than the calendar cycles, so one puzzle answers to several dates and
    // `puzzle.day` is only the first of them. The day being played is what is written down.
    const one = recordOf('base>cannon', state(), {
      day: 9,
      date: '2026-08-04',
      marks: [],
      backfilled: false,
    });
    expect(one.day).toBe(9);
    expect(one.date).toBe('2026-08-04');
    expect(puzzle.day).toBe(3);
  });

  it('carries the shortcut the board offered, which is the denominator later', () => {
    const one = recordOf('base>cannon', state(), {
      day: 9,
      date: '2026-08-04',
      marks: [],
      backfilled: false,
    });
    expect(one.secret).toBe(4);
    expect(one.words).toEqual(['baseball', 'cannon']);
  });
});

describe('readCompletions', () => {
  it('keeps what it can read and drops what it cannot', () => {
    const kept = readCompletions([
      done(),
      null,
      7,
      { key: 'a>b' },
      { ...done({ key: 'c>d' }), date: 'yesterday' },
      done({ key: 'e>f' }),
    ]);
    expect(kept.map((one) => one.key)).toEqual(['base>baseball', 'e>f']);
  });

  it('fills in what an older record simply did not have', () => {
    const [one] = readCompletions([{ key: 'a>b', day: 1, date: '2026-07-27', band: 0, par: 3, guesses: 3 }]);
    expect(one).toMatchObject({ secret: 0, letters: 0, shapes: 0, words: [], backfilled: false });
  });

  it('finds nothing in something that is not a list at all', () => {
    expect(readCompletions('nonsense')).toEqual([]);
    expect(readCompletions(null)).toEqual([]);
  });
});

describe('summary', () => {
  it('averages guesses against the par those rounds were actually against', () => {
    const found = summary([done({ guesses: 4, par: 4 }), done({ guesses: 9, par: 7 })]);
    expect(found.played).toBe(2);
    expect(found.guesses).toBe(6.5);
    expect(found.par).toBe(5.5);
    expect(found.diff).toBe(1);
  });

  it('says nothing rather than dividing by zero', () => {
    expect(summary([])).toMatchObject({ played: 0, guesses: 0, diff: 0 });
  });
});

describe('byBand', () => {
  it('is always three numbers, including for a length never played', () => {
    const found = byBand([done({ band: 0, guesses: 3, par: 4 }), done({ band: 2, guesses: 9, par: 7 })], 3);
    expect(found).toHaveLength(3);
    expect(found[0]!.diff).toBe(-1);
    expect(found[1]!.played).toBe(0);
    expect(found[2]!.diff).toBe(2);
  });
});

describe('secrets', () => {
  it('counts only the boards that offered one', () => {
    const found = secrets([
      // Offered and found.
      done({ secret: 3, par: 4, guesses: 3 }),
      // Offered and missed.
      done({ secret: 3, par: 4, guesses: 4 }),
      // Not offered: par was never beatable here, so this is neither.
      done({ secret: 0, par: 4, guesses: 4 }),
    ]);
    expect(found).toEqual({ offered: 2, found: 1 });
  });
});

describe('directness', () => {
  it('is the share of guesses that were on a shortest route or a shortcut', () => {
    expect(directness([done({ marks: 'gg' }), done({ marks: '*xa' })])).toEqual({
      on: 3,
      guesses: 5,
    });
  });
});

describe('hintsByKind', () => {
  it('keeps letters and move shapes apart', () => {
    expect(hintsByKind([done({ letters: 4, shapes: 1 }), done({ letters: 0, shapes: 2 })])).toEqual({
      letters: 4,
      shapes: 3,
    });
  });
});

describe('streaks', () => {
  it('counts days, not rounds: three lengths on one day is one day', () => {
    const day = [0, 1, 2].map((band) => done({ key: `k${band}`, day: 4, band }));
    expect(streaks(day, 4)).toEqual({ current: 1, longest: 1 });
  });

  it('runs back from today, and forgives a day that is not over yet', () => {
    const played = [3, 4, 5].map((day) => done({ key: `k${day}`, day }));
    // Today is day 5 and it is done: three days.
    expect(streaks(played, 5).current).toBe(3);
    // Today is day 6 and nothing has been played yet — still three, because the day is young.
    expect(streaks(played, 6).current).toBe(3);
    // Today is day 7: day 6 went by unplayed and the streak is over.
    expect(streaks(played, 7).current).toBe(0);
  });

  it('fills a gap when the archive is caught up on', () => {
    // Tuesday was missed and then played on Wednesday. A day counts by its puzzle, so the
    // run is unbroken — the record's day is the board's, never the clock's.
    const played = [3, 5].map((day) => done({ key: `k${day}`, day }));
    expect(streaks(played, 5).current).toBe(1);
    expect(streaks([...played, done({ key: 'k4', day: 4 })], 5).current).toBe(3);
  });

  it('remembers the longest run even after it ends', () => {
    const played = [1, 2, 3, 4, 9].map((day) => done({ key: `k${day}`, day }));
    expect(streaks(played, 9)).toEqual({ current: 1, longest: 4 });
  });

  it('ignores backfilled rounds, which say nothing about turning up', () => {
    // A board finished before any of this existed and recovered when it was reopened. It is
    // a real round and counts everywhere else; it is not evidence that anyone played on day 4.
    const played = [
      done({ key: 'a', day: 3 }),
      done({ key: 'b', day: 4, backfilled: true }),
      done({ key: 'c', day: 5 }),
    ];
    expect(streaks(played, 5)).toEqual({ current: 1, longest: 1 });
    expect(summary(played).played).toBe(3);
  });
});

describe('sweeps', () => {
  it('counts the days all three lengths fell on', () => {
    const records = [
      ...[0, 1, 2].map((band) => done({ key: `a${band}`, day: 1, band })),
      ...[0, 1].map((band) => done({ key: `b${band}`, day: 2, band })),
    ];
    expect(sweeps(records, 3)).toBe(1);
  });
});

describe('parBuckets', () => {
  it('spans the range that happened, keeping zero and any empty step in it', () => {
    const found = parBuckets([done({ guesses: 3, par: 4 }), done({ guesses: 6, par: 4 })]);
    expect(found).toEqual([
      { diff: -1, count: 1 },
      { diff: 0, count: 0 },
      { diff: 1, count: 0 },
      { diff: 2, count: 1 },
    ]);
  });

  it('has nothing to say about no rounds', () => {
    expect(parBuckets([])).toEqual([]);
  });
});

describe('wordCounts', () => {
  it('is the words walked through, commonest first and alphabetical on a tie', () => {
    const records = [
      done({ key: 'a', words: ['cage', 'courage'] }),
      done({ key: 'b', words: ['cage', 'base'] }),
    ];
    expect(wordCounts(records, 3)).toEqual([
      { word: 'cage', count: 2 },
      { word: 'base', count: 1 },
      { word: 'courage', count: 1 },
    ]);
  });
});

describe('parseStats', () => {
  const file = exportStats([done()], {
    epoch: '2026-07-26',
    bank: 'abc123',
    exported: '2026-08-04T10:00:00.000Z',
  });

  it('reads back what it wrote', () => {
    const found = parseStats(JSON.parse(JSON.stringify(file)));
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.records).toHaveLength(1);
    expect(found.file.epoch).toBe('2026-07-26');
    expect(found.file.bank).toBe('abc123');
  });

  it('refuses a file from a newer version rather than guessing at it', () => {
    const found = parseStats({ ...file, version: EXPORT_VERSION + 1 });
    expect(found.ok).toBe(false);
    if (found.ok) return;
    expect(found.reason).toContain('newer version');
  });

  it('accepts an older version, which is what a version number is for', () => {
    expect(parseStats({ ...file, version: 0 }).ok).toBe(true);
  });

  it('refuses something that is not a stats file at all', () => {
    for (const nonsense of [null, 42, {}, { app: 'recurse' }, { app: 'other', kind: 'stats' }]) {
      expect(parseStats(nonsense).ok).toBe(false);
    }
  });

  it('drops the records it cannot read and imports the rest, counting the loss', () => {
    const found = parseStats({ ...file, records: [done(), 'rubbish', { key: 'x' }] });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.records).toHaveLength(1);
    expect(found.dropped).toBe(2);
  });
});

describe('mergeStats', () => {
  it('keeps the local record whole where both have the same pair', () => {
    const mine = done({ key: 'base>cannon', guesses: 4, letters: 0 });
    const theirs = done({ key: 'base>cannon', guesses: 9, letters: 20 });
    const found = mergeStats([mine], [theirs]);
    expect(found.records).toEqual([mine]);
    expect(found).toMatchObject({ added: 0, kept: 1 });
  });

  it('never takes half of each, which would describe a round nobody played', () => {
    const found = mergeStats(
      [done({ key: 'a>b', guesses: 4, letters: 0, shapes: 0 })],
      [done({ key: 'a>b', guesses: 4, letters: 11, shapes: 3 })],
    );
    expect(found.records[0]).toMatchObject({ letters: 0, shapes: 0 });
  });

  it('adds a pair it has never seen', () => {
    const found = mergeStats([done({ key: 'a>b' })], [done({ key: 'c>d' })]);
    expect(found.records.map((one) => one.key)).toEqual(['a>b', 'c>d']);
    expect(found).toMatchObject({ added: 1, kept: 0 });
  });

  it('is idempotent, so importing the same file twice changes nothing', () => {
    const theirs = [done({ key: 'c>d' })];
    const once = mergeStats([done({ key: 'a>b' })], theirs);
    const twice = mergeStats(once.records, theirs);
    expect(twice.records).toEqual(once.records);
    expect(twice.added).toBe(0);
  });
});
