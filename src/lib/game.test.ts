import { describe, expect, it } from 'vitest';
import { testGraph } from './fixture';
import { applyGuess, newGame, select, undiscoveredMoves, useHint } from './game';
import type { Puzzle } from './types';

const graph = testGraph();
const dict = graph.isWord;

const puzzle: Puzzle = {
  source: 'base',
  target: 'cannon',
  par: 4,
  secret: 0,
  corridorSize: 5,
  altNodes: 0,
  shortestPaths: 1,
  maxRank: 0,
};

describe('newGame', () => {
  it('starts with only the source revealed and selected', () => {
    const state = newGame(puzzle);
    expect([...state.revealed.keys()]).toEqual(['base']);
    expect(state.selected).toBe('base');
    expect(state.guesses).toBe(0);
    expect(state.solved).toBe(false);
  });
});

describe('applyGuess', () => {
  it('reveals a word and charges one guess', () => {
    const outcome = applyGuess(newGame(puzzle), graph, 'baseball', dict);
    expect(outcome.kind).toBe('revealed');
    expect(outcome.state.guesses).toBe(1);
    expect(outcome.state.selected).toBe('baseball');
    expect(outcome.state.revealed.get('baseball')).toMatchObject({ via: 'base', order: 1 });
  });

  it('does not charge for a word already found', () => {
    let state = applyGuess(newGame(puzzle), graph, 'baseball', dict).state;
    const outcome = applyGuess(state, graph, 'base', dict);
    expect(outcome.kind).toBe('already-known');
    expect(outcome.state.guesses).toBe(1);
    // ...but it does move the cursor there, which is the point of the move.
    expect(outcome.state.selected).toBe('base');
  });

  it('counts a refused guess as a miss without revealing anything', () => {
    const outcome = applyGuess(newGame(puzzle), graph, 'nonsense', dict);
    expect(outcome.kind).toBe('rejected');
    expect(outcome.state.misses).toBe(1);
    expect(outcome.state.guesses).toBe(0);
    expect(outcome.state.revealed.size).toBe(1);
  });

  it('marks the puzzle solved on reaching the target', () => {
    let state = newGame(puzzle);
    for (const word of ['baseball', 'ball', 'cannonball', 'cannon']) {
      state = applyGuess(state, graph, word, dict).state;
    }
    expect(state.solved).toBe(true);
    expect(state.guesses).toBe(puzzle.par);
    expect(state.log.map((e) => e.to)).toEqual(['baseball', 'ball', 'cannonball', 'cannon']);
  });

  it('leaves the original state untouched', () => {
    const before = newGame(puzzle);
    applyGuess(before, graph, 'baseball', dict);
    expect(before.revealed.size).toBe(1);
    expect(before.guesses).toBe(0);
  });

  it('lets a guess start from any word already found', () => {
    // Walk out to `ball`, jump back to `base`, and guess from there.
    let state = applyGuess(newGame(puzzle), graph, 'baseball', dict).state;
    state = select(state, 'base');
    expect(state.selected).toBe('base');
    const outcome = applyGuess(state, graph, 'baseball', dict);
    expect(outcome.kind).toBe('already-known');
  });
});

describe('select', () => {
  it('refuses to move to a word not yet found', () => {
    const state = newGame(puzzle);
    expect(select(state, 'cannon').selected).toBe('base');
  });
});

describe('useHint', () => {
  it('records a hint once, and never for a word already found', () => {
    let state = newGame(puzzle);
    state = useHint(state, 'cannonball');
    expect(state.hinted.has('cannonball')).toBe(true);
    expect(useHint(state, 'base').hinted.has('base')).toBe(false);
  });
});

describe('undiscoveredMoves', () => {
  it('lists only moves leading somewhere new', () => {
    const state = applyGuess(newGame(puzzle), graph, 'baseball', dict).state;
    // From `baseball`: `base` is already found, `ball` is not.
    expect(undiscoveredMoves(state, graph).map((m) => m.to)).toEqual(['ball']);
  });
});
