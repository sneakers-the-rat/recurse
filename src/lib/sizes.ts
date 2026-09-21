/**
 * How big a word is drawn, in graph units.
 *
 * Two things need these and they have to agree. The plate obeys them — a mark is this radius,
 * a name is set at this size, this far clear of it. The *layout* has to know them in advance,
 * because deciding where a word goes means knowing how much room it will take before anything
 * is drawn (see `boxOf` in forces.ts).
 *
 * They were written down twice, and the comment on the second copy said so. A face changed or
 * a mark resized in one place and not the other does not fail: it leaves the layout quietly
 * arranging boxes that are not the size of the words in them, which shows up as labels
 * overlapping on a board that the overlap tests say is fine.
 */

/** A word the player has named, with one move out of it: its mark. */
export const NODE_R = 14;

/**
 * How much of a mark a move is worth, when a board draws degree at all.
 *
 * **Area and not radius**, so the ink is proportional to the moves: a word with four of them
 * is four times the mark of a word with one, and reads as four times as busy. Radius would
 * make it sixteen times and the hubs would eat the map.
 *
 * **`CROWD` is the curve on top of that, and it is the one number to turn.** A leaf is always
 * `NODE_R`; this decides how much bigger than a leaf the busiest word in the graph — 181 moves —
 * comes out. Some readings of it:
 *
 *     0.28   2.8x a leaf     the range flattened: the order is legible, the magnitude is not
 *     0.5    13x             pure area, so the ink is exactly proportional to the moves
 *     0.56   18x             past area: a hub is a planet and its own moves land inside it
 *     1.0    181x            radius, which is absurd — the hubs eat the map
 *
 * At `0.28` the busiest word was 55 units against a leaf's 14, which reads as "somewhat busier"
 * rather than as a hub — a word with dozens of moves looked two or three times a word with two.
 * Past a half the disc is large enough that the *midpoints of its own moves fall inside it* and
 * every subword it has is written across its face, and the collider then holds its neighbours
 * off at its own rim rather than at a move's length. That is the trade this number is: how much
 * of the map a hub is allowed to be.
 *
 * **Only a board that asks for it pays any of this.** The daily figure passes no degree, and
 * `markRadius(1)` is `NODE_R` at every value of `CROWD`.
 */
const CROWD = 0.56;

/**
 * The mark a word with this many moves is drawn at.
 *
 * One move is `NODE_R`, which is what every word was before this and is what the daily board
 * still passes — so a board that does not care about degree gets exactly the mark it had.
 */
export function markRadius(degree: number): number {
  return NODE_R * Math.max(degree, 1) ** CROWD;
}

/** The type a name is set in, and what one character of it measures. */
export const LABEL_SIZE = 12.5;
export const LABEL_CHAR_W = 7.8;

/** How wide a character is as a fraction of the size it is set at. Mono, so one number. */
const CHAR_RATIO = LABEL_CHAR_W / LABEL_SIZE;

/**
 * Smallest a name may be set and still be a name. Below this the mark should keep it outside,
 * where it has the whole plate to be wide in rather than a chord.
 */
const LEAST_INSIDE = 9.5;

/**
 * Largest a name may be set, however much room its own mark has.
 *
 * The type grows with the disc so that a big place reads as one, and left to fill the disc it
 * stops saying that and starts shouting: a four-letter hub on a map of a hundred words came out
 * at 47 units, four times every other word on the board and larger than the heading over it.
 * Twice the ordinary label is as far as "this is a big place" needs to go; past that the size
 * of the *mark* is already saying it.
 */
const MOST_INSIDE = LABEL_SIZE * 2;

/**
 * The size a name is set at *inside* its own mark, or nothing if it will not go.
 *
 * A word with a great many moves is drawn as a large disc, and a large disc with its name
 * hanging above it is two things where there should be one — the name floats clear of the
 * thing it names, and on a crowded map it floats over whatever is above. Once the disc is big
 * enough to hold the word, the word goes in it, and the type grows with the disc: the mark
 * then reads as a labelled place rather than as a blob with a caption.
 *
 * **Only a mark that has grown, which is the first thing asked.** An ordinary mark holds two or
 * three letters at a squeeze, so without this a board that does not draw degree at all — the
 * daily one — would write its short words inside their marks and its long ones above them, for
 * no reason a player could see, and the layout would reserve room beside some names and not
 * others. Nothing about the daily figure was meant to move in any of this.
 *
 * Whether it goes is then a chord and a height. The name has to fit across the middle of the
 * circle with air either side, and be no taller than the circle can carry — and be big enough
 * to read, which is the case that sends most words back outside.
 */
export function insideLabel(letters: number, radius: number): number | null {
  if (letters <= 0 || radius <= NODE_R) return null;
  // Across the middle, at four fifths of the diameter so the ends stay off the curve.
  const across = (2 * radius * 0.8) / (letters * CHAR_RATIO);
  const size = Math.min(across, radius * 0.9, MOST_INSIDE);
  return size >= LEAST_INSIDE ? size : null;
}

/** Air between the top of a mark and the baseline of the name standing above it. */
export const LABEL_CLEAR = 8;

/** About how far a line of `LABEL_SIZE` reaches above its own baseline. */
export const LABEL_ASCENT = 9;
