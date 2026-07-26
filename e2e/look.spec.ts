/**
 * Screenshots for eyeballing the design, and a smoke check that the plate
 * actually renders. Not assertions about pixels — those would fight the
 * force layout — just proof the thing draws and a picture to look at.
 */

import { expect, test } from '@playwright/test';

test('renders the plate and the puzzle statement', async ({ page }) => {
  await page.goto('/');

  // Both puzzle words appear in the header.
  const header = page.locator('header');
  await expect(header).toContainText('№');

  // The graph drew something.
  const svg = page.locator('main svg');
  await expect(svg).toBeVisible();
  await expect(svg.locator('circle').first()).toBeVisible();
  const nodeCount = await svg.locator('circle').count();
  expect(nodeCount).toBeGreaterThan(10);

  await page.screenshot({ path: 'e2e/shots/start.png', fullPage: false });
});

test('opens the rules', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'How to play' }).click();
  await expect(page.getByRole('dialog')).toContainText('add a word');
  await page.screenshot({ path: 'e2e/shots/howto.png' });
});
