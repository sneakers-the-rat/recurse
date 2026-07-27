import { describe, expect, it } from 'vitest';
import { testGraph } from '../test/fixture';
import { analyzeEdit, bestReading, insertionSpots, judgeGuess, wordReading } from './moves';

const graph = testGraph();
// The graph carries the whole dictionary now, so legality and word-ness come
// from the same place the real game uses.
const dict = graph.isWord;

describe('insertionSpots', () => {
  it('finds where a run could have been inserted', () => {
    expect(insertionSpots('base', 'baseball')).toEqual([{ pos: 4, sub: 'ball' }]);
  });

  it('finds every reading, even ones that are not words', () => {
    // `ball` -> `baseball` reads three ways because of the repeated letters.
    // Only the first inserts a real word, which is why picking the reading is a
    // separate decision from finding them.
    expect(insertionSpots('ball', 'baseball')).toEqual([
      { pos: 0, sub: 'base' },
      { pos: 1, sub: 'aseb' },
      { pos: 2, sub: 'seba' },
    ]);
    expect(bestReading(insertionSpots('ball', 'baseball'), 3, testGraph().isWord).sub).toBe('base');
  });

  it('returns every reading when repeated letters make it ambiguous', () => {
    // Dropping four letters from `lifetime` to reach `lime` can be read two ways.
    const spots = insertionSpots('lime', 'lifetime');
    expect(spots.map((s) => s.sub)).toEqual(['ifet', 'feti']);
  });

  it('is empty when no single run explains the difference', () => {
    expect(insertionSpots('base', 'basketball')).toEqual([]);
  });
});

describe('analyzeEdit', () => {
  it('classifies additions and removals', () => {
    expect(analyzeEdit('base', 'baseball')).toMatchObject({ shape: 'add', length: 4 });
    expect(analyzeEdit('baseball', 'base')).toMatchObject({ shape: 'remove', length: 4 });
  });

  it('calls out a same-length swap separately from an illegal edit', () => {
    // Replacement moves are a different game mode, not a malformed add/remove.
    expect(analyzeEdit('base', 'cast')).toEqual({ shape: 'swap' });
  });

  it('treats appending a run as an ordinary addition', () => {
    expect(analyzeEdit('cannon', 'cannonballs')).toMatchObject({ shape: 'add', length: 5 });
  });

  it('flags letters changing in more than one place', () => {
    // Letters arriving at both ends: no single word was inserted anywhere.
    expect(analyzeEdit('base', 'xbasey')).toMatchObject({ shape: 'scattered', direction: 'add' });
    expect(analyzeEdit('xbasey', 'base')).toMatchObject({ shape: 'scattered', direction: 'remove' });
  });
});

describe('bestReading', () => {
  it('prefers a reading whose run is a real word', () => {
    const spots = [
      { pos: 0, sub: 'xyz' },
      { pos: 3, sub: 'ball' },
    ];
    expect(bestReading(spots, 3, dict).sub).toBe('ball');
  });

  it('falls back to the longest run when nothing is a word', () => {
    const spots = [
      { pos: 0, sub: 'ifet' },
      { pos: 1, sub: 'fet' },
    ];
    expect(bestReading(spots, 3, dict).sub).toBe('ifet');
  });
});

describe('judgeGuess', () => {
  it('accepts a move that is in the shipped edge list', () => {
    const verdict = judgeGuess(graph, 'base', 'baseball');
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.move).toMatchObject({ sub: 'ball', pos: 4, kind: 'add' });
  });

  it('is case and whitespace insensitive', () => {
    expect(judgeGuess(graph, 'base', '  BaseBall ').ok).toBe(true);
  });

  it('accepts any dictionary word, not just the puzzle corpus', () => {
    // `lifespan` is an ordinary word outside the common corpus, so it has no
    // edge; the dictionary has to carry it.
    expect(judgeGuess(graph, 'life', 'lifespan', dict).ok).toBe(true);
    expect(judgeGuess(graph, 'life', 'lifespan', null).ok).toBe(false);
  });

  it('accepts an ambiguous removal if any reading is a word', () => {
    // `lifetime` → `lime` drops `ifet` or `feti`; neither is a word, so no.
    expect(judgeGuess(graph, 'lifetime', 'lime', dict).ok).toBe(false);
    // But with `feti` in the dictionary, the generous reading wins.
    const generous = testGraph(['feti']);
    const verdict = judgeGuess(generous, 'lifetime', 'lime', generous.isWord);
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.move.sub).toBe('feti');
  });

  it('refuses a word that changes in two places, and says why', () => {
    const verdict = judgeGuess(graph, 'base', 'xbasey', dict);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.code).toBe('scattered');
      expect(verdict.message).toMatch(/single unbroken run/);
    }
  });

  it('distinguishes a same-length swap from an illegal edit', () => {
    const verdict = judgeGuess(graph, 'base', 'cast', dict);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe('swap');
  });

  it('refuses a run that is not a word', () => {
    const verdict = judgeGuess(graph, 'ball', 'bassball', dict);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(['sub-not-word', 'not-a-word']).toContain(verdict.code);
  });

  it('refuses non-letters and empty input', () => {
    expect(judgeGuess(graph, 'base', '').ok).toBe(false);
    expect(judgeGuess(graph, 'base', 'base ball').ok).toBe(false);
    expect(judgeGuess(graph, 'base', 'base9').ok).toBe(false);
  });

  it('refuses the word you are already on', () => {
    const verdict = judgeGuess(graph, 'base', 'base');
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe('identical');
  });

  it('accepts a bare ending like -less, because that is a legal move', () => {
    // Whether a solution *should* lean on -less is a puzzle-selection question,
    // handled by the builder. It is never a reason to refuse a player's guess.
    const g = testGraph(['timeless', 'time', 'less']);
    expect(judgeGuess(g, 'time', 'timeless', g.isWord).ok).toBe(true);
  });
});

describe('wordReading', () => {
  it('is the one question every consumer asks', () => {
    // The reading the game accepts, the one the board draws, and the one the
    // readout shows are all this. Nothing without a word in it is a reading.
    const spots = insertionSpots('ball', 'baseball');
    expect(wordReading(spots, 2, dict)?.sub).toBe('base');
    expect(wordReading(insertionSpots('lime', 'lifetime'), 2, dict)).toBeUndefined();
    // Without a dictionary nothing can be confirmed, so nothing is claimed.
    expect(wordReading(spots, 2, null)).toBeUndefined();
    // A run that is a word but too short to be a legal move does not count.
    expect(wordReading(insertionSpots('all', 'ball'), 2, dict)).toBeUndefined();
  });
});
