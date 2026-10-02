/**
 * When each word and move of an arrival comes out, and how fast.
 *
 * The arrival is spread over a window that grows with its size, so a guess onto a hub unfolds
 * over seconds and one onto a leaf is over at once. Words the player reached come out at once,
 * rim words at a random delay, and a move once both its ends are `MOSTLY` out. Jitter is hashed
 * from the word, so the schedule is stable across renders and replays.
 *
 * Drives both the ooze in `useAtlasLayout` and `.sprout`/`.reach` in index.css.
 */

/** When one thing comes out, and how long it takes. Milliseconds. */
export interface Entrance {
  delay: number;
  duration: number;
}

export interface Entrances {
  nodes: ReadonlyMap<string, Entrance>;
  /** Keyed `${a} ${b}`, as the figure's edges are. */
  edges: ReadonlyMap<string, Entrance>;
  /** When the last of it has finished. */
  span: number;
}

export const NO_ENTRANCE: Entrances = { nodes: new Map(), edges: new Map(), span: 0 };

/** The window rim words' delays are drawn from, per rim word. Tuned by eye. */
const PER_WORD = 110;

/** Cap on that window. The busiest word has ~180 moves. */
const MOST_SPREAD = 5200;

/** How long a found word takes to surface (`.surface` in index.css), which rim words wait for. */
const SURFACE_MS = 300;

const GROW_MS = 760;
/** A word grows in between `GROW_JITTER` and `2 - GROW_JITTER` times `GROW_MS`. */
const GROW_JITTER = 0.45;

const DRAW_MS = 520;
const DRAW_JITTER = 0.3;
/** Spread of the moves out of one word, so they are not all drawn on one frame. */
export const REACH_SPREAD = 420;

/** How far out a word is before its moves start drawing. */
const MOSTLY = 0.72;

/** FNV-1a of a word and a salt, in `[0, 1)`. The salt gives one word independent draws. */
export function dice(word: string, salt: number): number {
  let hash = (0x811c9dc5 ^ salt) >>> 0;
  for (let i = 0; i < word.length; i++) {
    hash = Math.imul(hash ^ word.charCodeAt(i), 0x01000193) >>> 0;
  }
  // The top bits, which are the well-mixed ones.
  return (hash >>> 8) / 0x1000000;
}

/**
 * Schedule an arrival. `arriving` is every word new to the board, `reached` says which of them
 * the player found (rather than being rim), and `edges` is the figure's whole edge list.
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
    const delay = reached(word) ? 0 : SURFACE_MS + dice(word, 2) * window;
    nodes.set(word, { delay, duration });
    span = Math.max(span, delay + duration);
  }

  // A move waits for whichever end arrives last; an end already on the board doesn't count.
  const drawn = new Map<string, Entrance>();
  for (const { a, b } of edges) {
    if (!arriving.has(a) && !arriving.has(b)) continue;
    const after = (word: string) => {
      const entrance = nodes.get(word);
      return entrance ? entrance.delay + entrance.duration * MOSTLY : 0;
    };
    const key = `${a} ${b}`;
    const delay = Math.max(after(a), after(b)) + dice(key, 4) * REACH_SPREAD;
    const duration = DRAW_MS * (DRAW_JITTER + dice(key, 3) * (2 - 2 * DRAW_JITTER));
    drawn.set(key, { delay, duration });
    span = Math.max(span, delay + duration);
  }

  return { nodes, edges: drawn, span };
}
