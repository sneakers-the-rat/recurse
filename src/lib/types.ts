/**
 * The game's vocabulary: the shapes that cross module boundaries.
 *
 * What the *files* look like belongs to data.ts, which is the only module that
 * should ever have to know.
 */

import type { Phrase } from '../i18n/format';

/** A single legal step: add or remove `sub` at `pos`. */
export interface Move {
  to: string;
  sub: string;
  pos: number;
  kind: 'add' | 'remove';
}

/** Build parameters, echoed into the data so the UI can quote real limits. */
export interface GraphParams {
  /** SCOWL size puzzles are built from; only a filter on what is offered. */
  commonScowl: number;
  /** SCOWL size a player may guess in; the graph that actually ships. */
  legalScowl: number;
  minWord: number;
  minSub: number;
}

export interface Puzzle {
  /**
   * The puzzle's address: hex digits of a digest of its answer, and the whole of
   * its URL. Not enumerable on purpose — see route.ts and graphgen's id.rs.
   */
  id: string;
  /**
   * The **first** day of the calendar this puzzle falls on: what the header calls it and what
   * the share text quotes when a board is opened by its id. Metadata, never an address — no URL
   * carries it.
   *
   * First, because a band shorter than the calendar cycles inside it, so one puzzle answers to
   * several dates. Which date is being played comes from the calendar rather than from here —
   * see `idForDay` in data.ts.
   */
  day: number;
  /**
   * Which of the three lengths this is: 0 short, 1 medium, 2 long.
   *
   * Every day offers one of each, so a day number names three boards. A band shorter than the
   * calendar repeats within it rather than running out. Derived from par by the builder
   * (`band_of`), shipped rather than re-derived here, so where the lengths divide stays one
   * definition in `.env`.
   */
  band: number;
  source: string;
  target: string;
  /**
   * Every word the board draws, decided by the builder.
   *
   * A puzzle *is* this set: the ways through it and enough of the graph joining them that
   * they read as one neighbourhood. The client draws it verbatim rather than working out a
   * neighbourhood of its own — see `board_words` in graphgen's select.rs. Which of them are
   * gold is not stored, because a word is on a shortest route exactly when its distances from
   * the two endpoints add to par, and the client has the graph and both endpoints.
   */
  board: string[];
  /** Fewest moves using ordinary words — the score to beat. */
  par: number;
  /**
   * Moves in the best route the whole dictionary allows, when some rarer word
   * beats par. Zero when par cannot be beaten.
   *
   * Not a flaw in the puzzle: beating par is the best thing a player can do, and
   * the game marks the route gold when they walk it.
   */
  secret: number;
  /**
   * Neighbourhood size on the *common* graph, as a difficulty proxy. Not the
   * number of nodes drawn: the board is built on the much larger legal graph and
   * sizes itself adaptively. See plate.ts.
   */
  corridorSize: number;
  /** Common-graph nodes forming a genuine longer route, not a dead-end spur. */
  altNodes: number;
  shortestPaths: number;
  maxRank: number;
}

/** The graph, with legality lookups. See graph.ts. */
export interface Graph {
  params: GraphParams;
  /** The full dictionary, sorted; also the edge list's index. */
  words: readonly string[];
  /** Is this a legal word at all? Any dictionary word is a legal guess. */
  isWord(word: string): boolean;
  /** Is this a word people know? Only these are drawn — see commonNeighbors. */
  isCommon(word: string): boolean;
  /**
   * Neighbours by a move made entirely of ordinary words. The board is drawn from
   * these; `neighbors` is the whole legal graph, which is what a guess is judged
   * against.
   */
  commonNeighbors(word: string): readonly string[];
  /** Does this word have at least one move? */
  has(word: string): boolean;
  neighbors(word: string): readonly string[];
  findMove(from: string, to: string): Move | null;
  degree(word: string): number;
}

/** How a word came to be revealed, for drawing the trail the player made. */
export interface Revealed {
  word: string;
  /** The word it was reached from; null for the puzzle's source. */
  via: string | null;
  move: Move | null;
  /** Guess number that revealed it; 0 for the source. */
  order: number;
}

export type Rejection =
  | 'empty'
  | 'not-letters'
  | 'identical'
  | 'swap'
  | 'scattered'
  | 'sub-too-short'
  | 'sub-not-word'
  | 'not-a-word'
  | 'too-short'
  | 'no-move';

/** Shape of an edit, independent of whether it is legal. */
export type EditShape =
  | { shape: 'identical' }
  | { shape: 'swap' }
  | { shape: 'add'; spots: InsertionSpot[]; length: number }
  | { shape: 'remove'; spots: InsertionSpot[]; length: number }
  | { shape: 'scattered'; direction: 'add' | 'remove'; length: number };

export interface InsertionSpot {
  pos: number;
  sub: string;
}

/**
 * A verdict on a guess.
 *
 * A refusal carries the *phrase* it would be said in — a message and its values — rather
 * than a finished sentence, because this module is judged in node and must not know which
 * language the player reads. Whoever draws it says it; see `Phrase` in i18n/format.ts.
 *
 * The code is for tests to pin the reason. An `EditShape` used to ride along too, and
 * nothing ever looked at it.
 */
export type Judgement =
  | { ok: true; move: Move; word: string }
  | { ok: false; code: Rejection; reason: Phrase };

export interface Point {
  x: number;
  y: number;
}
