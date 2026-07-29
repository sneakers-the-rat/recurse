/**
 * Addressing: which board a URL opens, and what the URL says once it has.
 *
 * This is the copy-and-paste path, so it is checked in a real browser against real
 * history: the whole promise is that whatever is in the address bar can be sent to
 * somebody and open the same board tomorrow, which no unit test can show.
 */

import { expect, test } from '@playwright/test';
import { board, gameData, puzzleWithPar } from './fixtures';
import { dayNumber, puzzleForDay } from '../src/lib/daily';

/** The id in the address bar, whatever the base happens to be. */
const idInUrl = (url: string) => new URL(url).pathname.replace(/^\//, '').split('?')[0];

test('a bare visit rewrites itself to today’s puzzle', async ({ page }) => {
  const { puzzles, manifest } = gameData();
  const today = puzzleForDay(puzzles, dayNumber(), manifest.days)!;

  await page.goto('/');
  await expect(page.locator('header')).toContainText(today.puzzle.source);
  // The player arrived at `/` and now holds a link to the board in front of them.
  await expect.poll(() => idInUrl(page.url())).toBe(today.puzzle.id);

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
  const { puzzles, manifest } = gameData();
  const today = puzzleForDay(puzzles, dayNumber(), manifest.days)!;

  // What a link shared before a rebuild looks like. Eight hex digits, no puzzle.
  await page.goto('/deadbeef');
  await expect(page.locator('header')).toContainText(today.puzzle.source);
  // The URL is corrected rather than left lying: reloading must not go looking for
  // the dead id again.
  await expect.poll(() => idInUrl(page.url())).toBe(today.puzzle.id);
});

test('stepping the bank in dev mode moves through history by id', async ({ page }) => {
  const { puzzles } = gameData();
  await page.goto(board(puzzles[0]!, '?dev'));
  expect(idInUrl(page.url())).toBe(puzzles[0]!.id);

  await page.getByLabel('Next puzzle').click();
  await expect.poll(() => idInUrl(page.url())).toBe(puzzles[1]!.id);
  await expect(page.locator('header')).toContainText(puzzles[1]!.source);
  // `?dev` survives the step, or stepping would turn the instrument panel off.
  expect(page.url()).toContain('dev');

  // Stepping is navigation, so the back button undoes it.
  await page.goBack();
  await expect.poll(() => idInUrl(page.url())).toBe(puzzles[0]!.id);
  await expect(page.locator('header')).toContainText(puzzles[0]!.source);
});
