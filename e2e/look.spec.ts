/**
 * Screenshots for eyeballing the design, and a smoke check that the plate
 * actually renders. Not assertions about pixels — those would fight the
 * force layout — just proof the thing draws and a picture to look at.
 */

import { expect, test } from '@playwright/test';
import { inShot } from './fixtures';

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

test('hovering a word lifts its moves out of the background', async ({ page }) => {
  // An unwalked edge is drawn at one unit in the faintest ink there is, which is
  // right for a background of possibilities and useless when you want to follow one.
  await page.goto('/');
  const edges = page.locator('main svg line');
  await expect(edges.first()).toBeVisible();

  const widths = () => edges.evaluateAll((all) => all.map((l) => l.getAttribute('stroke-width')));
  expect(await widths()).not.toContain('1.8');

  // A word that is in shot, since most of the board is off the edges by design.
  await (await inShot(page, 'main svg circle[role="button"]')).hover();
  await expect.poll(async () => (await widths()).includes('1.8')).toBe(true);

  // Nothing is *named* by hovering: the subword on an edge is the record of a move
  // made, and giving it away on hover would be a free hint.
  // `allTextContents`, not `allInnerTexts`: SVG text has no innerText, so that one
  // comes back as a list of undefined and every assertion on it passes vacuously.
  const labels = await page.locator('main svg text').allTextContents();
  expect(labels.filter((text) => /^[+−]/.test(text))).toHaveLength(0);
});

test('opens the rules', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'How to play' }).click();
  await expect(page.getByRole('dialog')).toContainText('add a word');
  await page.screenshot({ path: 'e2e/shots/howto.png' });
});
