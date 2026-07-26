/**
 * Developer mode: stepping the bank, and a contact sheet of boards to eyeball.
 */

import { expect, test } from '@playwright/test';
import { gameData } from './fixtures';

test('steps through the bank', async ({ page }) => {
  await page.goto('/?dev&puzzle=0');

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

test('solve button fills in a shortest path', async ({ page }) => {
  await page.goto('/?dev&puzzle=1');
  await page.getByRole('button', { name: 'solve' }).click();
  // Either ending counts: the solver walks the graph's best route, and on a puzzle
  // with a secret that route is shorter than par, which is its own result.
  await expect(page.locator('section').last()).toContainText(/Perfect|secret way/);
  await page.screenshot({ path: 'e2e/shots/dev-solved.png' });
});

// A handful of boards at a glance, to judge shape and word quality.
const { puzzles } = gameData();
for (const i of [0, 1, 2, 5]) {
  test(`board ${i}: ${puzzles[i]!.source} to ${puzzles[i]!.target}`, async ({ page }) => {
    await page.goto(`/?dev&puzzle=${i}`);
    await expect(page.locator('main svg circle').first()).toBeVisible();
    await page.screenshot({ path: `e2e/shots/board-${i}.png` });
  });
}
