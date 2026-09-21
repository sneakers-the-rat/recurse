/**
 * What has been found: which words, how each was reached, and the moves made.
 *
 * **The one definition of what a guess does to a board**, and the reason it is its own file is
 * that there is more than one game now. The daily puzzle has two ends, a par and a round that
 * finishes; the explore mode has a word you started from and no end at all. What they agree
 * about completely is this: a guess from somewhere you are standing names one or more words,
 * every reading of it that is a fresh move goes on the log, the cursor lands on the one most
 * already part of the board, and a move you have made before is free.
 *
 * Two implementations of that would be exactly the hazard the codebase already carries a
 * warning about — `wordReading` in moves.ts and `readings` in word.rs are two halves of one
 * definition and have to be kept in step by hand. This is one.
 *
 * What is *not* here is anything about why you are playing: no puzzle, no endpoints, no par,
 * no score, no hints, no solved condition. `advance` is told how to rank a landing rather than
 * working it out, and `replay` is told where the player could have been standing rather than
 * knowing. Both of those are the one question each game answers differently.
 */

import type { Judgement, Move, Revealed } from './types';

export interface LogEntry {
  from: string;
  to: string;
  move: Move;
  /** Guess number this was, 1-based. */
  order: number;
}

/**
 * A board's discoveries, and nothing else.
 *
 * `GameState` and the explore mode's `Atlas` both hold one of these — structurally, so
 * `{ ...state, ...found }` is how either of them takes a step. `guesses` is the tally the log
 * cannot give directly, because one guess can be several moves; see `newGuess`.
 */
export interface Found {
  /** Words the player has *reached*. Somewhere they may stand but have not got to is not one. */
  revealed: Map<string, Revealed>;
  log: LogEntry[];
  guesses: number;
}

/** The key a given-away move is remembered by, and drawn from. Directed. */
export function moveKey(from: string, to: string): string {
  return `${from} ${to}`;
}

/**
 * The key a move *made* is remembered by. **Undirected**, unlike `moveKey`.
 *
 * The two exist for opposite reasons and the difference is the point. A hint on a move is
 * about the word that was asked, so which end it was asked from is the whole content of it.
 * A move the player made is a move in both directions at once — the letters came out going
 * one way and would go back in going the other — so `a b` and `b a` are one entry, and the
 * game must not charge twice or draw twice for one thing.
 */
export function edgeKey(a: string, b: string): string {
  return a < b ? `${a} ${b}` : `${b} ${a}`;
}

/**
 * Do the moves made join these two words?
 *
 * A walk of the log, which is a handful of edges — nothing here is worth an index. The daily
 * game asks it of its two ends, and the answer is whether the round is over: two halves that
 * touch anywhere are one chain. A board with no ends never asks.
 */
export function joins(from: string, to: string, log: readonly LogEntry[]): boolean {
  if (from === to) return true;
  const near = new Map<string, string[]>();
  for (const { from: a, to: b } of log) {
    if (!near.has(a)) near.set(a, []);
    if (!near.has(b)) near.set(b, []);
    near.get(a)!.push(b);
    near.get(b)!.push(a);
  }
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length > 0) {
    const at = queue.shift()!;
    for (const next of near.get(at) ?? []) {
      if (next === to) return true;
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return false;
}

/** A board with one word on it and nothing done yet. */
export function open(word: string): Found {
  return {
    revealed: new Map([[word, { word, via: null, move: null, order: 0 }]]),
    log: [],
    guesses: 0,
  };
}

/**
 * One reading per token.
 *
 * The lexicon is decoded from a shipped file, and nothing downstream of it should have to
 * trust that a spelling lists each of its tokens once. Two readings of the same token are one
 * move: logged twice under one order they would draw one edge, restore as one — `replay`
 * drops a repeated edge — and leave a reload disagreeing with the game it restored.
 */
function dedupe(readings: { word: string; move: Move }[]): { word: string; move: Move }[] {
  const seen = new Set<string>();
  const once: { word: string; move: Move }[] = [];
  for (const reading of readings) {
    if (seen.has(reading.word)) continue;
    seen.add(reading.word);
    once.push(reading);
  }
  return once;
}

/** Where a guess left the board, and where it left the cursor. */
export interface Step {
  found: Found;
  /** The word the cursor ends up on. */
  landed: string;
  /** The move it got there by. */
  move: Move;
  /** Whether anything was added. False when every reading was a move already made. */
  moved: boolean;
}

/**
 * Add an accepted guess, made from `from`, to what has been found.
 *
 * **Every reading the guess named, as one guess.** A typed word can name several tokens — see
 * `also` on `Judgement` — and every one of them that makes a legal move from here is a move
 * the player has just made. They all go on the board and the tally goes up by one, because the
 * player typed one word: charging per pronunciation would charge for knowing less about the
 * language. On `does → dissenters` the reading that happened to sort first was not the goal, so
 * adding only that one built a second node beside the goal and the round could not be finished.
 *
 * Readings whose move is already on the log are dropped rather than repeated, and if *none*
 * survives the whole guess is free navigation: `moved` is false, nothing is logged, and the
 * cursor still moves to where the guess pointed. Walking back along a move you already made
 * tells you nothing you did not know, and charging for it would punish reading your own map.
 *
 * `rank` decides where the cursor lands when the guess named more than one playable word:
 * lower is better and ties go to the first reading, which is the most familiar one because the
 * lexicon orders them. What counts as better is the one thing the two games answer differently
 * — the daily game prefers an endpoint, then the answer route — so it is asked rather than
 * assumed.
 */
export function advance(
  found: Found,
  from: string,
  judged: Extract<Judgement, { ok: true }>,
  rank: (word: string) => number = () => 0,
): Step {
  const readings = dedupe([{ word: judged.word, move: judged.move }, ...judged.also]);
  const known = new Set(found.log.map((entry) => edgeKey(entry.from, entry.to)));
  const fresh = readings.filter(({ word }) => !known.has(edgeKey(from, word)));

  const best = (of: readonly { word: string; move: Move }[]) =>
    of.reduce((won, one) => (rank(one.word) < rank(won.word) ? one : won), of[0]!);

  if (fresh.length === 0) {
    // Asked the same question as a fresh guess, so re-typing a word puts the cursor where
    // typing it the first time did.
    const already = best(readings);
    return { found, landed: already.word, move: already.move, moved: false };
  }

  /*
    The landed reading goes **first on the log**, so that "the moves of guess N" and "what
    guess N did" can be read off the same list: anything wanting one word per guess takes the
    first entry of each order. See `guessedWords`, the trail in App's `result`, and the word
    table in `recordOf`.
  */
  const landed = best(fresh);
  const made = [landed, ...fresh.filter((one) => one.word !== landed.word)];

  const order = found.guesses + 1;
  // A word already named keeps the entry it arrived with: `via` and `order` record how it
  // was *first* reached, and a second way in is a move rather than another arrival.
  const revealed = new Map(found.revealed);
  for (const { word, move } of made) {
    if (!revealed.has(word)) revealed.set(word, { word, via: from, move, order });
  }
  const log = [...found.log, ...made.map(({ word, move }) => ({ from, to: word, move, order }))];

  return {
    found: { revealed, log, guesses: order },
    landed: landed.word,
    move: landed.move,
    moved: true,
  };
}

/**
 * Does this log entry begin a new guess, or belong to the one before it?
 *
 * **The one definition of what a guess is**, because three things need it and they must not
 * disagree: `replay` numbers the guesses, `guessedWords` counts them, and `actionsOf` in
 * actions.ts writes them down for a shared board. A typed word can name several tokens and put
 * a move on the log for each — see `advance` — so the log is longer than the tally, and a
 * consumer that grouped it differently would hand back a different score.
 *
 * An entry belongs to the guess before it when it carries the same order *and* the same word
 * moved from. The `from` matters because every move of one guess is made from where the player
 * was standing: two genuinely separate guesses that both claim one order — which nothing here
 * writes, but a hand-edited snapshot could — then still count as two. That is the direction
 * worth guarding, since merging two invents a better score than was played.
 *
 * A `NaN` order is never equal to itself, so an entry whose order did not survive being
 * written down begins a guess of its own. That is `replay` wanting a number it cannot trust to
 * buy nothing, and it falls out of the comparison rather than needing a case.
 */
export function newGuess(
  entry: { order: number; from: string },
  before: { order: number; from: string } | undefined,
): boolean {
  return before === undefined || entry.order !== before.order || entry.from !== before.from;
}

/**
 * The word each guess landed on, in order: one per guess, however many moves it made.
 *
 * Anything counting *guesses* rather than moves has to come through here: the shared trail is
 * "one mark per guess" and the word table is about words the player typed, and both read as
 * double-counting otherwise. The first entry of each guess is the one it landed on, which
 * `advance` guarantees.
 */
export function guessedWords(log: readonly LogEntry[]): string[] {
  return log.filter((entry, at) => newGuess(entry, log[at - 1])).map((entry) => entry.to);
}

function isMove(value: unknown): value is Move {
  const move = value as Move | null;
  return (
    typeof move === 'object' &&
    move !== null &&
    typeof move.sub === 'string' &&
    typeof move.pos === 'number' &&
    (move.kind === 'add' || move.kind === 'remove')
  );
}

/**
 * Rebuild what was found from a stored log, dropping anything that does not make sense.
 *
 * Total by construction. A snapshot is a string that was in a browser for a month — it may
 * have been written by an older version, or by a bank in which one of these words no longer
 * exists, and a half-restored map that crashes the board is a far worse outcome than a game
 * that quietly starts again.
 *
 * A move is replayed only if it starts somewhere the player could have been standing: a word
 * already revealed, or one of `elsewhere` — the places a game lets you stand without having
 * reached them, which is the daily game's goal and nothing at all on an open board. So the
 * trail stays connected however mangled the input. A move that repeats one already replayed is
 * dropped, because the game does not charge for those and a snapshot claiming two would
 * inflate the score.
 */
export function replay(
  entries: unknown,
  start: string,
  elsewhere: ReadonlySet<string> = new Set(),
): Found {
  const { revealed } = open(start);
  const log: LogEntry[] = [];
  const made = new Set<string>();
  /*
    **One guess can be several moves, so the count is guesses and not entries.**

    `newGuess` is the definition, shared with everything else that has to agree about it. The
    stored order is read for its *grouping* and never for its value: the counter goes up
    whenever a guess begins, so entries dropped below leave no gap, a snapshot written before
    any of this — where every entry has its own order — restores exactly as it always did, and
    a number somebody typed into `localStorage` cannot run the tally anywhere.

    Compared against the last entry *kept*, not the last one read: dropping an entry costs a
    guess and is conservative, while letting a dropped one break up a group would invent one.
  */
  let previous: { order: number; from: string } | undefined;
  let order = 0;
  for (const entry of Array.isArray(entries) ? (entries as LogEntry[]) : []) {
    if (!entry || typeof entry.to !== 'string' || !isMove(entry.move)) continue;
    // A move from a word to itself is not a move. It cannot be typed — an empty edit is
    // refused — but a hand-edited snapshot could claim one, and it would cost a guess.
    if (entry.from === entry.to) continue;
    if (!revealed.has(entry.from) && !elsewhere.has(entry.from)) continue;
    const key = edgeKey(entry.from, entry.to);
    if (made.has(key)) continue;
    made.add(key);
    const here = {
      order: Number.isFinite(entry.order) ? Number(entry.order) : NaN,
      from: entry.from,
    };
    if (newGuess(here, previous)) order += 1;
    previous = here;
    if (!revealed.has(entry.to)) {
      revealed.set(entry.to, { word: entry.to, via: entry.from, move: entry.move, order });
    }
    log.push({ from: entry.from, to: entry.to, move: entry.move, order });
  }
  return { revealed, log, guesses: order };
}
