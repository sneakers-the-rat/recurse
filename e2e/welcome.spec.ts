/**
 * The offer of the walkthrough, which a first visit gets once.
 *
 * The one spec that arrives with nothing stored: everything else is seeded as a returning
 * player, because a hundred and fifty tests about something else should not each have to
 * dismiss a greeting first. See `storageState` in playwright.config.ts.
 *
 * What is being tested is the *once*, and both halves of it. A prompt that comes back is a
 * prompt that reads as broken, and it sits over a live board somebody may have arrived at by
 * a shared link and be perfectly happy to just play — so declining has to stick, and it has
 * to say where the tutorial went.
 */

import { expect, test, type Page } from '@playwright/test';

// Nothing stored, which is what makes this visit a first one.
test.use({ storageState: { cookies: [], origins: [] } });

const pathOf = (url: string) => new URL(url).pathname.replace(/^\//, '').split('?')[0];

const welcome = (page: Page) => page.getByRole('dialog').filter({ hasText: 'New here?' });

async function arrive(page: Page) {
  await page.goto('/');
  await expect(welcome(page)).toBeVisible({ timeout: 20_000 });
}

test('a first visit is offered the walkthrough', async ({ page }) => {
  await arrive(page);
  // And told what declining costs, which is nothing.
  await expect(welcome(page)).toContainText('menu');
});

test('taking it opens the lesson', async ({ page }) => {
  await arrive(page);
  await welcome(page).getByRole('button', { name: /Show me how/ }).click();
  await expect(page.locator('[data-step]')).toBeVisible();
  expect(pathOf(page.url())).toBe('tutorial');
});

test('skipping leaves the board alone, and does not ask again', async ({ page }) => {
  await arrive(page);
  await welcome(page).getByRole('button', { name: /Skip/ }).click();
  await expect(welcome(page)).toHaveCount(0);
  await expect(page.getByLabel(/Your guess/)).toBeVisible();

  await page.reload();
  await expect(page.getByLabel(/Your guess/)).toBeVisible();
  await expect(welcome(page)).toHaveCount(0);
});

test('taking it also counts as answering', async ({ page }) => {
  // Both answers are answers: somebody who has been through the lesson is not a newcomer.
  await arrive(page);
  await welcome(page).getByRole('button', { name: /Show me how/ }).click();
  await expect(page.locator('[data-step]')).toBeVisible();

  await page.goto('/');
  await expect(page.getByLabel(/Your guess/)).toBeVisible();
  await expect(welcome(page)).toHaveCount(0);
});

test('a player who has already played is never greeted', async ({ page }) => {
  // The prompt shipping to everybody's next visit is the failure this guards. Any stored
  // game or finished round is proof enough of having been here.
  await page.addInitScript(() => {
    localStorage.setItem('recurse.games.v2', '[]');
  });
  await page.goto('/');
  await expect(page.getByLabel(/Your guess/)).toBeVisible();
  await expect(welcome(page)).toHaveCount(0);
});
