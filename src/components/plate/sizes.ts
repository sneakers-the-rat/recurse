/**
 * Geometry the plate draws with, beyond what the layout also needs.
 *
 * The sizes a *layout* has to agree about are in lib/sizes.ts — a mark's radius, the type a
 * name is set in — because where a word goes depends on how much room it takes. These are the
 * rest: how near counts as pointing at something, how long a tick is, where a sign sits. They
 * are nobody's business but the plate's.
 */

export { LABEL_SIZE, NODE_R } from '../../lib/sizes';
import { NODE_R } from '../../lib/sizes';

/** A word that is on the board but unnamed: present, not competing. */
export const DOT_R = 4.5;

/**
 * How far from a word's mark still counts as pointing at it.
 *
 * Wider than the mark, because a dot is four units across and a thumb is not, and a sparse
 * board should not have to be aimed at. Which means the reaches *overlap* wherever two words
 * are close, and that is what `nearest` is for: an SVG gives the event to whichever shape was
 * drawn last, so on a crowded board the word that lit up was the later one in the node list
 * and not the one under the pointer. The reach stays generous; the nearest word wins it.
 */
export const REACH = NODE_R + 8;

/** Longest tick drawn for a move that leads off the board. */
export const SPUR_LEN = 9;

/** Widest fan drawn, however many moves lead away. */
export const SPUR_SHOWN_MAX = 8;

/**
 * How far along the line a move's given-away sign sits, measured from the word it is about.
 * Enough to clear that word's own ring and the sign's halo.
 *
 * The sign is placed *along* the line and nowhere else — no perpendicular offset. Offsetting it
 * to one side was tried and reads as belonging to nothing: several moves leave the same word, so
 * a sign floating between two lines can sit nearer the one it says nothing about. On the line and
 * near its own end, a sign has exactly one edge and one word it can be about.
 */
export const MARK_ALONG = NODE_R + 12;
