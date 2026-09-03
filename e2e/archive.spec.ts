/**
 * The archive: `/puzzles`, where a board already played is found by its date or by its words.
 *
 * In a browser because the claims are all navigation. The page is the one path that is not a
 * board, so it has to survive the back button in both directions; the calendar has to be a real
 * calendar, with the months bounded by what has happened; and the search has to refuse a puzzle
 * that has not come up yet, which is the only rule the page enforces.
 *
 * The bank starts on the epoch, so early in the game's life there are only a handful of days to
 * browse — these read the days out of the shipped data rather than assuming a month of them.
 */

import { expect, test } from '@playwright/test';
import { boardOnDay, masthead, todayNumber } from './fixtures';

/** The path in the address bar, whatever the base happens to be. */
const pathOf = (url: string) => new URL(url).pathname.replace(/^\//, '').split('?')[0];

const openArchive = async (page: import('@playwright/test').Page) => {
  await page.goto('/');
  await masthead(page, 'Puzzles');
  await expect(page.getByRole('heading', { name: 'Puzzles' })).toBeVisible();
};

test('the header opens the archive at its own address', async ({ page }) => {
  await openArchive(page);
  expect(pathOf(page.url())).toBe('puzzles');
  // Pushed, not replaced: the board underneath is where back goes.
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Puzzles' })).toHaveCount(0);
  await expect(page.getByLabel(/Your guess/)).toBeVisible();
});

test('a direct visit to the archive works, and back leaves it', async ({ page }) => {
  // The path fallback: on a static host `/puzzles` is served 404.html, and the app reads the
  // path itself. A board is not what this URL names, so none should be drawn.
  await page.goto('/puzzles');
  await expect(page.getByRole('heading', { name: 'Puzzles' })).toBeVisible();
  await expect(page.getByLabel(/Your guess/)).toHaveCount(0);

  await page.getByRole('button', { name: 'back to the board' }).click();
  await expect(page.getByLabel(/Your guess/)).toBeVisible();
});

test('shows the days that have happened, with the words of all three lengths', async ({
  page,
}) => {
  const today = todayNumber();
  await openArchive(page);
  const archive = page.locator('div.mx-auto').first();

  // Every length of today is offered, not just the one being played.
  for (const band of [0, 1, 2]) {
    const board = boardOnDay(today, band);
    await expect(archive).toContainText(board.puzzle.source);
    await expect(archive).toContainText(board.puzzle.target);
  }
  // And yesterday, which is the point of an archive. The page opens on today's month, so a day
  // in it is on screen without navigating.
  await expect(archive).toContainText(boardOnDay(today - 1).puzzle.source);
});

test('opens a board from the calendar', async ({ page }) => {
  // A day in the month the archive opens on, so it is on screen without navigating.
  const first = boardOnDay(todayNumber() - 1);
  await openArchive(page);

  // Titled with the length and the pair, which is what a truncated square can still be found by.
  // `:visible` because both layouts are in the DOM and only one of them is on screen — the grid
  // is `hidden sm:table`, so on a phone the match to click is the list's.
  await page.locator(`[title*="${first.puzzle.source}"]:visible`).first().click();

  await expect(page.getByLabel(/Your guess/)).toBeVisible();
  expect(pathOf(page.url())).toBe(first.puzzle.id);
  await expect(page.locator('header')).toContainText(first.puzzle.source);
});

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];

test('navigates months, and will not step past either end of the archive', async ({ page }) => {
  await openArchive(page);
  const heading = page.getByRole('button', { expanded: false });

  // It opens on today's month, which is the last there is: nothing after it.
  const now = new Date();
  await expect(heading).toContainText(`${MONTHS[now.getMonth() + 1]} ${now.getFullYear()}`);
  await expect(page.getByLabel('The month after')).toBeDisabled();

  // A step back is a different month, and forward returns.
  await page.getByLabel('The month before').click();
  await expect(heading).not.toContainText(`${MONTHS[now.getMonth() + 1]} ${now.getFullYear()}`);
  await expect(page.getByLabel('The month after')).toBeEnabled();
  await page.getByLabel('The month after').click();
  await expect(heading).toContainText(`${MONTHS[now.getMonth() + 1]} ${now.getFullYear()}`);
});

test('zooms out to a year of months, and back into one', async ({ page }) => {
  await openArchive(page);
  const heading = page.getByRole('button', { expanded: false });
  const now = new Date();

  await heading.click();
  await expect(page.getByRole('button', { name: 'January' })).toBeVisible();
  // A month after today is offered but refused — the archive stops at today.
  if (now.getMonth() < 11) {
    await expect(page.getByRole('button', { name: 'December' })).toBeDisabled();
  }

  const own = MONTHS[now.getMonth() + 1]!;
  await page.getByRole('button', { name: own, exact: true }).click();
  await expect(page.getByRole('button', { expanded: false })).toContainText(own);
});

/**
 * Prev and next mean "one of whatever is on screen".
 *
 * They used to always mean a month, while the year view carried its own pair of year buttons at
 * its foot — two idioms for one job, and stepping a year from there dropped you into a month view
 * rather than the year you asked for.
 */
test('prev and next step a year while zoomed out, and stay zoomed out', async ({ page }) => {
  await openArchive(page);
  const now = new Date();
  const zoom = page.getByRole('button', { expanded: false });
  await zoom.click();

  const zoomed = page.getByRole('button', { expanded: true });
  await expect(zoomed).toHaveText(String(now.getFullYear()));
  // Labelled for the unit they actually move, which is how they are found here.
  await expect(page.getByLabel('The year after')).toBeDisabled();

  await page.getByLabel('The year before').click();
  // Still the year view, and a year earlier — not the month view of that year.
  await expect(page.getByRole('button', { expanded: true })).toHaveText(
    String(now.getFullYear() - 1),
  );
  await expect(page.getByRole('button', { name: 'January' })).toBeVisible();
  await expect(page.getByLabel('The year after')).toBeEnabled();

  // And the year view has no navigation of its own any more.
  await expect(page.getByRole('button', { name: String(now.getFullYear()) })).toHaveCount(0);
});

test('finds played puzzles on part of either word', async ({ page }) => {
  const played = boardOnDay(0);
  await openArchive(page);

  const source = page.getByLabel('Find a puzzle by its source word');
  const status = page.locator('[role="status"]');
  // The index is a megabyte, so it arrives a beat after the page does.
  await expect(source).not.toHaveAttribute('placeholder', 'loading…');

  // The *middle* of a word, which a prefix match would never find.
  const middle = played.puzzle.source.slice(1, -1);
  await source.fill(middle);
  await expect(status).toContainText(/[0-9]+ puzzles?/);
  // Scoped to the results: the calendar's cards are the same component with the same title, so
  // an unscoped selector would be checking the month on screen as well.
  const cards = page.getByRole('group', { name: 'Puzzles found' }).locator('[title*=" → "]');
  expect(await cards.count()).toBeGreaterThan(0);
  for (const title of await cards.evaluateAll((all) =>
    all.map((one) => one.getAttribute('title') ?? ''),
  )) {
    expect(title.split(':')[1]!.split('→')[0]).toContain(middle);
  }
});

test('refuses a puzzle that has not come up yet', async ({ page }) => {
  // A board a long way into the calendar, which no amount of browsing should reach.
  const future = boardOnDay(todayNumber() + 500);
  await openArchive(page);

  const source = page.getByLabel('Find a puzzle by its source word');
  await expect(source).not.toHaveAttribute('placeholder', 'loading…');
  await source.fill(future.puzzle.source);
  await page.getByLabel('Find a puzzle by its target word').fill(future.puzzle.target);
  await expect(page.locator('[role="status"]')).toContainText('No puzzle yet');
});

test('opens a board from the search', async ({ page }) => {
  const played = boardOnDay(todayNumber() - 2, 1);
  await openArchive(page);

  const source = page.getByLabel('Find a puzzle by its source word');
  await expect(source).not.toHaveAttribute('placeholder', 'loading…');
  await source.fill(played.puzzle.source);
  await page.getByLabel('Find a puzzle by its target word').fill(played.puzzle.target);

  await page
    .getByRole('group', { name: 'Puzzles found' })
    .locator(`[title*="${played.puzzle.source} → ${played.puzzle.target}"]`)
    .first()
    .click();
  await expect(page.getByLabel(/Your guess/)).toBeVisible();
  expect(pathOf(page.url())).toBe(played.puzzle.id);
});
