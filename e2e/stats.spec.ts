/**
 * The stats screen: `/stats`, the record of every round finished.
 *
 * In a browser because everything about it is a round trip through storage. The unit tests
 * own the arithmetic — which day is a streak, what a merge does — and cannot say whether a
 * finished round ever reaches the store, whether the screen reads the same key the game
 * writes, or whether an export can be pasted back in and land as the same history.
 *
 * So these play real rounds and then go and look, which is the one claim worth a browser:
 * finish something, see it counted; carry it out and back, see it return.
 */

import { expect, test, type Page } from '@playwright/test';
import { board, masthead, puzzleWithPar, result } from './fixtures';

/** The path in the address bar, whatever the base happens to be. */
const pathOf = (url: string) => new URL(url).pathname.replace(/^\//, '').split('?')[0];

async function guess(page: Page, word: string) {
  await page.getByLabel(/Your guess/).fill(word);
  await page.getByRole('button', { name: 'Name it' }).click();
}

/** Walk a puzzle's shortest path, which finishes it at par. */
async function finish(page: Page, path: readonly string[]) {
  for (const word of path.slice(1)) await guess(page, word);
  await expect(result(page)).toContainText('Perfect');
}

const openStats = async (page: Page) => {
  await masthead(page, 'Stats');
  await expect(page.getByRole('heading', { name: 'Stats' })).toBeVisible();
};

test('the header opens the stats at their own address', async ({ page }) => {
  await page.goto('/');
  await openStats(page);
  expect(pathOf(page.url())).toBe('stats');

  // Pushed, not replaced: the board underneath is where back goes.
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Stats' })).toHaveCount(0);
  await expect(page.getByLabel(/Your guess/)).toBeVisible();
});

test('a direct visit works, and back to the board leaves it', async ({ page }) => {
  // The path fallback: on a static host `/stats` is served 404.html and the app reads the
  // path itself. No board is named here, so none should be drawn.
  await page.goto('/stats');
  await expect(page.getByRole('heading', { name: 'Stats' })).toBeVisible();
  await expect(page.getByLabel(/Your guess/)).toHaveCount(0);

  await page.getByRole('button', { name: 'back to the board' }).click();
  await expect(page.getByLabel(/Your guess/)).toBeVisible();
});

test('the archive and the stats are each other’s neighbours', async ({ page }) => {
  await page.goto('/puzzles');
  await page.getByRole('button', { name: 'Stats', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Stats' })).toBeVisible();

  await page.getByRole('button', { name: 'Puzzles', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Puzzles' })).toBeVisible();
});

test('says nothing before anything has been played', async ({ page }) => {
  await page.goto('/stats');
  await expect(page.getByText('Nothing here yet')).toBeVisible();
  expect(await page.getByLabel('rounds finished').count()).toBe(0);
});

test('a finished round is counted, and lands in the history', async ({ page }) => {
  const { puzzle, path } = puzzleWithPar(3);
  await page.goto(board(puzzle, '?dev=0'));
  await finish(page, path);

  await openStats(page);
  await expect(page.getByLabel('rounds finished')).toContainText('1');
  // Played at par, so nothing above or below it.
  await expect(page.getByLabel('against par', { exact: true })).toContainText('0.0');

  // And the round itself is in the list, drawn as the archive draws a board.
  await expect(page.locator(`[title*="${puzzle.source} → ${puzzle.target}"]`)).toBeVisible();
});

test('records a board that was already finished when it was opened', async ({ page }) => {
  // The backfill: a round finished before the stats screen was ever visited is still that
  // player's round, and reopening the board is when it gets written down.
  const { puzzle, path } = puzzleWithPar(3);
  await page.goto(board(puzzle, '?dev=0'));
  await finish(page, path);

  // Come back to it cold. The saved game restores as solved, and the round is already here.
  await page.goto(board(puzzle, '?dev=0'));
  await expect(result(page)).toContainText('Perfect');

  await openStats(page);
  // Once, not twice: the first record a pair has is the one it keeps.
  await expect(page.getByLabel('rounds finished')).toContainText('1');
});

test('two rounds are two rounds, and the lengths are counted apart', async ({ page }) => {
  const first = puzzleWithPar(3);
  const second = puzzleWithPar(4);

  await page.goto(board(first.puzzle, '?dev=0'));
  await finish(page, first.path);
  await page.goto(board(second.puzzle, '?dev=0'));
  await finish(page, second.path);

  await openStats(page);
  await expect(page.getByLabel('rounds finished')).toContainText('2');
  // Both were played at par, whichever lengths they turned out to be.
  await expect(page.getByLabel('against par', { exact: true })).toContainText('0.0');
});

test('exports, clears, and imports the history back', async ({ page }) => {
  const { puzzle, path } = puzzleWithPar(3);
  await page.goto(board(puzzle, '?dev=0'));
  await finish(page, path);

  await openStats(page);
  await expect(page.getByLabel('rounds finished')).toContainText('1');

  // Carry it out. The text is on screen and selectable, not only behind a clipboard button
  // — which is the same decision the share text made, and what makes this readable here.
  await page.getByRole('button', { name: 'Export' }).click();
  const carried = await page.getByLabel('Your stats, as text').innerText();
  expect(carried).toContain('"kind":"stats"');

  // Throw it away, with the nudge in between.
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Export first' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear it all' }).click();
  await expect(page.getByText('Nothing here yet')).toBeVisible();

  // And bring it back, by the paste path a phone would use.
  await page.getByRole('button', { name: 'Import' }).click();
  await page.getByLabel('Stats to import, pasted').fill(carried);
  await page.getByRole('button', { name: 'Read it' }).click();
  // Preview then confirm: nothing has changed yet.
  await expect(page.getByText('1 new, 0 already here')).toBeVisible();
  await expect(page.getByText('Nothing here yet')).toBeVisible();

  await page.getByRole('button', { name: 'Import them' }).click();
  await expect(page.getByLabel('rounds finished')).toContainText('1');
});

test('an import keeps the round already here, whole', async ({ page }) => {
  const { puzzle, path } = puzzleWithPar(3);
  await page.goto(board(puzzle, '?dev=0'));
  await finish(page, path);

  await openStats(page);
  await page.getByRole('button', { name: 'Export' }).click();
  const carried = await page.getByLabel('Your stats, as text').innerText();

  // Importing the same file over itself is the case that must change nothing.
  await page.getByRole('button', { name: 'Import' }).click();
  await page.getByLabel('Stats to import, pasted').fill(carried);
  await page.getByRole('button', { name: 'Read it' }).click();
  await expect(page.getByText('0 new, 1 already here (kept yours)')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nothing to add' })).toBeDisabled();
});

test('refuses a file from a newer version rather than guessing at it', async ({ page }) => {
  await page.goto('/stats');
  await page.getByRole('button', { name: 'Import' }).click();
  await page
    .getByLabel('Stats to import, pasted')
    .fill('{"app":"recurse","kind":"stats","version":99,"records":[]}');
  await page.getByRole('button', { name: 'Read it' }).click();
  await expect(page.getByText(/newer version/)).toBeVisible();
});

test('a round solved by dev mode is never written down', async ({ page }) => {
  // Dev mode's solve is inspection, in the same way spelling a word out is inspection. It
  // costs no hints, it is not a score, and it has no business in anybody's history.
  const { puzzle } = puzzleWithPar(3);
  await page.goto(board(puzzle, '?dev'));
  await page.getByRole('button', { name: 'solve', exact: true }).click();
  await expect(result(page)).toBeVisible();

  await masthead(page, 'Stats');
  await expect(page.getByText('Nothing here yet')).toBeVisible();
});
