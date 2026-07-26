/** Shared shapes for the puzzle data and game state. */

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
  internalOnly: boolean;
}

/**
 * `public/data/graph.json`, as written by tools/build_graph.py.
 *
 * `edges` is a flat array of index pairs into the dictionary, with the first of
 * each pair delta-encoded — see decodeEdges. Subwords and positions are not
 * stored; they are derived from a word pair on demand. That keeps 162k edges to
 * 352KB gzipped rather than 1,278KB.
 */
export interface RawGraph {
  params: GraphParams;
  edges: number[];
}

/** `public/data/dictionary.json`: newline-joined, sorted, the canonical index. */
export interface RawDictionary {
  words: string;
}

/** `public/data/puzzles.json`. */
export interface RawPuzzles {
  params: {
    /** Selection's neighbourhood measure on the common graph. Not a draw budget. */
    slack: number;
    /** What the board draws, on the legal graph. See .env. */
    drawSlack: number;
    drawMax: number;
    minPar: number;
    maxPar: number;
  };
  puzzles: Puzzle[];
}

export interface Puzzle {
  source: string;
  target: string;
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
  movesFrom(word: string): readonly Move[];
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

export type Judgement =
  | { ok: true; move: Move; word: string }
  | { ok: false; code: Rejection; message: string; detail?: EditShape & { sub?: string } };

export interface Point {
  x: number;
  y: number;
}
