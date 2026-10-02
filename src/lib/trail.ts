/**
 * Where the player has stood, for back and next like a browser's history. Part of each game's
 * state (`GameState.stood`, `Atlas.stood`), so it is saved with the game. Standing somewhere new
 * from part way back drops whatever was ahead.
 */

export interface Trail {
  words: readonly string[];
  /** Which of `words` is stood on now. */
  at: number;
}

/** The most steps kept. */
const KEPT = 200;

export function startTrail(word: string): Trail {
  return { words: [word], at: 0 };
}

/** The trail after standing on `word`. Unchanged if it is already where the trail stands. */
export function stand(trail: Trail, word: string): Trail {
  if (trail.words[trail.at] === word) return trail;
  const words = [...trail.words.slice(0, trail.at + 1), word].slice(-KEPT);
  return { words, at: words.length - 1 };
}

/** One step back, or null at the start. */
export function back(trail: Trail): Trail | null {
  return trail.at > 0 ? { ...trail, at: trail.at - 1 } : null;
}

/** One step forward again, or null if nothing is ahead. */
export function ahead(trail: Trail): Trail | null {
  return trail.at < trail.words.length - 1 ? { ...trail, at: trail.at + 1 } : null;
}

export type Way = 'back' | 'next';

/** Stand one step back or forward along the trail. The same state if there is no such step. */
export function walk<S extends { selected: string; stood: Trail }>(state: S, way: Way): S {
  const next = way === 'back' ? back(state.stood) : ahead(state.stood);
  if (!next) return state;
  return { ...state, stood: next, selected: next.words[next.at]! };
}

/**
 * Read a trail back from a save, keeping only words that can still be stood on and ending where
 * the game stands. Anything malformed or missing is a fresh trail.
 */
export function readTrail(
  saved: unknown,
  canStand: (word: string) => boolean,
  selected: string,
): Trail {
  const one = saved as { words?: unknown; at?: unknown } | null | undefined;
  const words: string[] = [];
  let at = -1;
  const given = Array.isArray(one?.words) ? one.words : [];
  const wanted = Number.isFinite(one?.at) ? Math.trunc(one!.at as number) : given.length - 1;
  given.forEach((word, index) => {
    if (typeof word !== 'string' || !canStand(word)) return;
    // Dropping a word can leave two of the same side by side, which is one step.
    if (words[words.length - 1] !== word) words.push(word);
    if (index <= wanted) at = words.length - 1;
  });
  if (words.length === 0) return startTrail(selected);
  const drop = Math.max(0, words.length - KEPT);
  const trail = { words: words.slice(drop), at: Math.max(at, drop) - drop };
  return trail.words[trail.at] === selected ? trail : stand(trail, selected);
}
