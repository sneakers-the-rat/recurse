/**
 * Real puzzles and their real answers, derived rather than written down.
 *
 * These read the shipped data from disk (see src/test/shipped.ts) and reason
 * about it with the same library the game uses, so a test knows the answer to a
 * real puzzle without hard-coding words that a data rebuild would invalidate.
 */

import type { Locator, Page } from '@playwright/test';
import { shortestPath, shortestPathNodes } from '../src/lib/graph';
import { DEFAULT_BAND, shippedData, shippedShard } from '../src/test/shipped';
import { bandOf, shardForDay } from '../src/lib/data';
import { dayIndex, dayNumber, puzzleForDay, type DailyPuzzle } from '../src/lib/daily';
import { pathFor } from '../src/lib/route';
import type { Puzzle } from '../src/lib/types';

export const gameData = shippedData;

/**
 * The board a day falls on in one of the three lengths, from the shard that band and day name.
 *
 * Consecutive days are deliberately in different shards — band `B` on day `N` is in shard
 * `(N * 3 + B) % 256`, which is what lets any board be reached with one fetch and no index —
 * so "the next puzzle" is not the next entry of anything in memory. A test that steps the
 * calendar has to read the shard the app will read, which is what this is for: taking one
 * shard's array order for calendar order is how the stepping test came to expect an id from
 * the wrong shard entirely.
 *
 * Each band wraps into its own calendar, so any day names a board in every band.
 */
export function boardOnDay(day: number, band: number = DEFAULT_BAND): DailyPuzzle {
  const { manifest } = gameData();
  const days = bandOf(band, manifest).days;
  const wanted = dayIndex(day, days);
  const found = puzzleForDay(
    shippedShard(shardForDay(band, wanted, manifest)),
    band,
    wanted,
    days,
  );
  if (!found) throw new Error(`no puzzle on day ${wanted} in band ${band}: the shards disagree`);
  return found;
}

/** Today's board, in the length a bare visit opens: short. */
export function today(band: number = DEFAULT_BAND): DailyPuzzle {
  return boardOnDay(dayNumber(), band);
}

/**
 * The finished round's verdict and score.
 *
 * Asked for by name, because the finished round is in two places now — the result above
 * the board and the move list below it — and it used to be found with
 * `locator('section').last()`, which quietly started pointing at the move list the day
 * that happened. A test that means "the result" should say so.
 */
export function result(page: Page) {
  return page.getByRole('region', { name: 'Result' });
}

/**
 * The first thing matching `selector` that is actually in shot.
 *
 * The board is deliberately larger than the plate — the words are drawn at a readable size
 * and the surplus runs off the edges to be dragged into view (see camera.ts) — so "the
 * first word on the board" and "a word you can click" are different questions. Playwright
 * will not click something outside the viewport, and it cannot scroll to it either, because
 * the plate is not a scroller: the way to reach that word is to pan the camera.
 *
 * So a test that wants to tap a word has to ask for one that is there to be tapped. Taking
 * `.first()` and hoping is what these did, and it depended on where in the alphabet the
 * outermost word happened to fall — one spec had been failing that lottery for a while
 * before the words were made bigger and most of the others started losing it too.
 */
export async function inShot(page: Page, selector: string): Promise<Locator> {
  const all = page.locator(selector);
  await all.first().waitFor();
  const plate = await page.locator('main').boundingBox();
  if (!plate) throw new Error('the plate has no box');

  const count = await all.count();
  for (let i = 0; i < count; i++) {
    const one = all.nth(i);
    const box = await one.boundingBox();
    if (!box) continue;
    if (
      box.x >= plate.x &&
      box.y >= plate.y &&
      box.x + box.width <= plate.x + plate.width &&
      box.y + box.height <= plate.y + plate.height
    ) {
      return one;
    }
  }
  throw new Error(`nothing matching ${selector} is in shot on this board`);
}

/**
 * The URL a board is played at.
 *
 * A puzzle is addressed by its id and nothing else — there is no `?puzzle=N`, so a
 * test opens the same URL a player would be sent. `search` is for the flags that
 * are not about *which* puzzle: `?dev`, `?dev=0`.
 *
 * Built with the app's own `pathFor`, at the dev server's base, so a test cannot
 * navigate somewhere the app would not.
 */
export function board(puzzle: Puzzle, search: string = ''): string {
  return pathFor(puzzle.id, search, '/');
}

export interface SolvedPuzzle {
  puzzle: Puzzle;
  /** Source first, target last. Length is par + 1. */
  path: string[];
  /**
   * A legal move from the source that is *not* on any shortest path — a real
   * wrong turn, as opposed to revisiting a word already found (which is free).
   */
  wrongTurn: string;
}

/**
 * A puzzle of the given par, with a shortest path and a genuine wrong turn.
 *
 * Both are derived from the shipped data using the game's own library, so tests
 * never hard-code words that a data rebuild would invalidate.
 *
 * Puzzles with a secret are skipped: their shortest path is shorter than par, so
 * walking it scores under par and the round ends in the secret state rather than
 * the ordinary one. `puzzleWithSecret` is for testing that.
 */
export function puzzleWithPar(par: number): SolvedPuzzle {
  const { graph, puzzles } = gameData();
  for (const puzzle of puzzles) {
    if (puzzle.par !== par || puzzle.secret !== 0) continue;
    const path = shortestPath(graph, puzzle.source, puzzle.target);
    if (!path || path.length !== par + 1) continue;
    const onRoute = shortestPathNodes(graph, puzzle.source, puzzle.target, par);
    const wrongTurn = graph.neighbors(puzzle.source).find((w) => !onRoute.has(w));
    if (wrongTurn) return { puzzle, path, wrongTurn };
  }
  throw new Error(`no puzzle with par ${par} and a wrong turn available`);
}

/** A puzzle par can be beaten on, with the route that beats it. */
export function puzzleWithSecret(): { puzzle: Puzzle; path: string[] } {
  const { graph, puzzles } = gameData();
  for (const puzzle of puzzles) {
    if (puzzle.secret === 0) continue;
    const path = shortestPath(graph, puzzle.source, puzzle.target);
    if (path && path.length - 1 === puzzle.secret) return { puzzle, path };
  }
  throw new Error('no puzzle with a secret available');
}
