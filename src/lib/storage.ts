/**
 * Remembering games across reloads.
 *
 * A daily word game is played on a phone, in bursts, between other things — the
 * page gets backgrounded, reloaded, returned to an hour later, and the browser
 * may throw the tab away in between. Losing a half-finished board to any of that
 * reads as the game being broken, so progress is written down after every move.
 *
 * Games are kept per *puzzle*, not one "current game", because the player moves
 * between puzzles: today's, one from the archive, whatever dev mode is pointed
 * at. Each keeps its own progress and gets it back on return.
 *
 * Two decisions worth knowing:
 *
 * - Keyed by the two words, not by the puzzle's index. The index is a position in
 *   a bank that gets rebuilt, so `?puzzle=40` is not the same puzzle from one
 *   rebuild to the next, and a stored game would be restored onto a board it has
 *   nothing to do with. The word pair is unique within a bank and means the same
 *   thing across rebuilds; a key that no longer matches anything simply ages out.
 *
 * - Nothing here may ever throw. `localStorage` is not always available — Safari
 *   in private browsing, an iframe with third-party storage blocked, a full quota
 *   — and in every one of those cases the right behaviour is to play the game
 *   without remembering it, not to fail to start.
 */

import type { GameSnapshot } from './game';
import type { Puzzle } from './types';

/**
 * Bumped when the stored shape changes, which retires every old entry at once.
 *
 * v2: hints stopped being a set of words and became a level per word, so a v1
 * entry's `hinted` array would restore as no hints at all — silently losing the
 * help someone had already paid for.
 *
 * Exported so the tests can reach the store the code actually uses: they used to
 * write `recurse.games.v1` by hand, and the bump left them poking at a key nothing
 * reads, still passing.
 */
export const KEY = 'recurse.games.v2';

/**
 * How many finished-or-abandoned games to keep. Enough that a week of play and a
 * browse through the archive all survive; small enough never to approach a quota.
 */
const KEEP = 30;

interface Entry {
  key: string;
  game: GameSnapshot;
}

/** The puzzle this game belongs to. Stable across a rebuild of the bank. */
export function gameKey(puzzle: Puzzle): string {
  return `${puzzle.source}>${puzzle.target}`;
}

function store(): Storage | null {
  try {
    // The access itself throws when storage is blocked, so it is inside the try.
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Most recently played first. Anything unrecognisable is treated as absent. */
function read(): Entry[] {
  const raw = store()?.getItem(KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is Entry =>
        typeof entry === 'object' && entry !== null && typeof entry.key === 'string' && !!entry.game,
    );
  } catch {
    return [];
  }
}

function write(entries: Entry[]): void {
  const target = store();
  if (!target) return;
  try {
    target.setItem(KEY, JSON.stringify(entries.slice(0, KEEP)));
  } catch {
    // Out of quota, or storage went away mid-session. The game plays on.
  }
}

export function loadGame(key: string): GameSnapshot | null {
  return read().find((entry) => entry.key === key)?.game ?? null;
}

/**
 * Write a game down, and make it the most recent.
 *
 * A `null` game forgets the key instead — which is what starting over does, and
 * it keeps untouched boards from evicting real progress just by being opened.
 */
export function saveGame(key: string, game: GameSnapshot | null): void {
  const stored = read();
  const rest = stored.filter((entry) => entry.key !== key);
  if (!game) {
    // Nothing stored and nothing to store: leave the store untouched, so merely
    // opening a board neither writes nor reorders anything.
    if (rest.length === stored.length) return;
    write(rest);
    return;
  }
  write([{ key, game }, ...rest]);
}
