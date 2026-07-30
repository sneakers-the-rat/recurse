/**
 * The three lengths a day offers, and the switch between them.
 *
 * In a browser because that is where the claims live: the switch is real navigation, the URL
 * has to keep naming the board on screen, and each length keeps its own progress. The band is
 * deliberately *not* in the URL — a board is addressed by its id and nothing else — so the
 * only way to check that the switch works is to work it.
 */

import { expect, test } from '@playwright/test';
import { board, boardOnDay, gameData, today, todayNumber } from './fixtures';
import { shortestPath } from '../src/lib/graph';

/** The id in the address bar, whatever the base happens to be. */
const idInUrl = (url: string) => new URL(url).pathname.replace(/^\//, '').split('?')[0];

const current = (page: import('@playwright/test').Page) =>
  page.locator('nav[aria-label="Choose a length"] button[aria-current="page"]');

test('a bare visit opens the short board, and says so', async ({ page }) => {
  const { manifest } = gameData();
  const short = today(0);

  await page.goto('/');
  await expect(page.locator('header')).toContainText(short.puzzle.source);
  await expect.poll(() => idInUrl(page.url())).toBe(short.puzzle.id);

  // The switch says which length is on screen and what each one holds — a name alone is a
  // promise the player has no way to check.
  await expect(current(page)).toContainText(manifest.bands[0]!.name);
  await expect(current(page)).toContainText(`par ${manifest.bands[0]!.minPar}`);
});

test('switching length keeps the day and lands on that board', async ({ page }) => {
  const { manifest } = gameData();
  await page.goto('/');
  await expect(page.locator('main svg circle').first()).toBeVisible();

  for (const band of [1, 2]) {
    const wanted = boardOnDay(todayNumber(), band);
    await page.getByRole('button', { name: new RegExp(`^${manifest.bands[band]!.name}`) }).click();

    // The board changes, and so does the address: the URL always names what is on screen.
    await expect(page.locator('header')).toContainText(wanted.puzzle.source);
    await expect.poll(() => idInUrl(page.url())).toBe(wanted.puzzle.id);
    await expect(current(page)).toContainText(manifest.bands[band]!.name);
    // And it is genuinely a board of that length.
    expect(wanted.puzzle.par).toBeGreaterThanOrEqual(manifest.bands[band]!.minPar);
    expect(wanted.puzzle.par).toBeLessThanOrEqual(manifest.bands[band]!.maxPar);
  }

  // Switching is navigation, so the back button undoes it one length at a time.
  await page.goBack();
  await expect.poll(() => idInUrl(page.url())).toBe(boardOnDay(todayNumber(), 1).puzzle.id);
});

test('a link opens its own length, whatever the switch was left on', async ({ page }) => {
  // The id is the whole address. A long board sent to somebody who last played short opens
  // long, and the switch follows the board rather than the other way round.
  const { manifest } = gameData();
  const long = boardOnDay(todayNumber(), 2);

  await page.goto('/');
  await expect(page.locator('main svg circle').first()).toBeVisible();
  await page.goto(board(long.puzzle));

  await expect(page.locator('header')).toContainText(long.puzzle.source);
  await expect(current(page)).toContainText(manifest.bands[2]!.name);
});

test('the day’s other lengths are offered once a round is finished', async ({ page }) => {
  const { graph, manifest } = gameData();
  const short = today(0);

  // The answer through ordinary words, which is what par counts — walked, so the round ends
  // the way an ordinary one does.
  const route = shortestPath(
    graph,
    short.puzzle.source,
    short.puzzle.target,
    graph.commonNeighbors,
  );
  expect(route).not.toBeNull();

  await page.goto(board(short.puzzle));
  await expect(page.locator('main svg circle').first()).toBeVisible();
  for (const word of route!.slice(1)) {
    await page.getByLabel(/Your guess/).fill(word);
    await page.getByRole('button', { name: 'Name it' }).click();
  }
  const result = page.getByRole('region', { name: 'Result' });
  await expect(result).toBeVisible();

  // Both other lengths, because neither has been played. A solved one would not be listed:
  // the row is an invitation, not a menu.
  await expect(result).toContainText('Also today');
  for (const band of [1, 2]) {
    await expect(result).toContainText(manifest.bands[band]!.name);
  }

  // And taking the offer opens that board.
  const medium = boardOnDay(todayNumber(), 1);
  await result.getByRole('button', { name: new RegExp(`^${manifest.bands[1]!.name}`) }).click();
  await expect(page.locator('header')).toContainText(medium.puzzle.source);
});
