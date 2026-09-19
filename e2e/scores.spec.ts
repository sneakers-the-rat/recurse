/**
 * The low score screen, in a browser, against a real server.
 *
 * **Skipped unless `RECURSE_SERVER` names one**, because the server is optional and the rest of
 * this suite has to go on passing without it. That is the same claim these tests exist to
 * check from the other side: the default build has no scoreboard and makes no requests, and a
 * spec that quietly required one would have turned "optional" into "optional in principle".
 *
 * Run it with both halves up:
 *
 *     cd server && RECURSE_ORIGINS=http://localhost:5173 \
 *       RECURSE_DATA=http://localhost:5173/data/ RECURSE_DB=/tmp/e2e.db npm run dev
 *     RECURSE_SERVER=http://localhost:8787 VITE_RECURSE_API=http://localhost:8787 \
 *       npx playwright test scores
 *
 * The database wants to be a scratch file: these play real boards and the rounds are real.
 */

import { expect, test, type Page } from '@playwright/test';
import { board, puzzleWithPar } from './fixtures';

const SERVER = process.env.RECURSE_SERVER;

test.skip(!SERVER, 'set RECURSE_SERVER (and VITE_RECURSE_API) to run these');

async function guess(page: Page, word: string) {
  await page.getByLabel(/Your guess/).fill(word);
  await page.getByRole('button', { name: 'Guess', exact: true }).click();
}

/** Play the shortest route, which is a round that finishes in exactly par. */
async function solve(page: Page, path: readonly string[]) {
  for (const word of path.slice(1)) await guess(page, word);
}

test('a finished round lands on the board, as anonymous', async ({ page }) => {
  const { puzzle, path } = puzzleWithPar(3);
  await page.goto(board(puzzle, '?dev=0'));
  await solve(page, path);

  const scores = page.getByRole('region', { name: /Fewest guesses/ });
  await expect(scores).toBeVisible();
  // The row is the player's own, drawn under a word from the catalog rather than a name the
  // server stored — it stores none at all.
  await expect(scores.getByText('anonymous').first()).toBeVisible();
  await expect(scores.getByText(String(puzzle.par), { exact: true }).first()).toBeVisible();
});

test('taking a name puts it on the row that was already there', async ({ page }) => {
  const { puzzle, path } = puzzleWithPar(4);
  await page.goto(board(puzzle, '?dev=0'));
  await solve(page, path);

  const scores = page.getByRole('region', { name: /Fewest guesses/ });
  await scores.getByRole('button', { name: /Take a name/ }).click();

  // Unique per run: these tests play against a real database, and a name is claimed for good.
  const name = `tester${Date.now().toString(36)}`;
  await scores.getByLabel('Name', { exact: true }).fill(name);
  await scores.getByLabel('Password', { exact: true }).fill('a good long password');
  await scores.getByRole('button', { name: /Take it/ }).click();

  await expect(scores.getByText(new RegExp(`Playing as ${name}`))).toBeVisible();
  // The round was already sent anonymously; registering named the player rather than making a
  // new one, so the row on the board is the same row.
  await expect(scores.getByRole('cell', { name: new RegExp(name) })).toBeVisible();
});

test('the board is never in the way of finishing', async ({ page }) => {
  const { puzzle, path } = puzzleWithPar(3);
  await page.goto(board(puzzle, '?dev=0'));
  await solve(page, path);

  // Everything the finished round says is there whatever the server did. The scoreboard is a
  // panel below it, and the result above the plate is untouched by any of this.
  await expect(page.getByRole('region', { name: /Result/ })).toBeVisible();
  await expect(page.getByRole('region', { name: /The round/ })).toBeVisible();
});
