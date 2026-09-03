/**
 * The part of a tutorial that is arithmetic rather than prose: when a step counts as
 * answered, and when being answered carries the player forward.
 *
 * The lessons themselves are not tested here — they are content, and what makes them
 * right is reading them on the board. What is tested is the machinery they are declared
 * in, and in particular the rule that keeps the arrows honest: a step that was already
 * satisfied before it opened lights its forward arrow and waits, because otherwise going
 * back to reread it bounces straight forward again.
 */

import { describe, expect, it } from 'vitest';
import { testGraph } from '../test/fixture';
import { LESSON } from '../components/lessons';
import { applyGuess, newGame, select, useHint, useMoveHint, type GameState } from './game';
import {
  beatsOf,
  boughtMove,
  canGoBack,
  canGoOn,
  goBack,
  goOn,
  guessedAny,
  hinted,
  isCleared,
  markedMove,
  movedCursor,
  observe,
  pairKey,
  place,
  reached,
  selectorsFor,
  solved,
  stageAt,
  standingOn,
  startRun,
  strayed,
  walkedMove,
  type Lesson,
  type Moment,
} from './tutorial';
import type { Puzzle } from './types';

const graph = testGraph();

const puzzle: Puzzle = {
  id: 'aaaa1111',
  day: 0,
  band: 0,
  source: 'base',
  target: 'cannon',
  par: 4,
  secret: 0,
  corridorSize: 5,
  altNodes: 0,
  shortestPaths: 1,
  maxRank: 0,
  board: ['base', 'baseball', 'ball', 'cannonball', 'cannon'],
};

const at = (state: GameState, extra: Partial<Moment> = {}): Moment => ({
  state,
  onShortcut: false,
  drawn: new Set(puzzle.board),
  ...extra,
});

/** Play a run of guesses from wherever the state is standing. */
function walk(state: GameState, ...words: string[]): GameState {
  let now = state;
  for (const word of words) now = applyGuess(now, graph, word, graph.isWord).state;
  return now;
}

describe('conditions', () => {
  const fresh = newGame(puzzle);

  it('sees a guess that happened while the step was up, and not one that predates it', () => {
    const after = walk(fresh, 'baseball');
    expect(guessedAny()(at(after), at(fresh))).toBe(true);
    // Same moment both sides: nothing has happened since the step opened.
    expect(guessedAny()(at(after), at(after))).toBe(false);
  });

  it('sees a word reached, however long ago', () => {
    const after = walk(fresh, 'baseball');
    expect(reached('baseball')(at(after), at(fresh))).toBe(true);
    expect(reached('baseball')(at(after), at(after))).toBe(true);
    expect(reached('ball')(at(after), at(fresh))).toBe(false);
  });

  it('sees a particular move, from either end', () => {
    const after = walk(fresh, 'baseball');
    expect(walkedMove('base', 'baseball')(at(after), at(fresh))).toBe(true);
    expect(walkedMove('baseball', 'base')(at(after), at(fresh))).toBe(true);
    expect(walkedMove('ball', 'baseball')(at(after), at(fresh))).toBe(false);
  });

  it('sees the cursor move, by a tap or by a guess', () => {
    const walked = walk(fresh, 'baseball');
    expect(standingOn('baseball')(at(walked), at(fresh))).toBe(true);
    const tapped = select(walked, 'base');
    expect(movedCursor()(at(tapped), at(walked))).toBe(true);
    expect(movedCursor()(at(walked), at(walked))).toBe(false);
  });

  it('sees a letter hint and a move hint as different things', () => {
    const asked = useHint(fresh, 'cannonball');
    expect(hinted('cannonball')(at(asked), at(fresh))).toBe(true);
    expect(boughtMove()(at(asked), at(fresh))).toBe(false);

    const marked = useMoveHint(fresh, 'baseball', ['ball']);
    expect(boughtMove()(at(marked), at(fresh))).toBe(true);
    expect(markedMove('baseball', 'ball')(at(marked), at(fresh))).toBe(true);
    // Bought from one end, so it is already on the board when asked from the other.
    expect(markedMove('ball', 'baseball')(at(marked), at(fresh))).toBe(true);
  });

  it('sees a word named that the puzzle never declared', () => {
    const onBoard = walk(fresh, 'baseball');
    expect(strayed()(at(onBoard), at(fresh))).toBe(false);
    // `lifetime` is in the dictionary and off this puzzle's board entirely.
    const off = { ...onBoard, revealed: new Map(onBoard.revealed) };
    off.revealed.set('lifetime', { word: 'lifetime', via: 'baseball', move: null, order: 2 });
    expect(strayed()(at(off), at(fresh))).toBe(true);
  });

  it('sees the round end', () => {
    const done = walk(fresh, 'baseball', 'ball', 'cannonball', 'cannon');
    expect(done.solved).toBe(true);
    expect(solved()(at(done), at(fresh))).toBe(true);
  });
});

describe('selectors', () => {
  it('names an edge the same way whichever end it is given', () => {
    expect(pairKey('shadowing', 'sowing')).toBe('shadowing sowing');
    expect(pairKey('sowing', 'shadowing')).toBe('shadowing sowing');
  });

  it('points at each kind of thing', () => {
    expect(selectorsFor({ on: 'chrome', part: 'field' })).toEqual(['[data-tour="field"]']);
    expect(selectorsFor({ on: 'word', word: 'showing' })).toEqual(['[data-word="showing"]']);
    expect(selectorsFor({ on: 'mark', between: ['sowing', 'shadowing'] })).toEqual([
      '[data-mark="shadowing sowing"]',
    ]);
  });

  it('boxes a move with the two words it runs between', () => {
    // The edge's own box is the line and the subword written along it, which stops short
    // of the marks at either end — so lighting it alone cut both words in half.
    expect(selectorsFor({ on: 'move', between: ['sowing', 'shadowing'] })).toEqual([
      '[data-edge="shadowing sowing"]',
      '[data-word="sowing"]',
      '[data-word="shadowing"]',
    ]);
  });
});

describe('running a lesson', () => {
  const lesson: Lesson = {
    puzzle: 'aaaa1111',
    steps: [
      { id: 'read', title: 'Read this', body: null },
      {
        id: 'guess',
        title: 'Now guess',
        body: null,
        ask: { prompt: 'Name baseball.', done: reached('baseball') },
      },
      { id: 'end', title: 'Done', body: null },
    ],
  };

  const fresh = newGame(puzzle);

  it('lets a card with nothing to ask be walked past', () => {
    const run = startRun();
    expect(isCleared(lesson, run)).toBe(true);
    expect(canGoOn(lesson, run)).toBe(true);
    expect(canGoBack(lesson, run)).toBe(false);
  });

  it('holds the forward arrow until the prompt is answered', () => {
    const run = goOn(lesson, startRun());
    expect(run.at).toBe(1);
    expect(isCleared(lesson, run)).toBe(false);
    expect(canGoOn(lesson, run)).toBe(false);
    // And the back arrow is never held, because rereading is not a mistake.
    expect(canGoBack(lesson, run)).toBe(true);
  });

  it('carries the player on when the answer arrives while the card is up', () => {
    const run = goOn(lesson, startRun());
    const after = walk(fresh, 'baseball');
    const moved = observe(lesson, run, at(after), at(fresh));
    expect(moved.at).toBe(2);
    expect(moved.cleared.has('1#0')).toBe(true);
  });

  it('does nothing until it is answered', () => {
    const run = goOn(lesson, startRun());
    expect(observe(lesson, run, at(fresh), at(fresh))).toBe(run);
  });

  it('marks a beat already answered when it opens, and leaves the player there', () => {
    // The case the back arrow depends on: `reached('baseball')` stays true for the rest
    // of the round, so stepping back onto this card would otherwise bounce forward again
    // the instant it rendered, and back would be a button that does nothing.
    const after = walk(fresh, 'baseball');
    const run = goOn(lesson, startRun());
    const settled = observe(lesson, run, at(after), at(after));
    expect(settled.at).toBe(1);
    expect(settled.cleared.has('1#0')).toBe(true);
    expect(canGoOn(lesson, settled)).toBe(true);
    // And going back and forth from there stays put.
    expect(goBack(lesson, settled).at).toBe(0);
    expect(observe(lesson, goBack(lesson, settled), at(after), at(after)).at).toBe(0);
  });

  it('keeps a cleared beat cleared', () => {
    const after = walk(fresh, 'baseball');
    const run = observe(lesson, goOn(lesson, startRun()), at(after), at(fresh));
    const back = goBack(lesson, run);
    expect(isCleared(lesson, back)).toBe(true);
  });

  it('stops at the last card', () => {
    const run = { at: 2, beat: 0, cleared: new Set<string>() };
    expect(canGoOn(lesson, run)).toBe(false);
    expect(goOn(lesson, run)).toBe(run);
  });
});

/**
 * A card read in beats: the prose stays put while the spotlight and the prompt move on.
 *
 * "Tap this word, then name that one" is two acts in two places on the screen, so it is two
 * beats of one card — asking for both at once means the light is on the wrong one for half
 * the instruction.
 */
describe('a card in several beats', () => {
  const lesson: Lesson = {
    puzzle: 'aaaa1111',
    steps: [
      {
        id: 'two-parts',
        title: 'Tap, then name',
        body: null,
        spotlight: { on: 'word', word: 'cannon' },
        ask: { prompt: 'Tap cannon.', done: standingOn('cannon') },
        beats: [
          {
            spotlight: { on: 'chrome', part: 'guess' },
            ask: { prompt: 'Name cannonball.', done: reached('cannonball') },
          },
        ],
      },
      { id: 'end', title: 'Done', body: null },
    ],
  };

  const fresh = newGame(puzzle);

  it('reads the card as two beats, the card’s own fields first', () => {
    const run = startRun();
    expect(stageAt(lesson, run)?.spotlight).toEqual({ on: 'word', word: 'cannon' });
    const second = goOn(lesson, { ...run, cleared: new Set(['0#0']) });
    expect(second).toEqual({ at: 0, beat: 1, cleared: new Set(['0#0']) });
    expect(stageAt(lesson, second)?.spotlight).toEqual({ on: 'chrome', part: 'guess' });
  });

  it('gates each beat separately', () => {
    const run = startRun();
    expect(canGoOn(lesson, run)).toBe(false);
    // The goal is a place to stand from the first move, so this is a tap and not a guess.
    const stood = select(fresh, 'cannon');
    const moved = observe(lesson, run, at(stood), at(fresh));
    expect(moved).toMatchObject({ at: 0, beat: 1 });
    // The second beat starts unanswered even though the first is done.
    expect(isCleared(lesson, moved)).toBe(false);
  });

  it('judges a beat from when that beat opened, not from the card', () => {
    // Both beats of this card are about the same run of play, so a second beat measured
    // from the start of the *card* would count the tap that answered the first.
    const stood = select(fresh, 'cannon');
    const onSecond = { at: 0, beat: 1, cleared: new Set(['0#0']) };
    expect(observe(lesson, onSecond, at(stood), at(stood))).toBe(onSecond);
    const named = walk(stood, 'cannonball');
    expect(observe(lesson, onSecond, at(named), at(stood)).at).toBe(1);
  });

  it('steps back into a card at its last beat, not its first', () => {
    // Otherwise the beat the player just came from cannot be reached going backwards.
    const onEnd = { at: 1, beat: 0, cleared: new Set<string>() };
    expect(goBack(lesson, onEnd)).toMatchObject({ at: 0, beat: 1 });
  });

  it('counts beats rather than cards, so the tally always moves', () => {
    expect(place(lesson, startRun())).toEqual({ at: 1, of: 3 });
    expect(place(lesson, { at: 0, beat: 1, cleared: new Set() })).toEqual({ at: 2, of: 3 });
    expect(place(lesson, { at: 1, beat: 0, cleared: new Set() })).toEqual({ at: 3, of: 3 });
  });
});

/**
 * The shipped lesson, checked for shape and not for prose.
 *
 * What the cards *say* is judged by reading them on the board, and `e2e/tutorial.spec.ts`
 * deliberately names none of it. These are the two structural promises worth holding on to
 * as the content is rewritten.
 */
describe('the shipped lesson', () => {
  it('gives every beat that asks for something a prompt to ask with', () => {
    for (const step of LESSON.steps) {
      for (const stage of beatsOf(step)) {
        if (stage.ask) expect(stage.ask.prompt, step.id).not.toBe('');
      }
    }
  });

  it('splits a two-part instruction into two beats', () => {
    // "Tap this word, then name that one" is two acts in two places on the screen, so the
    // spotlight has to move between them. A lesson where every card is one beat has either
    // lost that or never needed it — and the ones here need it.
    const most = Math.max(...LESSON.steps.map((step) => beatsOf(step).length));
    expect(most).toBeGreaterThan(1);
  });
});
