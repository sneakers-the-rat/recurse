/**
 * How big a word is drawn, in graph units: the plate draws to these and the layout reserves room
 * by them (`boxOf` in forces.ts) before anything is drawn.
 */

/** The mark of a word with one move, and of every word on a board that does not draw degree. */
export const NODE_R = 14;

/**
 * How steeply a mark grows with its word's moves: radius is `NODE_R * degree^CROWD`. At 0.5 a
 * mark's area is proportional to its moves; at 0.65 the busiest word (181 moves) is about 29
 * times a leaf's radius, 410 units. Only the map passes degree; `markRadius(1)` is `NODE_R`.
 */
const CROWD = 0.65;

/** The mark radius for a word with this many moves. */
export function markRadius(degree: number): number {
  return NODE_R * Math.max(degree, 1) ** CROWD;
}

/** A name's type size, and the width of one character of it (mono). */
export const LABEL_SIZE = 12.5;
export const LABEL_CHAR_W = 7.8;

/** Character width as a fraction of type size. */
const CHAR_RATIO = LABEL_CHAR_W / LABEL_SIZE;

/** The smallest size a name is set inside its mark; smaller than this, it goes beside. */
const LEAST_INSIDE = 9.5;

/** The margin a name inside its mark leaves, as a share of the mark's radius. */
const INSIDE_PAD = 0.2;

/**
 * The type size for a name set inside its own mark, or null if it goes beside the mark.
 *
 * Only a mark grown past `NODE_R` qualifies, so a board that does not draw degree never puts
 * names inside. The name is as large as fits: its width within the padded diameter and its size
 * within the padded radius, and at least `LEAST_INSIDE`.
 */
export function insideLabel(letters: number, radius: number): number | null {
  if (letters <= 0 || radius <= NODE_R) return null;
  const room = radius * (1 - INSIDE_PAD);
  const size = Math.min((2 * room) / (letters * CHAR_RATIO), room);
  return size >= LEAST_INSIDE ? size : null;
}

/**
 * How far along a move of length `span` its subword is written, from the near end: the middle
 * of the visible part between the two words' rooms (`near` and `far`, `reachOf` on the map).
 * With both 0 it is the plain midpoint. The plain midpoint beside a large mark would fall inside
 * that mark.
 */
export function labelAlong(span: number, near = 0, far = 0): number {
  return (near + (span - far)) / 2;
}

/**
 * The on-screen mark radius, in pixels, below which a name beside its mark is not drawn. Because
 * busier words have bigger marks, zooming out hides the leaves' names first: a leaf is named from
 * scale 0.43, the busiest word from about 0.015. Names inside a mark are always drawn.
 */
export const NAME_AT = 6;

/**
 * Whether a name beside its mark is drawn at `scale` pixels per unit. See `NAME_AT`. With no
 * scale, as on the daily board, always.
 */
export function showsName(degree: number, scale: number | undefined): boolean {
  return scale === undefined || markRadius(degree) * scale >= NAME_AT;
}

/** The gap between the top of a mark and the baseline of the name above it. */
export const LABEL_CLEAR = 8;

/** About how far a line of `LABEL_SIZE` reaches above its own baseline. */
export const LABEL_ASCENT = 9;
