/**
 * The opening: a look at the whole puzzle, then a close on the answer.
 *
 * The only spec that asks for motion — everything else runs with reduced-motion set,
 * which is both a real player's setting and what keeps the suite from sitting through
 * the title ninety times. See playwright.config.ts.
 */

import { expect, test, type Page } from '@playwright/test';
import { board, gameData, puzzleWithPar } from './fixtures';

test.use({ contextOptions: { reducedMotion: 'no-preference' } });

const { puzzles } = gameData();

/** How wide a slice of the board is in shot, in graph units. */
async function shot(page: Page): Promise<number> {
  const box = await page.locator('main svg').getAttribute('viewBox');
  return Number((box ?? '0 0 0 0').split(' ')[2]);
}

test('opens on the whole puzzle and closes on the answer', async ({ page }) => {
  await page.goto(board(puzzles[0]!, '?dev=0'));
  await expect(page.locator('main svg circle').first()).toBeVisible();

  // The card names the puzzle and the day, over a board pulled back far enough to show
  // the lot — which is the one moment the surrounding graph is worth seeing whole.
  const card = page.locator('main div[aria-hidden]').first();
  await expect(card).toContainText(puzzles[0]!.source);
  await expect(card).toContainText('Day');
  const wide = await shot(page);
  await page.screenshot({ path: 'e2e/shots/opening.png' });

  // Then it closes, and what is left is a board at playing scale.
  await expect.poll(async () => (await shot(page)) < wide, { timeout: 5000 }).toBe(true);
  await expect(page.locator('header')).toContainText(puzzles[0]!.source);
});

test('a board already played opens straight into the game', async ({ page }) => {
  // Coming back to check a score should not mean sitting through a title.
  const { puzzle, path } = puzzleWithPar(3);
  await page.goto(board(puzzle, '?dev=0'));
  await page.getByLabel(/Your guess/).fill(path[1]!);
  await page.getByRole('button', { name: 'Name it' }).click();
  await expect(page.locator('header')).toContainText('1 guessed');

  const played = await shot(page);
  await page.reload();
  await expect(page.locator('main svg circle').first()).toBeVisible();

  // No card, and the same view as before the reload — within a whisker, since the plate
  // is measured in pixels and the guess bar's height moves a little with what is in it.
  await expect(page.locator('main div[aria-hidden]')).toHaveCount(0);
  expect(Math.abs((await shot(page)) - played) / played).toBeLessThan(0.05);
});

test('typing cuts the opening short', async ({ page }) => {
  await page.goto(board(puzzles[1]!, '?dev=0'));
  await expect(page.locator('main svg circle').first()).toBeVisible();
  const wide = await shot(page);

  await page.keyboard.type('a');
  // Straight to the playing view, without waiting out the hold.
  await expect.poll(async () => (await shot(page)) < wide, { timeout: 1500 }).toBe(true);
  await expect(page.getByLabel(/Your guess/)).toHaveValue('a');
});
