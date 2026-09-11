/**
 * Persistence, including the ways it is allowed to fail.
 *
 * The point of these is less that saving works than that nothing here can ever
 * take the game down with it: a blocked or full or corrupted store has to end in
 * a playable board, not an exception.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GameSnapshot } from './game';
import type { Completion } from './stats';
import { KEY, addCompletion, gameKey, loadGame, loadStats, replaceStats, saveGame } from './storage';
import type { RawManifest } from './data';
import type { Puzzle } from './types';

/**
 * Enough manifest to name a band.
 *
 * Both games label a band "short", which is the whole reason a key carries the name rather
 * than the index: `letters-short` and `phonemes-short` are different games, and index 0 and
 * index 3 only say so for as long as the list keeps its order.
 */
const manifest = {
  bands: [
    { name: 'letters-short', label: 'short', mode: 0, minPar: 3, maxPar: 4 },
    { name: 'letters-medium', label: 'medium', mode: 0, minPar: 5, maxPar: 6 },
    { name: 'letters-long', label: 'long', mode: 0, minPar: 7, maxPar: 10 },
    { name: 'phonemes-short', label: 'short', mode: 1, minPar: 3, maxPar: 4 },
    { name: 'phonemes-medium', label: 'medium', mode: 1, minPar: 5, maxPar: 6 },
    { name: 'phonemes-long', label: 'long', mode: 1, minPar: 7, maxPar: 10 },
  ],
} as RawManifest;

const puzzle: Puzzle = {
  id: 'aaaa1111',
  day: 0,
  // Short, which is what a par-4 board is. See `band_of`.
  band: 0,
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
    expect(gameKey(puzzle, manifest)).toBe('letters-short:base>cannon');
  });

  it('keeps two bands apart even when their endpoints read alike', () => {
    // An endpoint is a *token*, and a token means different things in different alphabets:
    // `put` is stored as `age` in the phonemes game, which is also an ordinary word the letters
    // game can build a board from. Without the band these are one key and one of the two
    // boards is handed the other's game.
    const elsewhere = { ...puzzle, band: 3 };
    expect(gameKey(elsewhere, manifest)).not.toBe(gameKey(puzzle, manifest));
  });

  it('names the band rather than numbering it, so reordering the list cannot rekey a game', () => {
    // The two games' bands are interleaved rather than appended — a list nothing in the app
    // produces, and exactly the change that would silently hand every stored phonemes game to
    // the letters game if the key were an index.
    const shuffled = {
      bands: [manifest.bands[3], manifest.bands[0]],
    } as RawManifest;
    expect(gameKey({ ...puzzle, band: 1 }, shuffled)).toBe('letters-short:base>cannon');
    expect(gameKey({ ...puzzle, band: 0 }, shuffled)).toBe('phonemes-short:base>cannon');
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

const done = (over: Partial<Completion> = {}): Completion => ({
  // The shape `gameKey` makes: the band's name, then the pair. A bare pair, or a band written
  // as an index, is an older record and is repaired on the way in — see `readCompletion` — so
  // these say what they mean.
  key: 'letters-short:base>cannon',
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
});

describe('the finished rounds', () => {

  /**
   * A puzzle is undirected, and which end the builder writes as `source` is a finding of its
   * rules — so a rebuild can flip it while the address, being a digest of the sorted pair, does
   * not change. Compared directionally, that board stops being recognised and replaying it
   * files a second record, and then every figure on `/stats` counts the round twice for ever.
   */
  it('does not file a round twice because a rebuild flipped the pair', () => {
    const one = done({ key: 'letters-short:base>baseball', band: 0, par: 3, guesses: 3 });
    const flipped = done({ key: 'letters-short:baseball>base', band: 0, par: 3, guesses: 3 });
    expect(addCompletion(one, manifest)).toBe(true);
    expect(addCompletion(flipped, manifest)).toBe(false);
    expect(loadStats(manifest)).toHaveLength(1);
    // And the one that was kept still says which end the board called the source, because
    // that is what the history draws its card from. See `gameKey`.
    expect(loadStats(manifest)[0]!.key).toBe('letters-short:base>baseball');
  });
  it('keeps a round, and keeps them in the order they were finished', () => {
    addCompletion(done({ key: 'letters-short:a>b' }), manifest);
    addCompletion(done({ key: 'letters-short:c>d' }), manifest);
    expect(loadStats(manifest).map((one) => one.key)).toEqual([
      'letters-short:a>b',
      'letters-short:c>d',
    ]);
  });

  it('keeps the first round a pair had, since reopening a board offers it again', () => {
    expect(addCompletion(done({ key: 'letters-short:a>b', guesses: 4 }), manifest)).toBe(true);
    expect(addCompletion(done({ key: 'letters-short:a>b', guesses: 99 }), manifest)).toBe(false);
    expect(loadStats()).toHaveLength(1);
    expect(loadStats()[0]!.guesses).toBe(4);
  });

  it('is not evicted the way games are: a history that ends ten days ago is not one', () => {
    for (let i = 0; i < 60; i++) addCompletion(done({ key: `letters-short:k${i}`, day: i }), manifest);
    expect(loadStats()).toHaveLength(60);
    expect(loadStats()[0]!.key).toBe('letters-short:k0');
  });

  it('gives nothing back rather than throwing when there is no storage', () => {
    install(undefined);
    expect(() => addCompletion(done(), manifest)).not.toThrow();
    expect(loadStats()).toEqual([]);
  });

  it('survives a store that throws on every write', () => {
    install(
      fakeStorage(() => {
        throw new Error('QuotaExceededError');
      }),
    );
    expect(() => replaceStats([done()])).not.toThrow();
    expect(loadStats()).toEqual([]);
  });

  it('recovers from rubbish in the key rather than refusing to open', () => {
    localStorage.setItem('recurse.stats.v1', '{ this is not json');
    expect(loadStats()).toEqual([]);
    addCompletion(done({ key: 'letters-short:a>b' }), manifest);
    expect(loadStats()).toHaveLength(1);
  });
});
