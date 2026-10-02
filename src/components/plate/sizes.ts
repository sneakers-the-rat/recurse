/**
 * Sizes only the plate needs. Sizes the layout must also know are in lib/sizes.ts.
 */

export { LABEL_SIZE, NODE_R } from '../../lib/sizes';
import { NODE_R } from '../../lib/sizes';

/** Radius of a word that is on the board but unnamed. */
export const DOT_R = 4.5;

/**
 * How far from a word's centre still counts as pointing at it. Wider than the mark, so reaches
 * overlap; `nearest` in usePointing.ts picks between them.
 */
export const REACH = NODE_R + 8;

/** Longest tick drawn for a move that leads off the board. */
export const SPUR_LEN = 9;

/** Most ticks drawn, however many moves lead away. */
export const SPUR_SHOWN_MAX = 8;

/**
 * How far along the line from its word a move's given-away sign sits: past the word's ring and
 * the sign's halo. It stays on the line so it is unambiguous which move it belongs to.
 */
export const MARK_ALONG = NODE_R + 12;
