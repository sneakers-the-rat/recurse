/**
 * What has been found: which words, how each was reached, and the moves made.
 *
 * What a guess does to a board, shared by the daily game and the open map. Nothing here knows
 * about puzzles, par or hints: `advance` is told how to rank a landing, and `replay` where the
 * player could have been standing.
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
 * A board's discoveries. `GameState` and `Atlas` extend it, so either takes a step with
 * `{ ...state, ...found }`. `guesses` is kept because one guess can be several moves.
 */
export interface Found {
  /** Words the player has reached. */
  revealed: Map<string, Revealed>;
  log: LogEntry[];
  guesses: number;
}

/** The key a hinted move is stored under. Directed: a hint is about the word asked from. */
export function moveKey(from: string, to: string): string {
  return `${from} ${to}`;
}

/** The key a made move is stored under. Undirected: a move goes both ways. */
export function edgeKey(a: string, b: string): string {
  return a < b ? `${a} ${b}` : `${b} ${a}`;
}

/** Whether the logged moves connect these two words. The daily round ends when its ends join. */
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
 * One reading per token, in case the shipped lexicon repeats one. A repeat would be logged
 * twice but restored once, since `replay` drops repeated edges.
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
 * Add an accepted guess, made from `from`.
 *
 * Every reading that plays (`also` on `Judgement`) is logged, as one guess. Readings already on
 * the log are skipped; if none is left, nothing is logged, `moved` is false and only the cursor
 * moves. `rank` picks where the cursor lands: lowest wins, ties go to the first reading.
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
    // Ranked the same way, so re-typing a word lands where typing it first did.
    const already = best(readings);
    return { found, landed: already.word, move: already.move, moved: false };
  }

  // The landed reading is logged first; `guessedWords` relies on it.
  const landed = best(fresh);
  const made = [landed, ...fresh.filter((one) => one.word !== landed.word)];

  const order = found.guesses + 1;
  // `via` and `order` record how a word was first reached, so a found word keeps its entry.
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
 * Whether a log entry begins a new guess. The one definition, used by `replay`, `guessedWords`
 * and `actionsOf` in actions.ts.
 *
 * An entry continues the previous guess only with the same order and the same `from`, so a
 * tampered snapshot cannot merge two guesses into one. A `NaN` order always begins a guess.
 */
export function newGuess(
  entry: { order: number; from: string },
  before: { order: number; from: string } | undefined,
): boolean {
  return before === undefined || entry.order !== before.order || entry.from !== before.from;
}

/** The word each guess landed on, one per guess, in order. */
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
 * Rebuild what was found from a stored log, dropping anything malformed. Total.
 *
 * A move is kept only if it starts from a revealed word or one of `elsewhere` (words a game
 * lets you stand on without reaching them), so the trail stays connected. Repeated moves are
 * dropped.
 */
export function replay(
  entries: unknown,
  start: string,
  elsewhere: ReadonlySet<string> = new Set(),
): Found {
  const { revealed } = open(start);
  const log: LogEntry[] = [];
  const made = new Set<string>();
  // Stored orders are used only for grouping (see `newGuess`); guesses are renumbered from 1.
  // Compared against the last entry kept, not the last one read.
  let previous: { order: number; from: string } | undefined;
  let order = 0;
  for (const entry of Array.isArray(entries) ? (entries as LogEntry[]) : []) {
    if (!entry || typeof entry.to !== 'string' || !isMove(entry.move)) continue;
    // Only a tampered snapshot can hold a move from a word to itself.
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
