/**
 * The wire contract, from both ends.
 *
 * These readers are the only thing standing between a request body from the open internet and
 * the rest of the server, so the interesting cases are all the ones where something is *nearly*
 * right: an action of a kind that does not exist, a count that is not a count, a list long
 * enough to be a denial of service. Every one of them has to be null rather than a throw and
 * rather than a half-read value.
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_ACTIONS,
  nameProblem,
  passwordProblem,
  readAction,
  readActions,
  readPuzzleId,
  readRefused,
  readScoreboard,
  readSubmission,
} from './api';

describe('reading an action', () => {
  it('reads every kind there is', () => {
    expect(readAction({ do: 'guess', words: ['cage'] })).toEqual({ do: 'guess', words: ['cage'] });
    expect(readAction({ do: 'stand', word: 'cage' })).toEqual({ do: 'stand', word: 'cage' });
    expect(readAction({ do: 'hint', word: 'cage', levels: 2 })).toEqual({
      do: 'hint',
      word: 'cage',
      levels: 2,
    });
    expect(readAction({ do: 'mark', word: 'cage', to: 'courage' })).toEqual({
      do: 'mark',
      word: 'cage',
      to: 'courage',
    });
    expect(readAction({ do: 'miss', count: 3 })).toEqual({ do: 'miss', count: 3 });
    expect(readAction({ do: 'spent', levels: 4 })).toEqual({ do: 'spent', levels: 4 });
  });

  it('refuses a kind it does not know', () => {
    // A variant added to `Action` and not here arrives as null, which refuses the round. That is
    // the intended failure: a round silently missing what somebody did would be worse.
    expect(readAction({ do: 'fly', word: 'cage' })).toBeNull();
  });

  it('refuses a field of the wrong shape', () => {
    expect(readAction({ do: 'guess', words: [] })).toBeNull();
    expect(readAction({ do: 'guess', words: 'cage' })).toBeNull();
    expect(readAction({ do: 'guess', words: [42] })).toBeNull();
    expect(readAction({ do: 'stand', word: '' })).toBeNull();
    expect(readAction({ do: 'hint', word: 'cage', levels: -1 })).toBeNull();
    expect(readAction({ do: 'hint', word: 'cage', levels: 1.5 })).toBeNull();
    expect(readAction({ do: 'miss', count: 'lots' })).toBeNull();
    expect(readAction(null)).toBeNull();
    expect(readAction([])).toBeNull();
  });

  it('refuses a word long enough to be an attack rather than a word', () => {
    expect(readAction({ do: 'stand', word: 'a'.repeat(65) })).toBeNull();
  });
});

describe('reading a series', () => {
  it('refuses the whole series when one action is wrong', () => {
    // The opposite of what `restore` does with a move it cannot replay, on purpose: a snapshot
    // out of localStorage is the player's own history and salvaging it is kindness, while a
    // request body is a stranger's claim and a claim that is partly nonsense is not a record.
    const mostly = [{ do: 'guess', words: ['cage'] }, { do: 'fly' }];
    expect(readActions(mostly)).toBeNull();
  });

  it('refuses one longer than any round anybody played', () => {
    const many = Array.from({ length: MAX_ACTIONS + 1 }, () => ({ do: 'miss', count: 1 }));
    expect(readActions(many)).toBeNull();
    expect(readActions(many.slice(0, MAX_ACTIONS))).toHaveLength(MAX_ACTIONS);
  });

  it('reads an empty one, which is a board nobody has moved on', () => {
    expect(readActions([])).toEqual([]);
  });
});

describe('reading a submission', () => {
  it('wants an id that looks like one', () => {
    expect(readSubmission({ puzzle: 'abc123', actions: [] })?.puzzle).toBe('abc123');
    expect(readSubmission({ puzzle: 'ABC123', actions: [] })).toBeNull();
    expect(readSubmission({ puzzle: 'not-hex', actions: [] })).toBeNull();
    expect(readSubmission({ puzzle: '', actions: [] })).toBeNull();
    expect(readSubmission({ actions: [] })).toBeNull();
  });

  it('carries no score, because there is nowhere to put one', () => {
    const read = readSubmission({ puzzle: 'abc123', actions: [], guesses: 1, solved: true });
    // Anything a client adds is dropped on the way in rather than trusted and then ignored,
    // which is the difference between a field that is not read and a field that does not exist.
    expect(read).toEqual({ puzzle: 'abc123', actions: [] });
  });
});

describe('the rules a name and a password follow', () => {
  it('says what is wrong, so the client can say it before sending anything', () => {
    expect(nameProblem('jonny')).toBeNull();
    expect(nameProblem('a-b_9')).toBeNull();
    expect(nameProblem('no')).toBe('short');
    expect(nameProblem('n'.repeat(21))).toBe('long');
    expect(nameProblem('two words')).toBe('characters');
    expect(nameProblem('café')).toBe('characters');
  });

  it('bounds a password at both ends', () => {
    expect(passwordProblem('a good long password')).toBeNull();
    expect(passwordProblem('short')).toBe('short');
    // Not a rule about good passwords: the hash is deliberately slow and its cost grows with
    // what it is fed, so an unbounded field is a way to make the server work for one request.
    expect(passwordProblem('x'.repeat(201))).toBe('long');
  });
});

describe('reading what came back', () => {
  it('drops a scoreboard row it cannot read and keeps the board', () => {
    // The `readCompletions` rule rather than the `readActions` one: this is a display, nothing
    // is recorded from it, and a board missing a line beats a screen that will not draw.
    const board = readScoreboard({
      puzzle: 'abc123',
      par: 4,
      bank: 'deadbeef',
      players: 2,
      scores: [
        { rank: 1, player: { id: 'u1', name: null }, guesses: 4, hints: 0, at: '2026-01-01' },
        { rank: 2, player: null, guesses: 5, hints: 1, at: '2026-01-01' },
      ],
      you: null,
    });
    expect(board?.scores).toHaveLength(1);
    expect(board?.scores[0]?.player.name).toBeNull();
    expect(board?.you).toBeNull();
  });

  it('refuses a board with no puzzle or no par', () => {
    expect(readScoreboard({ par: 4, scores: [] })).toBeNull();
    expect(readScoreboard({ puzzle: 'abc123', scores: [] })).toBeNull();
    expect(readScoreboard('nope')).toBeNull();
  });

  it('reads a refusal, and nothing else', () => {
    expect(readRefused({ error: 'slow-down' })).toEqual({ error: 'slow-down' });
    expect(readRefused({ error: 'something-else' })).toBeNull();
    expect(readRefused({ ok: true })).toBeNull();
  });

  it('reads an id the same way in both directions', () => {
    expect(readPuzzleId('0a1b2c')).toBe('0a1b2c');
    expect(readPuzzleId('0A1B2C')).toBeNull();
    expect(readPuzzleId(42)).toBeNull();
  });
});
