/**
 * Developer mode: stepping the bank, and a contact sheet of boards to eyeball.
 */

import { expect, test } from '@playwright/test';
import { board, gameData, inShot, result } from './fixtures';

test('steps through the bank', async ({ page }) => {
  await page.goto(board(puzzles[0]!, '?dev'));

  const bar = page.locator('text=DEV').locator('..');
  await expect(bar).toContainText('1/');

  await page.getByLabel('Next puzzle').click();
  await expect(bar).toContainText('2/');

  await page.getByLabel('Previous puzzle').click();
  await expect(bar).toContainText('1/');

  // Jump straight to a numbered puzzle.
  await page.getByLabel('Jump to puzzle number').fill('40');
  await page.getByLabel('Jump to puzzle number').press('Enter');
  await expect(bar).toContainText('40/');
});

test('right-clicking a word spells it out without spending a hint', async ({ page }) => {
  // Reading the words around the answer is how a puzzle gets judged, and it has to
  // stay out of the game: when it went through the hint ladder, one tap on a
  // ten-letter word put ten hints on the tally.
  await page.goto(board(puzzles[0]!, '?dev'));
  const dot = await inShot(page, '[aria-label^="Unnamed word. Reveal"]');
  await expect(dot).toBeVisible();

  await dot.click({ button: 'right' });
  // A word appeared on the plate...
  await expect(page.locator('main svg text')).not.toHaveCount(0);
  // ...and the header still says nothing about hints.
  await expect(page.locator('header')).not.toContainText('hint');

  // `name all` is the same thing in bulk, and just as free.
  await page.getByRole('button', { name: 'name all' }).click();
  await expect(page.locator('header')).not.toContainText('hint');
});

test('dev mode can be put away to see what a player sees', async ({ page }) => {
  await page.goto(board(puzzles[0]!, '?dev'));
  const bar = page.locator('text=DEV').locator('..');
  await expect(bar).toBeVisible();

  // Hidden in place: same board, same game, no instruments.
  await page.getByLabel('Hide dev mode').click();
  await expect(page.locator('text=DEV')).toHaveCount(0);
  await expect(page.locator('header')).toContainText(puzzles[0]!.source);

  // And back again, without a reload — the key is the only way in once it is gone.
  await page.keyboard.press('Control+d');
  await expect(page.locator('text=DEV')).toBeVisible();

  // The choice survives a reload, or checking the player's view would mean losing it
  // again on every refresh.
  await page.getByLabel('Hide dev mode').click();
  await page.reload();
  await expect(page.locator('main svg circle').first()).toBeVisible();
  await expect(page.locator('text=DEV')).toHaveCount(0);
});

test('solve button fills in a shortest path', async ({ page }) => {
  await page.goto(board(puzzles[1]!, '?dev'));
  await page.getByRole('button', { name: 'solve' }).click();
  // Either ending counts: the solver walks the graph's best route, and on a puzzle
  // with a secret that route is shorter than par, which is its own result.
  await expect(result(page)).toContainText(/Perfect|secret way/);
  await page.screenshot({ path: 'e2e/shots/dev-solved.png' });
});

// A handful of boards at a glance, to judge shape and word quality. Skipped by
// default: see the note in boards.spec.ts.
const { puzzles } = gameData();
for (const i of [0, 1, 2, 5]) {
  test(`board ${i}: ${puzzles[i]!.source} to ${puzzles[i]!.target}`, async ({ page }) => {
    test.skip(!process.env.RECURSE_LOOK, 'contact sheet: run with RECURSE_LOOK=1');
    await page.goto(board(puzzles[i]!, '?dev'));
    await expect(page.locator('main svg circle').first()).toBeVisible();
    await page.screenshot({ path: `e2e/shots/board-${i}.png` });
  });
}
