/**
 * Real puzzles and their real answers, derived rather than written down.
 *
 * These read the shipped data from disk (see src/test/shipped.ts) and reason
 * about it with the same library the game uses, so a test knows the answer to a
 * real puzzle without hard-coding words that a data rebuild would invalidate.
 */

import type { Locator, Page } from '@playwright/test';
import { shortestPath, shortestPathNodes } from '../src/lib/graph';
import {
  DEFAULT_BAND,
  shippedData,
  shippedIdForDay,
  shippedRedirects,
  shippedShard,
} from '../src/test/shipped';
import { shardOf } from '../src/lib/data';
import { dayIndex, dayNumber, type DailyPuzzle } from '../src/lib/daily';
import { pathFor } from '../src/lib/route';
import type { Puzzle } from '../src/lib/types';

export const gameData = shippedData;

/**
 * Take one of the masthead menus — the archive, the stats, or the rules.
 *
 * A phone keeps them behind the hamburger and a wider screen writes them out, and both are
 * in the DOM at every width — so which one a test can click is a question about the
 * viewport. Every spec that leaves the board goes through here rather than clicking a name
 * that exists twice.
 *
 * Behind the hamburger they are `menuitem`s and written out they are buttons, which is the
 * accessibility tree saying the same thing: one is a menu and the other is a row of links.
 */
export async function masthead(
  page: Page,
  name: 'Puzzles' | 'Stats' | 'Tutorial' | 'How to play',
) {
  // Which shape the masthead is in cannot be asked until there is one: `isVisible` answers
  // now rather than waiting, so on a page still loading it said "not folded" and then spent
  // the whole timeout waiting for a written-out menu that a phone never shows.
  await page.locator('header').waitFor();

  const hamburger = page.getByRole('button', { name: 'Menu' });
  const folded = await hamburger.isVisible();
  if (folded) await hamburger.click();
  await page.getByRole(folded ? 'menuitem' : 'button', { name, exact: true }).click();
}

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
 * Every band fills every day, so any day names a board in every band.
 */
export function boardOnDay(day: number, band: number = DEFAULT_BAND): DailyPuzzle {
  const { manifest } = gameData();
  const wanted = dayIndex(day, manifest.days);
  const id = shippedIdForDay(band, wanted);
  const puzzle = id === null ? undefined : shippedShard(shardOf(id)).find((p) => p.id === id);
  if (!puzzle) {
    throw new Error(`no puzzle on day ${wanted} in band ${band}: the calendar and shards disagree`);
  }
  return { puzzle, day: wanted };
}

/**
 * Today, as the app counts it.
 *
 * From the **manifest's** epoch, never the `EPOCH` constant in daily.ts. That constant is only a
 * fallback for arithmetic tests; the data ships its own, and the two are not the same date. When
 * these read the constant instead, every fixture about "today" was off by the difference and
 * four specs failed at once with the wrong board rather than a wrong-looking one.
 */
export function todayNumber(): number {
  return dayNumber(new Date(), gameData().manifest.epoch);
}

/** Today's board, in the length a bare visit opens: short. */
export function today(band: number = DEFAULT_BAND): DailyPuzzle {
  return boardOnDay(todayNumber(), band);
}

/**
 * A board that has changed address, as `{ was, puzzle }` — or null when none has.
 *
 * Read out of the shipped redirects rather than made up, because the point is the deploy: a
 * link somebody sent before the word list was curated, and the board it opens now. Null when
 * no mode declares a `wasVocab`, which is a bank that has only ever had one vocabulary and has
 * nothing to forward — the test skips rather than inventing an id, since an invented one would
 * only re-test the fallback to today.
 *
 * **Of `DEFAULT_BAND`'s game**, because a caller is going to look for these two words on the
 * screen. A puzzle stores its endpoints as *tokens* of its own alphabet, and in the phonemes
 * game a token is a pronunciation — so the first redirect in the file is as likely as not to
 * be a board whose header says `forgives` about a puzzle whose `source` is a run of phoneme
 * codes. See `lexicon.ts`.
 */
export function boardThatMoved(): { was: string; puzzle: Puzzle } | null {
  const { manifest } = gameData();
  const mode = manifest.bands[DEFAULT_BAND]?.mode ?? 0;
  for (const { was, now } of shippedRedirects()) {
    const puzzle = shippedShard(shardOf(now)).find((one) => one.id === now);
    if (puzzle && manifest.bands[puzzle.band]?.mode === mode) return { was, puzzle };
  }
  return null;
}

/**
 * The same shared round, written against some other word list.
 *
 * **Made here rather than kept as a string**, because what makes a code stale is the *current*
 * data moving: a fixture written down today would stop being stale at the next rebuild, or
 * start being something else entirely. So a real code is taken and its stamp is moved off the
 * one this build wrote.
 *
 * One bit, and a bit of the stamp rather than of anything after it, so what comes back is a
 * whole readable code that merely disagrees about which words it means — which is the case
 * worth a test, and the one the player cannot see for themselves. See `STAMP_BITS`.
 */
export function staleVersionOf(link: string): string {
  // Base64url, spelled out here rather than reached for out of boardCode.ts: this is a test
  // taking a wire format apart on purpose, and it should break if the alphabet moves.
  const digits = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const code = link.split('/').pop()!;
  // The stamp is the twelve bits after the three-bit version, so its last bit is bit 14.
  const [at, bit] = [Math.floor(14 / 6), 5 - (14 % 6)];
  const flipped = digits.indexOf(code[at]!) ^ (1 << bit);
  return code.slice(0, at) + digits[flipped]! + code.slice(at + 1);
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
 * One figure out of the header's tally: `par`, `shortcuts`, `guessed` or `hints`.
 *
 * **The number, not the phrase around it.** These used to be read by matching the whole header
 * against a string — `toContainText('1 guessed')` — which is an assertion about the *wording of
 * a message*, and it broke as soon as the line became a table with the label on its own edge.
 * What a spec about playing actually means is "the guess count is 1", so that is what this
 * says, against a handle that is not language: `data-tally` in Header.tsx.
 *
 * A row absent at zero — hints and shortcuts both are — has no element at all, which
 * `toHaveCount(0)` is the way to assert.
 */
export function tally(page: Page, name: 'par' | 'shortcuts' | 'guessed' | 'hints') {
  return page.locator(`[data-tally="${name}"]`);
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
