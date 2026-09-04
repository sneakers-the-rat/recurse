/**
 * The share text, which is the one thing here a stranger reads. It has to say what
 * happened without naming a word — the whole point is that it can be pasted
 * somewhere public on the day the puzzle is live.
 */

import { describe, expect, it } from 'vitest';
import { phrasebook } from '../i18n/format';
import { emojiTrail, markGuesses, shareText, type Result } from './share';

const route = new Set(['ball', 'cannonball']);
const board = new Set(['ball', 'cannonball', 'baseball']);

describe('markGuesses', () => {
  it('marks a word by where it stood in relation to the answer', () => {
    expect(markGuesses(['cannonball', 'baseball', 'lifetime'], route, board)).toEqual([
      'route',
      'alternate',
      'stray',
    ]);
  });

  it('prefers the route where a word is on both, since that is the stronger fact', () => {
    // Every route node is also a board node, so the order of these tests matters.
    expect(markGuesses(['ball'], route, board)).toEqual(['route']);
  });

  it('stars a word on a shortcut, over anything else it also is', () => {
    // A shortcut is the strongest thing a word can be: a way through that beats par, which
    // is the best thing that can happen in a round. `cannonball` is on the answer too.
    const shortcut = new Set(['cannonball', 'lifetime']);
    expect(markGuesses(['cannonball', 'lifetime', 'baseball'], route, board, shortcut)).toEqual([
      'shortcut',
      'shortcut',
      'alternate',
    ]);
    expect(emojiTrail(['shortcut', 'route'])).toBe('⭐🟨');
  });

  it('keeps the order the guesses were made in', () => {
    const marks = markGuesses(['lifetime', 'ball'], route, board);
    expect(marks).toEqual(['stray', 'route']);
    expect(emojiTrail(marks)).toBe('🟥🟨');
  });
});

describe('shareText', () => {
  // The real shipped English, so these assertions are on what a player would actually
  // paste rather than on a fixture that could drift away from the catalog.
  const intl = phrasebook();

  const result: Result = {
    day: 3,
    band: 'short',
    date: '2026-07-29',
    guesses: 5,
    par: 4,
    hints: 2,
    marks: ['route', 'route', 'alternate', 'stray', 'route'],
    url: 'https://example.test/recurse/2ed94464',
  };

  it('says which puzzle, how it went, what it looked like, and where to play it', () => {
    expect(shareText(intl, result)).toBe(
      [
        // The length is named: a day offers three, so a score without it cannot be placed.
        'ReCurse Words · Day 3 · short · 2026-07-29',
        '5 guesses · par 4 · 2 hints',
        '🟨🟨🟩🟥🟨',
        'https://example.test/recurse/2ed94464',
      ].join('\n'),
    );
  });

  it('names no word, so it can be pasted the day the puzzle is live', () => {
    for (const word of ['ball', 'cannonball', 'baseball', 'lifetime']) {
      expect(shareText(intl, result)).not.toContain(word);
    }
  });

  it('says so when par was beaten, which is the best thing that can happen', () => {
    const secret = shareText(intl, { ...result, guesses: 3, marks: ['route', 'route', 'route'] });
    expect(secret).toContain('3 guesses · par 4, under par');
  });

  it('counts in the singular where there is one of something', () => {
    expect(
      shareText(intl, { ...result, guesses: 1, par: 1, hints: 1, marks: ['route'] }),
    ).toContain('1 guess · par 1 · 1 hint');
  });

  it('says nought hints rather than leaving the question open', () => {
    // A missing hint count would read as a claim of none, which is the same claim —
    // but only one of the two is the same claim every time.
    expect(shareText(intl, { ...result, hints: 0 })).toContain('0 hints');
  });

  it('leaves no blank line when there is no trail to draw', () => {
    const nothing = shareText(intl, { ...result, guesses: 0, marks: [] });
    expect(nothing.split('\n')).toHaveLength(3);
    expect(nothing).not.toContain('\n\n');
  });
});
