/**
 * Developer mode: stepping the bank, and a contact sheet of boards to eyeball.
 */

import { expect, test } from '@playwright/test';

/** Chromium will only let the page read its own clipboard with these granted. */
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });
import { board, gameData, inShot, puzzleWithPar, result, today } from './fixtures';

test('steps through the bank', async ({ page }) => {
  // What the bar counts is the *calendar*, so it says which day this is and not where the
  // board sits in the shard in memory. Starting from today rather than from the first entry
  // of that shard, because one shard holds every 256th day and its array order is not the
  // calendar's — taking the two for each other is what made this expect day 1 of a shard
  // whose earliest day was 3.
  const here = today();
  await page.goto(board(here.puzzle, '?dev'));

  const bar = page.locator('text=DEV').locator('..');
  await expect(bar).toContainText(`${here.day + 1}/`);

  await page.getByLabel('Next puzzle').click();
  await expect(bar).toContainText(`${here.day + 2}/`);

  await page.getByLabel('Previous puzzle').click();
  await expect(bar).toContainText(`${here.day + 1}/`);

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

/**
 * The code inspector: a shared board's code, taken apart against the board on screen.
 *
 * The one thing about the format that cannot be checked by reading the source, because what a
 * code says is a fact about a real bank — `explain` reads the actual characters, and this is
 * that reading reaching a screen. `boardCode.test.ts` covers what the reading *is*; this covers
 * that the bar can be handed a code and will show it.
 *
 * The whole URL is pasted, not the bare code, because that is what anybody actually has to
 * hand — an address bar or a message from a friend.
 */
test('takes a shared board’s code apart', async ({ page }) => {
  const { puzzle, path } = puzzleWithPar(4);
  await page.goto(board(puzzle, '?dev'));
  await expect(page.locator('main svg circle').first()).toBeVisible();
  for (const word of path.slice(1)) {
    await page.getByLabel(/Your guess/).fill(word);
    await page.getByRole('button', { name: 'Guess', exact: true }).click();
  }

  await page.getByRole('button', { name: 'Copy with board' }).click();
  const link = (await page.evaluate(() => navigator.clipboard.readText())).trim().split('\n').at(-1)!;

  await page.getByRole('textbox', { name: 'A board code to read' }).fill(link);
  // The button and not Enter: `Key` is `type="button"` by design, so a submit-only reader
  // left the button dead — which is how this got here.
  await page.getByRole('button', { name: 'read' }).click();

  // Where the length goes, what it says, and the dump. The first is the reason it exists.
  await expect(page.getByText('Where the length goes')).toBeVisible();
  await expect(page.getByText('What it says')).toBeVisible();
  await expect(page.getByText('Field by field')).toBeVisible();
  // A guess is a position in the list of moves from where the player stood — the claim the
  // whole format rests on, said here in words.
  await expect(page.getByText(/moves from/).first()).toBeVisible();
  await page.screenshot({ path: 'e2e/shots/dev-code.png' });

  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByText('Where the length goes')).toHaveCount(0);
});

/**
 * A code that cannot be read says so.
 *
 * **Cut short, because that is the refusal the format guarantees.** A code ends in a terminator,
 * so a paste missing its tail is refused outright. There is no checksum, so a *whole* code from
 * another board is as likely to decode into some other legal round as to be turned down —
 * asserting that would be asserting a coin flip. Given the id as well, none of it arises: the
 * inspector fetches that board and reads the code against it, which is the case above.
 */
test('says so when a code cannot be read', async ({ page }) => {
  const { puzzle, path } = puzzleWithPar(3);
  await page.goto(board(puzzle, '?dev'));
  await expect(page.locator('main svg circle').first()).toBeVisible();
  for (const word of path.slice(1)) {
    await page.getByLabel(/Your guess/).fill(word);
    await page.getByRole('button', { name: 'Guess', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Copy with board' }).click();
  const link = (await page.evaluate(() => navigator.clipboard.readText())).trim().split('\n').at(-1)!;
  const code = new URL(link).pathname.split('/').filter(Boolean).at(-1)!;

  // Its own code, one character short: the terminator is gone, so there is no whole round in it.
  await page.getByRole('textbox', { name: 'A board code to read' }).fill(code.slice(0, -1));
  await page.getByRole('button', { name: 'read' }).click();
  await expect(page.getByText(/Nothing read/)).toBeVisible();
});
