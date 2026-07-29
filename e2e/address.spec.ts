/**
 * Addressing: which board a URL opens, and what the URL says once it has.
 *
 * This is the copy-and-paste path, so it is checked in a real browser against real
 * history: the whole promise is that whatever is in the address bar can be sent to
 * somebody and open the same board tomorrow, which no unit test can show.
 */

import { expect, test } from '@playwright/test';
import { board, boardOnDay, puzzleWithPar, today } from './fixtures';
import { dayNumber } from '../src/lib/daily';

/** The id in the address bar, whatever the base happens to be. */
const idInUrl = (url: string) => new URL(url).pathname.replace(/^\//, '').split('?')[0];

test('a bare visit rewrites itself to today’s puzzle', async ({ page }) => {
  const now = today();

  await page.goto('/');
  await expect(page.locator('header')).toContainText(now.puzzle.source);
  // The player arrived at `/` and now holds a link to the board in front of them.
  await expect.poll(() => idInUrl(page.url())).toBe(now.puzzle.id);

  // The rewrite replaces rather than pushes. Pushing would leave `/` behind in the
  // history, so the back button would land there, rewrite again, and the player
  // could never get out of the game — so back must not return to the root.
  await page.goBack();
  expect(new URL(page.url()).pathname).not.toBe('/');
});

test('an id opens that board, whatever day it is', async ({ page }) => {
  // The point of the scheme: a board that is not today's is still reachable, so a
  // link shared on Tuesday still works on Friday.
  const { puzzle } = puzzleWithPar(4);
  await page.goto(board(puzzle));
  await expect(page.locator('header')).toContainText(puzzle.source);
  await expect(page.locator('header')).toContainText(puzzle.target);
  expect(idInUrl(page.url())).toBe(puzzle.id);
});

test('an id that no longer exists falls back to today and says so', async ({ page }) => {
  const now = today();

  // What a link shared before a rebuild looks like: eight hex digits, no puzzle. And note
  // which shard those digits name — 0xde — because that is the shard the app fetches for
  // them, and it holds neither this id nor today's board. Falling back therefore takes a
  // second fetch, and for a while it did not happen at all: the board that no longer exists
  // put the game on an error page, which is the one case the whole scheme is for.
  await page.goto('/deadbeef');
  await expect(page.locator('header')).toContainText(now.puzzle.source);
  // The URL is corrected rather than left lying: reloading must not go looking for
  // the dead id again.
  await expect.poll(() => idInUrl(page.url())).toBe(now.puzzle.id);
});

test('stepping the bank in dev mode moves through history by id', async ({ page }) => {
  // Consecutive days, which are deliberately consecutive *shards* — so this walks the same
  // ground a player never does and the app has to fetch for: see `boardOnDay`.
  const here = today();
  const next = boardOnDay(dayNumber() + 1);

  await page.goto(board(here.puzzle, '?dev'));
  expect(idInUrl(page.url())).toBe(here.puzzle.id);

  await page.getByLabel('Next puzzle').click();
  await expect.poll(() => idInUrl(page.url())).toBe(next.puzzle.id);
  await expect(page.locator('header')).toContainText(next.puzzle.source);
  // `?dev` survives the step, or stepping would turn the instrument panel off.
  expect(page.url()).toContain('dev');

  const after = boardOnDay(dayNumber() + 2);
  await page.getByLabel('Next puzzle').click();
  await expect.poll(() => idInUrl(page.url())).toBe(after.puzzle.id);

  // Stepping is navigation, so the back button undoes it — one board at a time, and each of
  // them in a shard of its own. This step is the one that was broken: going back to a board
  // outside the shard the session opened with was resolved against that shard alone, so the
  // id in the path named nothing, and the game quietly showed today instead of the board
  // whose address was in the URL.
  await page.goBack();
  await expect.poll(() => idInUrl(page.url())).toBe(next.puzzle.id);
  await expect(page.locator('header')).toContainText(next.puzzle.source);

  await page.goBack();
  await expect.poll(() => idInUrl(page.url())).toBe(here.puzzle.id);
  await expect(page.locator('header')).toContainText(here.puzzle.source);
});
