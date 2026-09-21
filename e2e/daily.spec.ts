/**
 * What the daily game keeps being, now that there is a second one.
 *
 * Every other spec here asks whether the daily game works. This one asks a narrower and more
 * paranoid question: whether adding the explore mode moved anything about it. So each test
 * corresponds to a way the second game could reach into the first, and each was written after
 * finding that it had — or nearly had.
 *
 * Delete a test here only when the thing it is about has genuinely stopped being shared.
 */

import { expect, test } from '@playwright/test';
import { board, gameData, masthead, today, todayNumber } from './fixtures';

const { manifest } = gameData();

/** One board of each band, so every shape of daily figure is covered. */
function everyBand() {
  return manifest.bands.map((_, band) => ({ band, daily: today(band) }));
}

/**
 * **A game is not a destination.**
 *
 * The open game was put in the masthead beside the archive and the record, which was wrong
 * twice over. It is a game rather than a page about one, so it belongs where a game is chosen
 * — see `Boards`. And a fifth destination took the row over its measure so that it wrapped,
 * which is twenty-one pixels of plate the player does not get on every board, every day: the
 * camera fits the spine to the plate, so a shorter plate is the whole figure drawn smaller.
 *
 * So the destinations are the four they have always been, and this is what says so.
 */
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

/**
 * **And the switch still changes the day's length**, which is the control the open game's two
 * boards were added to. It is the one piece of daily chrome this touched at all.
 */
test('the board switch still opens the day’s other lengths', async ({ page }) => {
  const here = today(0);
  const other = today(1);
  test.skip(here.puzzle.id === other.puzzle.id, 'the two lengths are the same board today');

  await page.goto(board(here.puzzle));
  await page.getByRole('button', { name: /choose a board/i }).click();
  await page.getByRole('option', { name: /letters medium/i }).click();

  await expect(page).toHaveURL(new RegExp(`/${other.puzzle.id}$`));
  await expect(page.locator('header')).toContainText(other.puzzle.source);
  // The same day, a different length — not today's medium unless today is the day on screen.
  await expect(page.locator('header')).toContainText(`${here.day}`);
});

/**
 * **Fast travel is the explore mode's and must not leak into the daily game.**
 *
 * `MoveReadout` and `GuessBar` both learned about it, and both learned it as an *optional*
 * prop the daily board does not pass. If that ever became a default, a daily player typing a
 * word they had already reached would be silently moved there instead of being told it is not
 * a move — which is a refusal that carries real information about the graph.
 */
test('a daily board refuses a word it has reached rather than travelling to it', async ({
  page,
}) => {
  const { graph } = gameData();
  const daily = today();
  const { source } = daily.puzzle;
  // Two steps out, so the word we came from is genuinely not a move from where we end up —
  // the word you came from is always a move back, which is not a test of anything.
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

  // Now type the source, which is on the board and is not a move from here.
  await field.fill(source);
  await expect(page.getByText(/go to /i)).toBeHidden();
  await go.click();
  await expect(page.locator('#guess-error')).not.toHaveText('');
  // And the cursor did not move.
  await expect(page.getByText(new RegExp(`from\\s+${step!.two}`, 'i'))).toBeVisible();
});

/**
 * **A page's second segment survives a direct visit**, which is the one bit of App's routing
 * the explore mode changed.
 *
 * On a direct visit the loader resolves a board underneath the page and `show` rewrites the
 * address to that board's id; the page path is then put back. It used to be put back from the
 * page's own state, and now it is read off the original pathname before anything rewrites it —
 * a smaller and more general thing, which the rules page had no test for either way. Get it
 * wrong and `rules/phonemes` comes back as a bare `rules`, having lost which game.
 */
test('a direct visit to one game’s rules keeps which game', async ({ page }) => {
  const mode = manifest.modes.find((one) => one.name === 'phonemes');
  test.skip(!mode, 'no phonemes mode in this bank');

  await page.goto(`/rules/${mode!.name}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  // The address still names the game, and still does after the board underneath has loaded.
  await page.waitForTimeout(1500);
  await expect(page).toHaveURL(new RegExp(`/rules/${mode!.name}$`));
});

/**
 * And every one of them still goes where it went. The masthead is now shared with a screen
 * that is not a board, so a change made for that screen reaches this one.
 */
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

/**
 * **The board itself is still drawn the way it was.**
 *
 * Not a pixel comparison — that is `e2e/boards.spec.ts`'s job and it asserts nothing on
 * purpose. This is the structural claim underneath it: the plate is one SVG, its words carry
 * their own handles, and an edge is a group of lines with no wrapper around it. The last of
 * those is what the sprout animation nearly cost every daily board, by putting a group under
 * every edge of every figure so that the explore mode could hang a class on it.
 */
test('a daily edge is drawn without a wrapper around it', async ({ page }) => {
  await page.goto(board(today().puzzle));
  await expect(page.locator('main svg circle').first()).toBeVisible();

  const shape = await page.evaluate(() => {
    const edges = [...document.querySelectorAll('g[data-edge]')];
    return {
      edges: edges.length,
      // Children of an edge group are the lines themselves and the subword, never a group.
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

/**
 * **Nothing the explore mode writes down is in the daily game's storage**, and the other way
 * round. They key on different things and one of them is a different kind of store entirely;
 * what this guards is that opening a map has not started writing to the game slot.
 */
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
  // And it added no localStorage key of its own: a map lives in IndexedDB.
  expect(after.keys.filter((key) => key.includes('atlas'))).toEqual([]);
});

/** The day number the header quotes is still today's, which every other spec depends on. */
test('the header still says which day it is', async ({ page }) => {
  await page.goto(board(today().puzzle));
  await expect(page.locator('header')).toContainText(`${todayNumber()}`);
});
