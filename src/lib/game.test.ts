import { describe, expect, it } from 'vitest';
import { testGraph } from '../test/fixture';
import { applyGuess, inProgress, newGame, restore, select, snapshot, useHint } from './game';
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

describe('snapshot and restore', () => {
  /** Walk part of the way, take a hint, miss once, and step back to the source. */
  function played() {
    let state = newGame(puzzle);
    for (const word of ['baseball', 'ball']) {
      state = applyGuess(state, graph, word, dict).state;
    }
    state = applyGuess(state, graph, 'nonsense', dict).state;
    state = useHint(state, 'cannonball');
    return select(state, 'base');
  }

  it('comes back exactly as it went in', () => {
    const before = played();
    const after = restore(puzzle, snapshot(before));
    expect(after).toEqual(before);
  });

  it('rebuilds what it did not store', () => {
    // revealed, guesses and solved are all derived from the log — see snapshot.
    const after = restore(puzzle, snapshot(played()));
    expect([...after.revealed.keys()]).toEqual(['base', 'baseball', 'ball']);
    expect(after.guesses).toBe(2);
    expect(after.solved).toBe(false);
  });

  it('restores a finished game as finished', () => {
    let state = newGame(puzzle);
    for (const word of ['baseball', 'ball', 'cannonball', 'cannon']) {
      state = applyGuess(state, graph, word, dict).state;
    }
    expect(restore(puzzle, snapshot(state)).solved).toBe(true);
  });

  it('carries on from a restored game', () => {
    const state = restore(puzzle, snapshot(played()));
    const outcome = applyGuess(select(state, 'ball'), graph, 'cannonball', dict);
    expect(outcome.state.guesses).toBe(3);
    expect(outcome.state.revealed.get('cannonball')).toMatchObject({ via: 'ball', order: 3 });
  });

  it('starts fresh when there is nothing saved', () => {
    expect(restore(puzzle, null)).toEqual(newGame(puzzle));
  });

  // Everything below is a snapshot that should never exist. It might anyway: it
  // has been sitting in a browser since before the last release.
  it('drops a move that starts nowhere, keeping the trail connected', () => {
    const saved = snapshot(played());
    saved.log = [
      { from: 'nowhere', to: 'lifetime', move: { to: 'lifetime', sub: 'life', pos: 0, kind: 'add' }, order: 1 },
      ...saved.log,
    ];
    const after = restore(puzzle, saved);
    expect(after.revealed.has('lifetime')).toBe(false);
    // ...and the surviving moves are renumbered, so the count has no gap in it.
    expect(after.log.map((e) => e.order)).toEqual([1, 2]);
    expect(after.guesses).toBe(2);
  });

  it('drops an entry whose move is missing or malformed', () => {
    const saved = snapshot(played());
    saved.log = saved.log.map((e) => ({ ...e, move: null as never }));
    expect(restore(puzzle, saved).revealed.size).toBe(1);
  });

  it('puts the cursor back on the source when it points at nothing', () => {
    const saved = { ...snapshot(played()), selected: 'somewhere-else' };
    expect(restore(puzzle, saved).selected).toBe('base');
  });

  it('refuses to believe a nonsense tally', () => {
    const saved = { ...snapshot(played()), misses: -5 };
    expect(restore(puzzle, saved).misses).toBe(0);
    expect(restore(puzzle, { ...saved, misses: NaN }).misses).toBe(0);
  });

  it('tolerates missing fields entirely', () => {
    const empty = restore(puzzle, {} as never);
    expect(empty).toEqual(newGame(puzzle));
  });
});

describe('inProgress', () => {
  it('is false for a board nobody has touched', () => {
    expect(inProgress(newGame(puzzle))).toBe(false);
  });

  it('counts a refused guess and a hint, not just a move', () => {
    expect(inProgress(applyGuess(newGame(puzzle), graph, 'nonsense', dict).state)).toBe(true);
    expect(inProgress(useHint(newGame(puzzle), 'cannonball'))).toBe(true);
  });
});

