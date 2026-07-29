/**
 * Persistence, including the ways it is allowed to fail.
 *
 * The point of these is less that saving works than that nothing here can ever
 * take the game down with it: a blocked or full or corrupted store has to end in
 * a playable board, not an exception.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GameSnapshot } from './game';
import { KEY, gameKey, loadGame, saveGame } from './storage';
import type { Puzzle } from './types';

const puzzle: Puzzle = {
  id: 'aaaa1111',
  day: 0,
  source: 'base',
  target: 'cannon',
  par: 4,
  secret: 0,
  corridorSize: 5,
  altNodes: 0,
  shortestPaths: 1,
  maxRank: 0,
  board: [],
};

const game = (word: string): GameSnapshot => ({
  log: [{ from: 'base', to: word, move: { to: word, sub: 'ball', pos: 4, kind: 'add' }, order: 1 }],
  selected: word,
  misses: 0,
  hints: [],
});

/** The smallest thing that behaves like localStorage. */
function fakeStorage(onSet?: () => void) {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      onSet?.();
      values.set(key, value);
    },
    removeItem: (key: string) => void values.delete(key),
    clear: () => values.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
}

const install = (storage: Storage | undefined) => {
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
    writable: true,
  });
};

beforeEach(() => install(fakeStorage()));
afterEach(() => install(undefined));

describe('gameKey', () => {
  it('names the puzzle by its words, not its place in the bank', () => {
    // The bank is rebuilt and reshuffled; a puzzle's place in it is not stable and
    // neither is its id, which is a digest of its answer. The pair is.
    expect(gameKey(puzzle)).toBe('base>cannon');
  });
});

describe('saveGame', () => {
  it('gives a game back', () => {
    saveGame('a', game('baseball'));
    expect(loadGame('a')).toMatchObject({ selected: 'baseball' });
  });

  it('keeps games apart, so moving between puzzles keeps both', () => {
    saveGame('a', game('baseball'));
    saveGame('b', game('cannonball'));
    expect(loadGame('a')).toMatchObject({ selected: 'baseball' });
    expect(loadGame('b')).toMatchObject({ selected: 'cannonball' });
  });

  it('replaces a game rather than accumulating copies of it', () => {
    saveGame('a', game('baseball'));
    saveGame('a', game('ball'));
    expect(loadGame('a')).toMatchObject({ selected: 'ball' });
  });

  it('forgets a game when there is nothing to remember', () => {
    saveGame('a', game('baseball'));
    saveGame('a', null);
    expect(loadGame('a')).toBeNull();
  });

  it('drops the least recently played once it is full', () => {
    for (let i = 0; i < 40; i++) saveGame(`k${i}`, game('baseball'));
    expect(loadGame('k39')).not.toBeNull();
    expect(loadGame('k0')).toBeNull();
    // Touching an old game makes it recent again, so an unfinished board is not
    // evicted by a browse through the archive.
    saveGame('k39', game('ball'));
    for (let i = 40; i < 60; i++) saveGame(`k${i}`, game('baseball'));
    expect(loadGame('k39')).not.toBeNull();
  });

  it('returns nothing when there is no storage at all', () => {
    install(undefined);
    expect(() => saveGame('a', game('baseball'))).not.toThrow();
    expect(loadGame('a')).toBeNull();
  });

  it('survives a store that throws on every write', () => {
    // Safari in private browsing, and a full quota, both look like this.
    install(
      fakeStorage(() => {
        throw new Error('QuotaExceededError');
      }),
    );
    expect(() => saveGame('a', game('baseball'))).not.toThrow();
    expect(loadGame('a')).toBeNull();
  });

  it('ignores a stored value that is not a game at all', () => {
    localStorage.setItem(KEY, '{ this is not json');
    expect(loadGame('a')).toBeNull();
    // And it recovers: the next save overwrites the rubbish.
    saveGame('a', game('baseball'));
    expect(loadGame('a')).toMatchObject({ selected: 'baseball' });
  });

  it('ignores entries of the wrong shape inside a valid array', () => {
    localStorage.setItem(KEY, JSON.stringify([null, 7, { key: 'a' }, 'x']));
    expect(loadGame('a')).toBeNull();
  });
});
