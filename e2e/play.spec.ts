/**
 * Playing the game for real: type words into the actual input, watch the plate
 * fill in, reach the target.
 */

import { expect, test, type Page } from '@playwright/test';
import { gameData, puzzleWithPar, puzzleWithSecret } from './fixtures';

async function guess(page: Page, word: string) {
  const input = page.getByLabel(/Your guess/);
  await input.fill(word);
  await page.getByRole('button', { name: 'Name it' }).click();
}

test('solves a puzzle perfectly by walking a shortest path', async ({ page }) => {
  const { index, puzzle, path } = puzzleWithPar(3);
  await page.goto(`/?puzzle=${index}`);

  await expect(page.locator('header')).toContainText(puzzle.source);
  await expect(page.locator('header')).toContainText(puzzle.target);
  await expect(page.locator('header')).toContainText('no guesses yet');

  // The source is where guesses start from.
  await expect(page.getByLabel(/Your guess/)).toHaveAttribute(
    'aria-label',
    new RegExp(`from ${puzzle.source}`),
  );

  for (const word of path.slice(1)) {
    await guess(page, word);
    // Each named word appears on the plate.
    await expect(page.locator('main svg text', { hasText: new RegExp(`^${word}$`) }).first()).toBeVisible();
  }

  // Par play is a perfect score, and the guess bar gives way to the summary.
  const summary = page.getByRole('region').or(page.locator('section')).last();
  await expect(summary).toContainText('Perfect');
  await expect(summary).toContainText(`${puzzle.par} guesses`);
  await expect(page.getByLabel(/Your guess/)).toHaveCount(0);

  await page.screenshot({ path: 'e2e/shots/solved.png' });
});

test('revisiting a word already found is free', async ({ page }) => {
  const { index, puzzle, path } = puzzleWithPar(3);
  await page.goto(`/?puzzle=${index}`);

  // Step forward, step back to the source, then walk the whole path. Every word
  // revisited is already named, so nothing here should be charged and the score
  // should still come out at par.
  await guess(page, path[1]!);
  await guess(page, path[0]!);
  for (const word of path.slice(1)) await guess(page, word);

  const summary = page.locator('section').last();
  await expect(summary).toContainText('Perfect');
  await expect(summary).toContainText(`${puzzle.par} guesses`);
});

test('a wrong turn costs a guess', async ({ page }) => {
  const { index, puzzle, path, wrongTurn } = puzzleWithPar(3);
  await page.goto(`/?puzzle=${index}`);

  // A legal move to a word off every shortest path: real progress lost.
  await guess(page, wrongTurn);
  // Back to the source, which is free, then solve it properly.
  await guess(page, path[0]!);
  for (const word of path.slice(1)) await guess(page, word);

  const summary = page.locator('section').last();
  await expect(summary).toContainText('Found it');
  await expect(summary).not.toContainText('Perfect');
  await expect(summary).toContainText(`${puzzle.par + 1} guesses`);
  await expect(summary).toContainText(`${puzzle.par} at best`);
});

test('shows the move as it is typed', async ({ page }) => {
  const { index, path } = puzzleWithPar(3);
  await page.goto(`/?puzzle=${index}`);

  const source = path[0]!;
  const next = path[1]!;
  await page.getByLabel(/Your guess/).fill(next);

  // The readout names the subword and which direction it goes. Scoped to the
  // guess form: dev mode has a form of its own, and `form` alone matched both.
  const bar = page.locator('form').filter({ has: page.getByLabel(/Your guess/) });
  const adding = next.length > source.length;
  await expect(bar).toContainText(adding ? '+' : '−');
  await page.screenshot({ path: 'e2e/shots/typing.png' });
});

test('guessing an off-target word keeps the board and adds to it', async ({ page }) => {
  const { index, puzzle } = puzzleWithPar(3);
  await page.goto(`/?dev=0&puzzle=${index}`);

  const nodes = () => page.locator('main svg circle[role="button"]');
  // Wait for the board before counting it: the page spends a beat loading 4MB of
  // word data, and counting during that beat counted an empty plate.
  await expect(nodes().first()).toBeVisible();
  const before = await nodes().count();
  expect(before).toBeGreaterThan(3);

  // A legal move to somewhere off the intended route.
  const { graph } = gameData();
  const stray = graph.neighbors(puzzle.source).find((w) => w !== puzzle.target);
  test.skip(!stray, 'no stray move available');

  await guess(page, stray!);

  // The word arrives...
  await expect(
    page.locator('main svg text', { hasText: new RegExp(`^${stray}$`) }).first(),
  ).toBeVisible();
  // ...and the target is still there. Rebuilding from scratch used to replace the
  // whole figure with the neighbourhood of the stray word.
  await expect(
    page.locator('main svg text', { hasText: new RegExp(`^${puzzle.target}$`) }).first(),
  ).toBeVisible();
  // The board only ever grows.
  await expect.poll(() => nodes().count()).toBeGreaterThanOrEqual(before);
});

test('beating par is a secret, not a mistake', async ({ page }) => {
  // Par is the best route through ordinary words. A rarer word can cut a corner,
  // and the game celebrates that rather than pretending it is impossible.
  const { index, puzzle, path } = puzzleWithSecret();
  expect(path.length - 1).toBeLessThan(puzzle.par);

  await page.goto(`/?dev=0&puzzle=${index}`);
  for (const word of path.slice(1)) await guess(page, word);

  const summary = page.locator('section').last();
  await expect(summary).toContainText('secret');
  await expect(summary).toContainText(`${puzzle.par - path.length + 1} under par`);
  await page.screenshot({ path: 'e2e/shots/secret.png' });
});
