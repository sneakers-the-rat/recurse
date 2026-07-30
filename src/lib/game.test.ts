import { describe, expect, it } from 'vitest';
import { testGraph } from '../test/fixture';
import {
  applyGuess,
  fullyHinted,
  hintCount,
  hintLabel,
  hintLevels,
  moveHint,
  newGame,
  restore,
  select,
  snapshot,
  useHint,
  useMoveHint,
  worthKeeping,
} from './game';
import type { Puzzle } from './types';

const graph = testGraph();
const dict = graph.isWord;

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
    expect(select(state, 'cannonball').selected).toBe('base');
  });

  it('stands on the goal, which is a front from the first move', () => {
    const state = select(newGame(puzzle), 'cannon');
    expect(state.selected).toBe('cannon');
    // Standing on it is not reaching it: the board draws those differently.
    expect(state.revealed.has('cannon')).toBe(false);
  });
});

/**
 * Both ends at once, which is what the graph being undirected means for a player.
 *
 * The toy graph is one chain — `base baseball ball cannonball cannon` — so a game played
 * from both ends has to meet in the middle, and the move that joins the halves lands on a
 * word that is already named. That move is the whole of what these check: it costs a guess,
 * it goes in the log so it can be drawn, and it is what ends the round.
 */
describe('working from the goal', () => {
  it('guesses backwards from the goal', () => {
    const outcome = applyGuess(select(newGame(puzzle), 'cannon'), graph, 'cannonball', dict);
    expect(outcome.kind).toBe('revealed');
    expect(outcome.state.guesses).toBe(1);
    expect(outcome.state.revealed.get('cannonball')).toMatchObject({ via: 'cannon', order: 1 });
    expect(outcome.state.solved).toBe(false);
  });

  it('ends the round when the two halves join, not when the goal is reached', () => {
    // One move back from the goal, then two forward from the source.
    let state = applyGuess(select(newGame(puzzle), 'cannon'), graph, 'cannonball', dict).state;
    state = applyGuess(select(state, 'base'), graph, 'baseball', dict).state;
    state = applyGuess(state, graph, 'ball', dict).state;
    // Four words named, three of the four moves made, and the halves still apart.
    expect(state.solved).toBe(false);
    expect(state.guesses).toBe(3);

    // The join: `cannonball` is already named, so this reveals nothing and is still a move.
    const outcome = applyGuess(select(state, 'ball'), graph, 'cannonball', dict);
    expect(outcome.kind).toBe('revealed');
    expect(outcome.state.solved).toBe(true);
    expect(outcome.state.guesses).toBe(puzzle.par);
    // Logged, or the board could not draw the move that won the round.
    expect(outcome.state.log.at(-1)).toMatchObject({ from: 'ball', to: 'cannonball' });
    // And it did not overwrite how `cannonball` was first arrived at.
    expect(outcome.state.revealed.get('cannonball')).toMatchObject({ via: 'cannon', order: 1 });
  });

  it('never charges twice for the same move', () => {
    let state = applyGuess(newGame(puzzle), graph, 'baseball', dict).state;
    state = applyGuess(select(state, 'base'), graph, 'baseball', dict).state;
    state = applyGuess(select(state, 'baseball'), graph, 'base', dict).state;
    expect(state.guesses).toBe(1);
    expect(state.log).toHaveLength(1);
  });

  it('remembers a game played from both ends', () => {
    let state = applyGuess(select(newGame(puzzle), 'cannon'), graph, 'cannonball', dict).state;
    state = applyGuess(select(state, 'base'), graph, 'baseball', dict).state;
    const back = restore(puzzle, snapshot(state));
    expect(back.guesses).toBe(2);
    expect(back.revealed.get('cannonball')).toMatchObject({ via: 'cannon' });
    expect(back.solved).toBe(false);
  });

  it('sells no hint on the goal, because standing there says more', () => {
    // The goal used to be the one word that sold the shape of a move without being
    // reachable — the substitute for not being able to work from that end.
    const state = newGame(puzzle);
    expect(useHint(state, 'cannon')).toBe(state);
    expect(useMoveHint(state, 'cannon', ['cannonball'])).toBe(state);
  });

  it('restores a game that was finished from both ends', () => {
    let state = applyGuess(select(newGame(puzzle), 'cannon'), graph, 'cannonball', dict).state;
    state = applyGuess(select(state, 'base'), graph, 'baseball', dict).state;
    state = applyGuess(state, graph, 'ball', dict).state;
    state = applyGuess(state, graph, 'cannonball', dict).state;
    expect(state.solved).toBe(true);
    expect(restore(puzzle, snapshot(state)).solved).toBe(true);
  });
});

describe('hints', () => {
  /** Which positions a label has turned up. */
  const shown = (label: string) =>
    new Set([...label].flatMap((letter, i) => (letter === '·' ? [] : [i])));

  it('gives the letter count first, then a letter at a time', () => {
    expect(hintLabel('cannonball', 0)).toBeNull();
    expect(hintLabel('cannonball', 1)).toBe('10');
    expect(shown(hintLabel('cannonball', 2)!).size).toBe(1);
    expect(shown(hintLabel('cannonball', 4)!).size).toBe(3);
    // The last level spells it out. There is no level past that.
    expect(hintLabel('cannonball', hintLevels('cannonball'))).toBe('cannonball');
    expect(fullyHinted('cannonball', hintLevels('cannonball'))).toBe(true);
  });

  it('turns the letters up in a scattered order, not front to back', () => {
    // A prefix is the one thing a hint must not hand over: words live inside other
    // words, so `car·······` names the family and most of the answer with it.
    const early = ['cannonball', 'baseball', 'lifetime', 'stalling'].map(
      (word) => shown(hintLabel(word, 3)!),
    );
    expect(early.some((positions) => !positions.has(0))).toBe(true);
    expect(early.some((positions) => [...positions].some((at) => at > 2))).toBe(true);
  });

  it('gives the same word the same letters every time, so a reload agrees', () => {
    // The stored game is a level per word and nothing else, so the order has to come
    // back out of the word itself.
    expect(hintLabel('cannonball', 5)).toBe(hintLabel('cannonball', 5));
    // Pinned, because the order changing between releases would silently reshuffle
    // the letters of a game already in progress.
    expect(hintLabel('cannonball', 3)).toBe('·a·····a··');
  });

  it('keeps every letter it has already given, level after level', () => {
    let before = new Set<number>();
    for (let level = 2; level <= hintLevels('stalling'); level++) {
      const now = shown(hintLabel('stalling', level)!);
      expect(now.size).toBe(level - 1);
      for (const at of before) expect(now.has(at)).toBe(true);
      before = now;
    }
  });

  it('steps a level per click, and never for a word already found', () => {
    let state = newGame(puzzle);
    state = useHint(state, 'cannonball');
    expect(state.hints.get('cannonball')).toBe(1);
    state = useHint(state, 'cannonball');
    expect(state.hints.get('cannonball')).toBe(2);
    expect(useHint(state, 'base').hints.has('base')).toBe(false);
  });

  it('stops once the word is spelled out, rather than counting empty clicks', () => {
    let state = newGame(puzzle);
    for (let i = 0; i < 40; i++) state = useHint(state, 'cannonball');
    expect(state.hints.get('cannonball')).toBe(hintLevels('cannonball'));
    // A click that buys nothing must not run the tally up: the hint count is a
    // number the player posts, and it has to mean something.
    const spent = hintCount(state);
    expect(hintCount(useHint(state, 'cannonball'))).toBe(spent);
  });

  /**
   * What a word on the answer sells instead of its letters: the shape of one move at a time.
   *
   * Its letters are not for sale at all — three of the seven in a word on a shortest route
   * names it, which is the answer rather than a hint toward it.
   */
  describe('moves given away', () => {
    it('marks one move per click, in the order the board offers them', () => {
      let state = newGame(puzzle);
      state = useMoveHint(state, 'cannonball', ['ball', 'cannon']);
      // Asked about `cannonball`, so the mark is about arriving there: from `ball`, by adding.
      expect(moveHint(state, 'cannonball', 'ball')).toMatchObject({
        at: 'cannonball',
        kind: 'add',
      });
      expect(moveHint(state, 'cannonball', 'cannon')).toBeNull();

      state = useMoveHint(state, 'cannonball', ['ball', 'cannon']);
      expect(moveHint(state, 'cannonball', 'cannon')).toMatchObject({ kind: 'add' });
    });

    it('says how you arrive at the word that was asked about', () => {
      // The mark is about that word, and sits beside it: reaching `ball` from `cannonball`
      // takes letters away, and reaching `cannonball` from `ball` adds them.
      const shorter = useMoveHint(newGame(puzzle), 'ball', ['cannonball']);
      expect(moveHint(shorter, 'ball', 'cannonball')).toMatchObject({
        at: 'ball',
        kind: 'remove',
      });
      const longer = useMoveHint(newGame(puzzle), 'cannonball', ['ball']);
      expect(moveHint(longer, 'ball', 'cannonball')).toMatchObject({
        at: 'cannonball',
        kind: 'add',
      });
    });

    it('does not sell the same move twice, from either end', () => {
      let state = useMoveHint(newGame(puzzle), 'cannonball', ['ball']);
      const spent = hintCount(state);
      state = useMoveHint(state, 'cannonball', ['ball']);
      state = useMoveHint(state, 'ball', ['cannonball']);
      expect(hintCount(state)).toBe(spent);
    });

    it('has more to sell once the board draws more moves', () => {
      // The board grows as the player names words beside a route, and the moves that arrive
      // with them are buyable too — while the ones already paid for stay where they are.
      let state = useMoveHint(newGame(puzzle), 'cannonball', ['ball']);
      state = useMoveHint(state, 'cannonball', ['ball', 'cannon']);
      expect(hintCount(state)).toBe(2);
      expect(moveHint(state, 'cannonball', 'ball')).not.toBeNull();
      expect(moveHint(state, 'cannonball', 'cannon')).not.toBeNull();
    });

    it('counts on the tally, and comes back from a snapshot', () => {
      let state = useHint(newGame(puzzle), 'ball');
      state = useMoveHint(state, 'cannonball', ['ball']);
      expect(hintCount(state)).toBe(2);

      const again = restore(puzzle, JSON.parse(JSON.stringify(snapshot(state))));
      expect(hintCount(again)).toBe(2);
      expect(moveHint(again, 'cannonball', 'ball')).toMatchObject({ kind: 'add' });
    });
  });

  it('counts one per click, across every word', () => {
    // Nothing spends more than a level at a time, which is what makes the tally the
    // number of times the player asked. Dev mode's "spell it out" is not a hint at
    // all and never comes through here — when it did, one tap on a ten-letter word
    // put ten on the tally.
    let state = newGame(puzzle);
    state = useHint(state, 'cannonball');
    state = useHint(state, 'cannonball');
    state = useHint(state, 'ball');
    expect(hintCount(state)).toBe(3);
    expect(state.hints.get('cannonball')).toBe(2);
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

  it('clamps a hint level to what the word can actually give', () => {
    // A stored level past the end would inflate the hint count for ever, and the
    // count is a number the player posts.
    const saved = { ...snapshot(played()), hints: [['cannonball', 99] as [string, number]] };
    expect(restore(puzzle, saved).hints.get('cannonball')).toBe(hintLevels('cannonball'));
    expect(hintCount(restore(puzzle, saved))).toBe(hintLevels('cannonball'));
  });

  it('drops a hint that is not a word and a level, rather than counting it', () => {
    const saved = { ...snapshot(played()), hints: [[7, 'lots'], null, ['ball']] as never };
    expect(hintCount(restore(puzzle, saved))).toBe(0);
  });

  it('tolerates missing fields entirely', () => {
    const empty = restore(puzzle, {} as never);
    expect(empty).toEqual(newGame(puzzle));
  });
});

describe('worthKeeping', () => {
  it('is false for a board nobody has touched', () => {
    expect(worthKeeping(newGame(puzzle))).toBe(false);
  });

  it('counts a refused guess and a hint, not just a move', () => {
    expect(worthKeeping(applyGuess(newGame(puzzle), graph, 'nonsense', dict).state)).toBe(true);
    expect(worthKeeping(useHint(newGame(puzzle), 'cannonball'))).toBe(true);
  });

  it('is true of a finished game, which is what brings the result back', () => {
    let state = newGame(puzzle);
    for (const word of ['baseball', 'ball', 'cannonball', 'cannon']) {
      state = applyGuess(state, graph, word, dict).state;
    }
    expect(state.solved).toBe(true);
    expect(worthKeeping(state)).toBe(true);
  });
});

