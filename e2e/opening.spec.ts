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

  // No card, and near enough the same view as before the reload.
  //
  // Near enough, and not nearer, because the two boards are *assembled* differently: before the
  // reload it grew a word at a time, after it is built in one go from the restored log, and a
  // force layout settles those into slightly different positions. The camera frames the figure,
  // so the same game can come back a few percent wider or narrower. Measured at 5.7% on one
  // par-3 board with the pixel dimensions of the header, plate and guess bar all identical.
  //
  // The claim being made is that a board already played opens *into the game* rather than into
  // the title sequence, and the opening's wide shot is two to three times this — so a bound
  // that admits a few percent of layout jitter still fails loudly for the thing it is about.
  await expect(page.locator('main div[aria-hidden]')).toHaveCount(0);
  await expect
    .poll(async () => Math.abs((await shot(page)) - played) / played, { timeout: 5000 })
    .toBeLessThan(0.15);
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
