/**
 * found.ts on its own. game.test.ts covers it through the daily game; this covers the `rank`
 * and `elsewhere` arguments the daily game only ever passes one way.
 */

import { describe, expect, it } from 'vitest';
import { testGraph } from '../test/fixture';
import {
  advance,
  edgeKey,
  guessedWords,
  joins,
  moveKey,
  newGuess,
  open,
  replay,
  type Found,
} from './found';
import { judgeGuess } from './moves';
import type { Judgement, Move } from './types';

const graph = testGraph();

function judged(from: string, word: string): Extract<Judgement, { ok: true }> {
  const verdict = judgeGuess(graph, from, word, graph.isWord);
  if (!verdict.ok) throw new Error(`${from} -> ${word} is not a move: ${verdict.code}`);
  return verdict;
}

/** A fake move, for cases the test graph does not have. */
const madeUp = (to: string): Move => ({ to, sub: 'xx', pos: 0, kind: 'add' });

const start = graph.words.find((word) => graph.neighbors(word).length >= 2)!;
const [first, second] = graph.neighbors(start) as [string, string];

describe('open', () => {
  it('starts with one word, reached by nothing', () => {
    const found = open(start);
    expect([...found.revealed.keys()]).toEqual([start]);
    expect(found.revealed.get(start)).toEqual({ word: start, via: null, move: null, order: 0 });
    expect(found.log).toEqual([]);
    expect(found.guesses).toBe(0);
  });
});

describe('advance', () => {
  it('reveals what it lands on, once, and remembers how it got there', () => {
    const step = advance(open(start), start, judged(start, first));

    expect(step.moved).toBe(true);
    expect(step.landed).toBe(first);
    expect(step.found.guesses).toBe(1);
    expect(step.found.revealed.get(first)).toMatchObject({ via: start, order: 1 });
    expect(step.found.log).toHaveLength(1);
  });

  it('charges nothing for a move already made, and still moves the cursor', () => {
    const there = advance(open(start), start, judged(start, first));
    const back = advance(there.found, first, judged(first, start));
    expect(back.moved).toBe(false);
    expect(back.landed).toBe(start);
    expect(back.found).toBe(there.found);
    expect(back.found.guesses).toBe(1);
  });

  it('lands on whichever reading the caller ranks best', () => {
    const both: Extract<Judgement, { ok: true }> = {
      ok: true,
      word: 'aaaa',
      move: madeUp('aaaa'),
      also: [{ word: 'bbbb', move: madeUp('bbbb') }],
    };
    const wants = (wanted: string) => (word: string) => (word === wanted ? 0 : 1);

    expect(advance(open(start), start, both, wants('bbbb')).landed).toBe('bbbb');
    expect(advance(open(start), start, both, wants('aaaa')).landed).toBe('aaaa');
    // No rank: the first reading.
    expect(advance(open(start), start, both).landed).toBe('aaaa');
  });

  it('plays every reading the guess named, as one guess', () => {
    const both: Extract<Judgement, { ok: true }> = {
      ok: true,
      word: 'aaaa',
      move: madeUp('aaaa'),
      also: [{ word: 'bbbb', move: madeUp('bbbb') }],
    };
    const step = advance(open(start), start, both, (word) => (word === 'bbbb' ? 0 : 1));

    expect(step.found.guesses).toBe(1);
    expect(step.found.log.map((entry) => entry.to)).toEqual(['bbbb', 'aaaa']);
    expect(step.found.log.every((entry) => entry.order === 1)).toBe(true);
    expect(guessedWords(step.found.log)).toEqual(['bbbb']);
  });

  it('never repeats a token a guess named twice', () => {
    const twice: Extract<Judgement, { ok: true }> = {
      ok: true,
      word: 'aaaa',
      move: madeUp('aaaa'),
      also: [{ word: 'aaaa', move: madeUp('aaaa') }],
    };
    expect(advance(open(start), start, twice).found.log).toHaveLength(1);
  });

  it('leaves a word’s first arrival alone when it is reached a second way', () => {
    let found: Found = open(start);
    found = advance(found, start, judged(start, first)).found;
    found = advance(found, start, judged(start, second)).found;
    const arrival = found.revealed.get(first);

    const again = advance(found, second, {
      ok: true,
      word: first,
      move: madeUp(first),
      also: [],
    });
    expect(again.found.revealed.get(first)).toEqual(arrival);
    expect(again.found.log).toHaveLength(3);
  });
});

describe('replay', () => {
  it('takes a log back, numbering the guesses rather than trusting them', () => {
    const played = advance(
      advance(open(start), start, judged(start, first)).found,
      start,
      judged(start, second),
    ).found;
    const back = replay(played.log, start);

    expect(back.guesses).toBe(played.guesses);
    expect([...back.revealed.keys()].sort()).toEqual([...played.revealed.keys()].sort());
    expect(back.log).toEqual(played.log);
  });

  it('refuses a move from nowhere, and accepts one from `elsewhere`', () => {
    const log = [{ from: 'nowhere', to: first, move: madeUp(first), order: 1 }];

    expect(replay(log, start).log).toEqual([]);
    expect(replay(log, start, new Set(['nowhere'])).log).toHaveLength(1);
    expect(replay(log, start, new Set(['nowhere'])).revealed.has(first)).toBe(true);
  });

  it('drops a repeated move rather than charging for it twice', () => {
    const move = madeUp(first);
    const back = replay(
      [
        { from: start, to: first, move, order: 1 },
        { from: first, to: start, move, order: 2 },
      ],
      start,
    );
    expect(back.log).toHaveLength(1);
    expect(back.guesses).toBe(1);
  });

  it('is total: nothing it cannot make sense of survives, and nothing throws', () => {
    const rubbish = [
      null,
      { to: 5 },
      { from: start, to: first, move: 'not a move' },
      { from: start, to: start, move: madeUp(start) },
      { from: start, to: first, move: madeUp(first), order: 'x' },
    ];
    const back = replay(rubbish, start);
    // Only the last survives, as a guess of its own: its order reads as NaN.
    expect(back.log).toHaveLength(1);
    expect(back.guesses).toBe(1);
    expect(replay('not an array', start).log).toEqual([]);
    expect(replay(undefined, start).revealed.size).toBe(1);
  });

  it('counts one guess per group, not one per entry', () => {
    const back = replay(
      [
        { from: start, to: 'aaaa', move: madeUp('aaaa'), order: 1 },
        { from: start, to: 'bbbb', move: madeUp('bbbb'), order: 1 },
        { from: start, to: 'cccc', move: madeUp('cccc'), order: 2 },
      ],
      start,
    );
    expect(back.log).toHaveLength(3);
    expect(back.guesses).toBe(2);
    expect(guessedWords(back.log)).toEqual(['aaaa', 'cccc']);
  });
});

describe('the keys and the grouping', () => {
  it('reads a move made in either direction as one move, and a move given away in one', () => {
    expect(edgeKey('b', 'a')).toBe(edgeKey('a', 'b'));
    expect(moveKey('b', 'a')).not.toBe(moveKey('a', 'b'));
  });

  it('begins a guess on a new order or a new word moved from', () => {
    expect(newGuess({ order: 1, from: 'a' }, undefined)).toBe(true);
    expect(newGuess({ order: 1, from: 'a' }, { order: 1, from: 'a' })).toBe(false);
    expect(newGuess({ order: 2, from: 'a' }, { order: 1, from: 'a' })).toBe(true);
    expect(newGuess({ order: 1, from: 'b' }, { order: 1, from: 'a' })).toBe(true);
    expect(newGuess({ order: NaN, from: 'a' }, { order: NaN, from: 'a' })).toBe(true);
  });
});

describe('joins', () => {
  it('walks the moves made, in either direction, and says whether two words meet', () => {
    const log = [
      { from: 'a', to: 'b', move: madeUp('b'), order: 1 },
      { from: 'c', to: 'b', move: madeUp('b'), order: 2 },
    ];
    expect(joins('a', 'c', log)).toBe(true);
    expect(joins('c', 'a', log)).toBe(true);
    expect(joins('a', 'd', log)).toBe(false);
    expect(joins('a', 'a', [])).toBe(true);
  });
});
