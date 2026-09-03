/**
 * The machinery a tutorial is declared in: steps, what each one points at, and what
 * the player has to do before it gives way to the next one.
 *
 * **The tutorial is the real game.** It is not a mock board or a slideshow of
 * screenshots: `/tutorial` opens one particular puzzle out of the back catalogue and
 * plays it with the whole of App behind it, so every word, every hint and every mark a
 * step talks about is the one the player will meet tomorrow. What is added is a
 * spotlight, a panel of prose, and a rule about when to move on.
 *
 * Two consequences worth knowing before changing anything here.
 *
 * - **The lesson names a board by its id**, `Lesson.puzzle`, because a puzzle's address is
 *   a digest of its answer and the steps below name that answer's own words. A rebuild
 *   that changes the answer changes the id, and the tutorial then refuses to run rather
 *   than teaching `showing + ad` on some other board — see `Tutorial.tsx`. That refusal is
 *   the whole reason the id is here rather than a date or a day number.
 * - **A step is a question about game state, never about which button was clicked.**
 *   `Advance` takes two `Moment`s — now, and the moment the step was entered — and says
 *   whether what it asked for has happened. So a prompt is satisfied by the player doing
 *   the thing, however they did it: typing a guess, tapping a word, or arriving there by
 *   a route the step never anticipated.
 *
 * Nothing here draws. The content lives in `components/lessons.tsx` and the driving in
 * `components/Tutorial.tsx`; this file is the vocabulary both of them speak, and it is
 * pure so that the awkward part — when a step clears and when that carries the player
 * forward — is testable in node.
 */

import type { ReactNode } from 'react';
import { hintCount, moveHint, type GameState } from './game';

/**
 * The game, as a step's question gets to see it.
 *
 * `state` is the whole of a game (see game.ts) and answers most questions on its own.
 * The other two are things App works out and the state does not carry: whether the
 * player has an end of a shortcut, and which words the board is currently drawing.
 */
export interface Moment {
  state: GameState;
  /** The player has landed on a shortcut — App's `onSecret`. */
  onShortcut: boolean;
  /** Every word on the plate right now, which grows as the player strays off it. */
  drawn: ReadonlySet<string>;
}

/**
 * Whether a step's prompt has been answered.
 *
 * Given the moment now and the moment the step was entered, so a condition can be
 * written either way round: as a state to be in (`reached('shadowing')`) or as something
 * new to have happened (`guessedAny()`). Both readings are safe, because a step that is
 * *already* satisfied when it opens is marked done without carrying the player onward —
 * see `observe`. That is what makes the back arrow work: stepping back onto "type
 * shadowing" when `shadowing` is long since named must not bounce straight forward again.
 */
export type Advance = (now: Moment, entered: Moment) => boolean;

/** A move the player has made, either way round. */
function walked(state: GameState, a: string, b: string): boolean {
  return state.log.some(
    ({ from, to }) => (from === a && to === b) || (from === b && to === a),
  );
}

/** Any guess at all was accepted while this step was showing. */
export const guessedAny = (): Advance => (now, entered) =>
  now.state.log.length > entered.state.log.length;

/** This word has been named. */
export const reached = (word: string): Advance => (now) => now.state.revealed.has(word);

/** This particular move has been made, from either end. */
export const walkedMove =
  (a: string, b: string): Advance =>
  (now) =>
    walked(now.state, a, b);

/** The player is standing on this word — a tap on it, or a guess that landed there. */
export const standingOn = (word: string): Advance => (now) => now.state.selected === word;

/** The player moved to some other word to guess from than the one they were on. */
export const movedCursor = (): Advance => (now, entered) =>
  now.state.selected !== entered.state.selected;

/** A hint of any kind was bought: a letter, a letter count, or the shape of a move. */
export const hintedAny = (): Advance => (now, entered) =>
  hintCount(now.state) > hintCount(entered.state);

/** This word has been asked about at least once. */
export const hinted = (word: string): Advance => (now) => (now.state.hints.get(word) ?? 0) > 0;

/** This number has n letters revealed */
export const hintedLetters = (word: string, n: number): Advance => (now) => (now.state.hints.get(word) ?? 0) > n;

/** A `+` or `−` was bought on some edge — the hint a word on the answer sells. */
export const boughtMove = (): Advance => (now, entered) =>
  now.state.edgeHints.size > entered.state.edgeHints.size;

/** The sign on this particular move has been bought, from either end. */
export const markedMove =
  (a: string, b: string): Advance =>
  (now) =>
    moveHint(now.state, a, b) !== null;

/**
 * The player named a word the puzzle does not declare, so the board grew to hold it.
 *
 * The two endpoints are excluded because they are on every board by construction; what
 * this is about is guessing off the map and watching the map follow.
 */
export const strayed = (): Advance => (now) => {
  const { source, target, board } = now.state.puzzle;
  const declared = new Set([source, target, ...board]);
  for (const word of now.state.revealed.keys()) if (!declared.has(word)) return true;
  return false;
};

/** The board is drawing more words than the puzzle declared. */
export const boardGrew = (): Advance => (now, entered) => now.drawn.size > entered.drawn.size;

/** The player has an end of a route shorter than par. */
export const foundShortcut = (): Advance => (now) => now.onShortcut;

/** The moves made join the two words: the round is over. */
export const solved = (): Advance => (now) => now.state.solved;

/** Any one of these will do. */
export const either =
  (...some: readonly Advance[]): Advance =>
  (now, entered) =>
    some.some((one) => one(now, entered));

/** All of these, in any order. */
export const both =
  (...every: readonly Advance[]): Advance =>
  (now, entered) =>
    every.every((one) => one(now, entered));

/**
 * The named handles the chrome offers a step to point at.
 *
 * Names rather than raw selectors, so the set of things a step *can* point at is
 * enumerable and a typo is a type error rather than a spotlight over nothing. Each one
 * is a `data-tour` attribute in the component that owns it; adding to this list means
 * adding the attribute too.
 */
export const CHROME = [
  'masthead',
  'statement',
  'tally',
  'length',
  'menu',
  'plate',
  'guess',
  'field',
  'reset-view',
] as const;

export type Chrome = (typeof CHROME)[number];

/**
 * What a step lights up.
 *
 * The three board cases are addressed by the words they are about rather than by
 * position, because a word moves: the force layout settles, the camera glides, and a
 * selector is the only handle that survives both. GraphPlate carries the matching
 * attributes.
 */
export type Spotlight =
  | { on: 'chrome'; part: Chrome }
  /** A word's mark on the plate. */
  | { on: 'word'; word: string }
  /** The line between two words. */
  | { on: 'move'; between: readonly [string, string] }
  /** The `+` or `−` sign bought on a move, which exists only once it has been bought. */
  | { on: 'mark'; between: readonly [string, string] };

/** The pair form the plate keys an edge by: alphabetical, so either order finds it. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a} ${b}` : `${b} ${a}`;
}

/**
 * Where to find a spotlight's target in the document — **everything it covers**, not one
 * element.
 *
 * Selectors rather than elements, because a target may not exist yet: a mark is only in the
 * DOM once it has been bought, and a word only once the board draws it. What is found is
 * boxed together into one lit area, and finding nothing is a panel with no cutout.
 *
 * A move names its two words as well as the line between them, and that is the point of
 * this returning a list. An edge's own box is the line and the subword written along it,
 * which stops short of the marks at either end — so a step saying "this is what a move
 * looks like" lit the middle of it and cut both of the words it is between in half.
 */
export function selectorsFor(spot: Spotlight): string[] {
  switch (spot.on) {
    case 'chrome':
      return [`[data-tour="${spot.part}"]`];
    case 'word':
      return [`[data-word="${spot.word}"]`];
    case 'move':
      return [
        `[data-edge="${pairKey(...spot.between)}"]`,
        `[data-word="${spot.between[0]}"]`,
        `[data-word="${spot.between[1]}"]`,
      ];
    // The sign alone: it is a mark about one move, and boxing its two words with it would
    // point at the move rather than at the thing being explained. Small targets are given a
    // floor by the stage instead — see `MIN_STAGE`.
    case 'mark':
      return [`[data-mark="${pairKey(...spot.between)}"]`];
  }
}

/**
 * Where the camera should be looking while a step is up.
 *
 * Only the two the tutorial actually needs. `words` frames a few words so a step about
 * one move is not read across a board of fifteen; `board` is the view the round is
 * played at, which is where a step that is about the whole figure wants to be. Absent
 * means leave the camera where the player left it — the default, because moving the
 * board is something the player should mostly be doing.
 */
export type Look = { at: 'words'; words: readonly string[] } | { at: 'board' };

/** What the player has to do, and how the panel asks for it. */
export interface Ask {
  /** One imperative sentence. Shown apart from the prose, and ticked when it is done. */
  prompt: string;
  done: Advance;
}

/**
 * One beat: somewhere to point, somewhere to look, and one thing to do.
 *
 * A card can be read in several of these, which is what `Step.beats` is for. The reason is
 * that a single instruction is often two acts in two places — "tap `towing`, then name
 * `wing` from it" points first at a word on the plate and then at the guess bar, and
 * asking for both at once means the spotlight is on the wrong one for half of it.
 */
export interface Stage {
  spotlight?: Spotlight;
  look?: Look;
  /** Absent means the beat is read and dismissed with the arrow. */
  ask?: Ask;
}

/**
 * A card: a title, some prose, and the beats it is read in.
 *
 * The card's own `spotlight`, `look` and `ask` are its first beat, so a card that has one
 * thing to say declares it the obvious way and says nothing about beats at all.
 */
export interface Step extends Stage {
  /** Stable, and part of the key the run remembers a cleared beat by. Never shown. */
  id: string;
  title: string;
  body: ReactNode;
  /**
   * Further beats of this card. The prose stays put; the spotlight and the prompt move on.
   */
  beats?: readonly Stage[];
}

/** Every beat of a card, the card's own fields first. */
export function beatsOf(step: Step): Stage[] {
  const first: Stage = {
    ...(step.spotlight ? { spotlight: step.spotlight } : {}),
    ...(step.look ? { look: step.look } : {}),
    ...(step.ask ? { ask: step.ask } : {}),
  };
  return [first, ...(step.beats ?? [])];
}

export interface Lesson {
  /**
   * The board this is taught on, by its id.
   *
   * See the note at the top: the steps name this puzzle's own words, so a bank in which
   * this id is missing is a bank the tutorial cannot be run against.
   */
  puzzle: string;
  steps: readonly Step[];
}

/** Where the player is in a lesson: which card, and which beat of it. */
export interface Run {
  at: number;
  beat: number;
  /** Beats whose prompt has been answered, by key. Sticky: answering is not undone. */
  cleared: ReadonlySet<string>;
}

export function startRun(): Run {
  return { at: 0, beat: 0, cleared: new Set() };
}

/**
 * A run picked up where it was left, bounded by the lesson it is being picked up in.
 *
 * The saved position has sat in a browser across releases and the lesson it belongs to has
 * been rewritten since — cards reordered, beats added, the whole thing re-sited. So the
 * position is clamped to somewhere that exists rather than trusted, and the worst a stale
 * save can do is land the player on a card they have already read. Nothing is dropped: a
 * beat that is no longer there is simply never asked about again.
 */
export function runFrom(
  lesson: Lesson,
  saved: { at: number; beat: number; cleared: readonly string[] } | null,
): Run {
  if (!saved || lesson.steps.length === 0) return startRun();
  const at = Math.min(Math.max(saved.at, 0), lesson.steps.length - 1);
  const step = lesson.steps[at];
  const beats = step ? beatsOf(step).length : 1;
  return {
    at,
    beat: Math.min(Math.max(saved.beat, 0), beats - 1),
    cleared: new Set(saved.cleared),
  };
}

export function stepAt(lesson: Lesson, run: Run): Step | undefined {
  return lesson.steps[run.at];
}

/** The beat on screen. */
export function stageAt(lesson: Lesson, run: Run): Stage | undefined {
  const step = stepAt(lesson, run);
  return step ? beatsOf(step)[run.beat] : undefined;
}

/** What a beat is remembered by, which is the card it belongs to and where in it. */
export function beatKey(run: Run): string {
  return `${run.at}#${run.beat}`;
}

/** Has the beat on screen been satisfied? A beat with nothing to ask always has. */
export function isCleared(lesson: Lesson, run: Run): boolean {
  const stage = stageAt(lesson, run);
  if (!stage) return true;
  return stage.ask === undefined || run.cleared.has(beatKey(run));
}

/** How many beats a card is read in. */
function beatCount(lesson: Lesson, at: number): number {
  const step = lesson.steps[at];
  return step ? beatsOf(step).length : 0;
}

/**
 * The next place there is, beat before card, or null at the end of the lesson.
 *
 * Everything that moves goes through this and `behind`, so where a card ends and the next
 * one begins is written down once. Which matters more than it looks: stepping back into a
 * card has to land on its *last* beat, not its first, or the beat the player just came
 * from is unreachable going backwards.
 */
function ahead(lesson: Lesson, run: Run): Pick<Run, 'at' | 'beat'> | null {
  if (run.beat + 1 < beatCount(lesson, run.at)) return { at: run.at, beat: run.beat + 1 };
  if (run.at + 1 < lesson.steps.length) return { at: run.at + 1, beat: 0 };
  return null;
}

function behind(lesson: Lesson, run: Run): Pick<Run, 'at' | 'beat'> | null {
  if (run.beat > 0) return { at: run.at, beat: run.beat - 1 };
  if (run.at > 0) return { at: run.at - 1, beat: Math.max(beatCount(lesson, run.at - 1) - 1, 0) };
  return null;
}

/**
 * The forward arrow is live once the prompt has been answered, and the back arrow
 * whenever there is anything behind.
 *
 * Forward is gated and back is not, because the prompt is the point: a beat that says
 * "type shadowing" and can be skipped has taught nothing. Back is free because rereading
 * is never a mistake.
 */
export function canGoOn(lesson: Lesson, run: Run): boolean {
  return ahead(lesson, run) !== null && isCleared(lesson, run);
}

export function canGoBack(lesson: Lesson, run: Run): boolean {
  return behind(lesson, run) !== null;
}

/** The last beat of the last card, whose forward arrow finishes rather than advances. */
export function atEnd(lesson: Lesson, run: Run): boolean {
  return ahead(lesson, run) === null;
}

export function goOn(lesson: Lesson, run: Run): Run {
  const next = ahead(lesson, run);
  return next && isCleared(lesson, run) ? { ...run, ...next } : run;
}

export function goBack(lesson: Lesson, run: Run): Run {
  const back = behind(lesson, run);
  return back ? { ...run, ...back } : run;
}

/**
 * How far through the lesson this is, counted in **beats**.
 *
 * Beats and not cards, because that is what the arrows move: a counter that stood still
 * while a two-beat card was worked through would read as a tutorial that had jammed.
 */
export function place(lesson: Lesson, run: Run): { at: number; of: number } {
  let before = 0;
  for (let i = 0; i < run.at; i++) before += beatCount(lesson, i);
  let total = 0;
  for (let i = 0; i < lesson.steps.length; i++) total += beatCount(lesson, i);
  return { at: before + run.beat + 1, of: total };
}

function clear(run: Run): Run {
  const key = beatKey(run);
  if (run.cleared.has(key)) return run;
  return { ...run, cleared: new Set(run.cleared).add(key) };
}

/**
 * What a moment does to a run: mark the beat done if its prompt is answered, and carry
 * the player on if the answer arrived **while the beat was showing**.
 *
 * That distinction is the whole of this function, and it is what makes the arrows usable.
 * A condition like `reached('shadowing')` is true for the rest of the round once it is
 * true at all, so a player who steps back to reread that beat would be shoved forward
 * again the instant they got there, and back would be a button that does nothing. So a
 * beat already satisfied when it opens is marked done — the forward arrow lights — and
 * left alone.
 *
 * Returns the run unchanged when nothing happened, so the caller can set state
 * unconditionally without re-rendering for every frame of a settle.
 */
export function observe(lesson: Lesson, run: Run, now: Moment, entered: Moment): Run {
  const stage = stageAt(lesson, run);
  if (!stage?.ask) return run;
  if (!stage.ask.done(now, entered)) return run;
  const marked = clear(run);
  // Already true when the beat opened: light the arrow, but let the player press it.
  if (stage.ask.done(entered, entered)) return marked;
  return goOn(lesson, marked);
}
