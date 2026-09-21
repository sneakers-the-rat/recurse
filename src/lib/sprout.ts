/**
 * When each thing that has just arrived makes its entrance.
 *
 * A guess on an open map is not one word appearing. It is the word the player reached, the rim
 * of unnamed dots behind it, and every move joining any of them to the map — which for a hub is
 * a hundred and eighty things at once. Played on one frame that reads as a flicker; played on one
 * *schedule* it reads as a redraw. Neither is the thing that actually happened, which is that a
 * big guess opened up a large piece of the language, and **the size of what was opened is the
 * reward**. So an arrival is spread out over time in proportion to how much of it there is: two
 * new neighbours come out almost at once, twenty take ten times as long, and the player watches
 * a hub unfold instead of being handed one.
 *
 * Three things are scheduled and they are not independent:
 *
 * * **A word the player reached** comes out first, at no delay. It is the answer to what they
 *   typed and nothing should be in front of it.
 * * **A rim word** is delayed by a random share of a window that grows with the size of the
 *   arrival, and grows outward at its own speed. Both are jittered because a hub whose moves
 *   come out on an even beat reads as a machine drawing spokes; unevenly, it reads as something
 *   growing.
 * * **A move** waits until whichever of its two ends arrives last is `MOSTLY` of the way out.
 *   A line drawn to a word still on its way looks like the line was there first and the word
 *   slid down it; drawn at the end of the journey, the word gets where it is going and *then*
 *   reaches for what it found. That the edge arriving may shove the word further is fine — it is
 *   the same thing happening to a real graph.
 *
 * **Random, but the same random every time.** The jitter is a hash of the word rather than
 * `Math.random`, because the plate re-renders on every frame of the ooze and a fresh draw per
 * render would reshuffle the schedule sixty times a second. A hash also means a map replayed
 * from its log animates the way it did the first time.
 *
 * Pure, and tested in node. Nothing here knows about CSS, the layout or React: it answers *when*,
 * and `useAtlasLayout` and `AtlasPlate` each do their own half of *what*.
 */

/** When one thing comes out, and how long it takes. Milliseconds. */
export interface Entrance {
  delay: number;
  duration: number;
}

/** The whole of an arrival's timing: every word and every move in it. */
export interface Entrances {
  nodes: ReadonlyMap<string, Entrance>;
  /** Keyed `${a} ${b}`, the same key the figure's edges are drawn under. */
  edges: ReadonlyMap<string, Entrance>;
  /** When the last of it has finished, for whoever has to wait for the board to be still. */
  span: number;
}

export const NO_ENTRANCE: Entrances = { nodes: new Map(), edges: new Map(), span: 0 };

/**
 * How long a single arriving word may hold the queue up.
 *
 * The window a rim word's delay is drawn from is this times the number of words arriving, so a
 * guess onto a leaf is over in a moment and a guess onto a hub takes several seconds. Measured
 * by watching: below about seventy the big arrivals still read as a single event, and much above
 * a hundred and fifty a middling guess starts to feel like waiting.
 */
const PER_WORD = 110;

/**
 * The longest an arrival may take, however much of it there is.
 *
 * The busiest word in either graph has 181 moves, which at `PER_WORD` would be twenty seconds of
 * dots trickling in — long past the point where it is the reward for a big guess and well into
 * being a board that will not settle. The cap is the one number to turn if a big reveal feels
 * hurried.
 */
const MOST_SPREAD = 5200;

/** How long a word takes to grow out to its place, before jitter. */
const GROW_MS = 760;
/** How much that varies: a word takes between this share of `GROW_MS` and the rest above one. */
const GROW_JITTER = 0.45;

/** How long a move takes to draw itself along. */
const DRAW_MS = 520;
const DRAW_JITTER = 0.3;

/**
 * How far out a word has to be before the moves it found are drawn.
 *
 * Not all the way: an edge that waited for the word to stop would read as a separate event
 * rather than as the word arriving and connecting. Most of the way is where the two overlap
 * enough to be one gesture.
 */
const MOSTLY = 0.72;

/**
 * A number in `[0, 1)` from a word and a salt, for a jitter that is stable across renders.
 *
 * FNV-1a, which is four lines and spreads short strings well enough that two words differing in
 * one letter do not come out on the same beat. The salt is what gives one word two independent
 * draws — its delay and its speed — without hashing twice as much text.
 */
export function dice(word: string, salt: number): number {
  let hash = (0x811c9dc5 ^ salt) >>> 0;
  for (let i = 0; i < word.length; i++) {
    hash = Math.imul(hash ^ word.charCodeAt(i), 0x01000193) >>> 0;
  }
  // The top bits, which are the well-mixed ones.
  return (hash >>> 8) / 0x1000000;
}

/**
 * Schedule an arrival.
 *
 * `arriving` is every word new to the board — the ones reached and the rim behind them.
 * `reached` says which of those the player actually found, as against being drawn because
 * something next to them was found; those come out at once. `edges` is the figure's whole edge
 * list, which is where the keys come from.
 *
 * Returns nothing to schedule when nothing arrived, which is the common case: most renders are
 * a frame of an ooze rather than a guess.
 */
export function entrances(
  arriving: ReadonlySet<string>,
  reached: (word: string) => boolean,
  edges: readonly { a: string; b: string }[],
): Entrances {
  if (arriving.size === 0) return NO_ENTRANCE;

  const nodes = new Map<string, Entrance>();
  let rim = 0;
  for (const word of arriving) if (!reached(word)) rim += 1;
  const window = Math.min(rim * PER_WORD, MOST_SPREAD);

  let span = 0;
  for (const word of arriving) {
    const duration = GROW_MS * (GROW_JITTER + dice(word, 1) * (2 - 2 * GROW_JITTER));
    const delay = reached(word) ? 0 : dice(word, 2) * window;
    nodes.set(word, { delay, duration });
    span = Math.max(span, delay + duration);
  }

  /*
    A move comes out behind whichever of its ends arrives last. An end already on the board
    contributes nothing — it has been there all along — so a move between the word just reached
    and somewhere the player already knew is drawn as soon as that word is mostly out, which is
    what makes a big guess look like it *joined up* rather than merely appeared.
  */
  const drawn = new Map<string, Entrance>();
  for (const { a, b } of edges) {
    if (!arriving.has(a) && !arriving.has(b)) continue;
    const after = (word: string) => {
      const entrance = nodes.get(word);
      return entrance ? entrance.delay + entrance.duration * MOSTLY : 0;
    };
    const delay = Math.max(after(a), after(b));
    const key = `${a} ${b}`;
    const duration = DRAW_MS * (DRAW_JITTER + dice(key, 3) * (2 - 2 * DRAW_JITTER));
    drawn.set(key, { delay, duration });
    span = Math.max(span, delay + duration);
  }

  return { nodes, edges: drawn, span };
}
