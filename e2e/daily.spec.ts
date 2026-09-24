/**
 * Checks that the open map has not changed the daily game where the two share code: the
 * masthead, the board switch, the guess bar, routing, edge markup and storage.
 */

import { expect, test } from '@playwright/test';
import { board, gameData, masthead, today, todayNumber } from './fixtures';

const { manifest } = gameData();

// The open map is chosen from the board switch, not the masthead; a fifth entry wraps the row
// and shrinks the plate on every daily board.
test('the masthead offers the four destinations and no more', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'the phone folds them into the hamburger');
  await page.goto(board(today().puzzle));
  await page.locator('header').waitFor();

  const written = await page.evaluate(() =>
    [...document.querySelectorAll('header > div > span:nth-child(2) > button')].map(
      (one) => one.textContent?.trim() ?? '',
    ),
  );
  expect(written).toEqual(['Puzzles', 'Stats', 'Tutorial', 'How to play']);
});

test('the board switch still opens the day’s other lengths', async ({ page }) => {
  const here = today(0);
  const other = today(1);
  test.skip(here.puzzle.id === other.puzzle.id, 'the two lengths are the same board today');

  await page.goto(board(here.puzzle));
  await page.getByRole('button', { name: /choose a board/i }).click();
  await page.getByRole('option', { name: /letters medium/i }).click();

  await expect(page).toHaveURL(new RegExp(`/${other.puzzle.id}$`));
  await expect(page.locator('header')).toContainText(other.puzzle.source);
  await expect(page.locator('header')).toContainText(`${here.day}`);
});

// Fast travel is an optional `travel` prop on `GuessBar` and `MoveReadout` that the daily board
// does not pass.
test('a daily board refuses a word it has reached rather than travelling to it', async ({
  page,
}) => {
  const { graph } = gameData();
  const daily = today();
  const { source } = daily.puzzle;
  // Two steps out, so the source is not a move from where we end up.
  const near = new Set(graph.commonNeighbors(source));
  const step = graph
    .commonNeighbors(source)
    .map((one) => ({ one, two: graph.commonNeighbors(one).find((w) => w !== source && !near.has(w)) }))
    .find((pair) => pair.two !== undefined);
  test.skip(!step, 'no two-step walk out of today’s source');

  await page.goto(board(daily.puzzle));
  const field = page.getByLabel(/Your guess/);
  const go = page.getByRole('button', { name: 'Guess', exact: true });
  for (const word of [step!.one, step!.two!]) {
    await field.fill(word);
    await go.click();
  }
  await expect(page.getByText(new RegExp(`from\\s+${step!.two}`, 'i'))).toBeVisible();

  await field.fill(source);
  await expect(page.getByText(/go to /i)).toBeHidden();
  await go.click();
  await expect(page.locator('#guess-error')).not.toHaveText('');
  await expect(page.getByText(new RegExp(`from\\s+${step!.two}`, 'i'))).toBeVisible();
});

// A direct visit loads a board underneath the page and `show` rewrites the address; the page
// path, second segment included, must be put back afterwards.
test('a direct visit to one game’s rules keeps which game', async ({ page }) => {
  const mode = manifest.modes.find((one) => one.name === 'phonemes');
  test.skip(!mode, 'no phonemes mode in this bank');

  await page.goto(`/rules/${mode!.name}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  // After the board underneath has loaded.
  await page.waitForTimeout(1500);
  await expect(page).toHaveURL(new RegExp(`/rules/${mode!.name}$`));
});

// The masthead is shared with the open map.
test('every way off a daily board still leads where it did', async ({ page }) => {
  await page.goto(board(today().puzzle));

  await masthead(page, 'Puzzles');
  await expect(page).toHaveURL(/\/puzzles$/);
  await page.goBack();

  await masthead(page, 'Stats');
  await expect(page).toHaveURL(/\/stats$/);
  await page.goBack();

  await masthead(page, 'Tutorial');
  await expect(page).toHaveURL(/\/tutorial$/);
  await page.goBack();

  await masthead(page, 'How to play');
  await expect(page.getByRole('dialog')).toBeVisible();
});

// The open map's arrival animation (`.tendril`) must not add a group inside each daily edge.
test('a daily edge is drawn without a wrapper around it', async ({ page }) => {
  await page.goto(board(today().puzzle));
  await expect(page.locator('main svg circle').first()).toBeVisible();

  const shape = await page.evaluate(() => {
    const edges = [...document.querySelectorAll('g[data-edge]')];
    return {
      edges: edges.length,
      groups: edges.filter((edge) => edge.querySelector(':scope > g')).length,
      lines: edges.filter((edge) => edge.querySelector(':scope > line')).length,
      sprouting: document.querySelectorAll('.tendril').length,
    };
  });
  expect(shape.edges).toBeGreaterThan(0);
  expect(shape.groups, 'an edge gained a wrapper').toBe(0);
  expect(shape.lines).toBe(shape.edges);
  expect(shape.sprouting, 'the daily board does not sprout').toBe(0);
});

test('playing a map leaves the daily game’s storage alone', async ({ page }) => {
  const daily = today();
  await page.goto(board(daily.puzzle));
  const field = page.getByLabel(/Your guess/);
  const { graph } = gameData();
  await field.fill(graph.commonNeighbors(daily.puzzle.source)[0]!);
  await page.getByRole('button', { name: 'Guess', exact: true }).click();
  await page.waitForTimeout(400);

  const before = await page.evaluate(() => localStorage.getItem('recurse.games.v2'));
  expect(before).not.toBeNull();

  await page.getByRole('button', { name: /choose a board/i }).click();
  await page.getByRole('option', { name: /explore letters/i }).click();
  await expect(page.getByRole('button', { name: 'Begin' })).toBeVisible();
  await page.getByRole('textbox').first().fill(daily.puzzle.source);
  await page.getByRole('button', { name: 'Begin' }).click();
  await expect(page.locator('svg[role="img"]')).toBeVisible();
  await page.waitForTimeout(1500);

  const after = await page.evaluate(() => ({
    games: localStorage.getItem('recurse.games.v2'),
    keys: Object.keys(localStorage).sort(),
  }));
  expect(after.games, 'the map wrote into the daily game’s slot').toBe(before);
  // A map is kept in IndexedDB.
  expect(after.keys.filter((key) => key.includes('atlas'))).toEqual([]);
});

test('the header still says which day it is', async ({ page }) => {
  await page.goto(board(today().puzzle));
  await expect(page.locator('header')).toContainText(`${todayNumber()}`);
});
