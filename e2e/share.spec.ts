/**
 * Hints, and the end of a round: the score, the trail of marks, and the text a
 * player pastes somewhere.
 *
 * All of it in a real browser because all of it is behaviour the unit tests cannot
 * reach — a clipboard, a reload, and a plate you have to click to get anything out
 * of. `share.test.ts` covers what the text says; this covers that the game says it.
 */

import { expect, test, type Page } from '@playwright/test';
import { board, inShot, puzzleWithPar, result, staleVersionOf, tally } from './fixtures';

/** Chromium will only let the page read its own clipboard with these granted. */
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

async function guess(page: Page, word: string) {
  await page.getByLabel(/Your guess/).fill(word);
  await page.getByRole('button', { name: 'Guess', exact: true }).click();
}

/** Every unnamed word on the board, in the order the plate draws them. */
const dots = (page: Page) => page.locator('main svg circle[role="button"]');

test('a hint gives a letter count, then letters, and every click is counted', async ({ page }) => {
  const { puzzle } = puzzleWithPar(3);
  await page.goto(board(puzzle, '?dev=0'));
  await expect(dots(page).first()).toBeVisible();

  // An unnamed word: one that offers a letter count rather than a guess, and that is in
  // shot, since the board runs off the edges of the plate by design.
  const unnamed = await inShot(page, '[aria-label^="Unnamed word. Reveal"]');

  await unnamed.click();
  // First click: how many letters. The tally shows up beside the guesses.
  await expect(tally(page, 'hints')).toHaveText('1');
  const counted = page.locator('[aria-label^="Unnamed word, "]').first();
  await expect(counted).toHaveAttribute('aria-label', /\d+ letters\. Reveal another letter\./);

  // Second click: a letter, somewhere in the word, and a second hint on the tally.
  await counted.click();
  await expect(tally(page, 'hints')).toHaveText('2');
  await expect(counted).toHaveAttribute('aria-label', /showing [a-z·]+\. Reveal another letter\./);

  // Keep going and the word is simply there. Hints are unlimited on purpose.
  for (let i = 0; i < 30; i++) {
    const label = await counted.getAttribute('aria-label');
    if (label?.includes('Nothing left to hint')) break;
    await counted.click();
  }
  await expect(counted).toHaveAttribute('aria-label', /spelled [a-z]+\. Nothing left to hint\./);

  // And a click that buys nothing costs nothing: the tally stops where the word did.
  const before = await page.locator('header').innerText();
  await counted.click();
  expect(await page.locator('header').innerText()).toBe(before);

  // A reload redraws exactly: the same word, the same letters, in the same places.
  // Only the level is stored, so the order has to come back out of the word itself.
  const spelled = await counted.getAttribute('aria-label');
  await page.reload();
  await expect(dots(page).first()).toBeVisible();
  await expect(page.locator(`[aria-label="${spelled}"]`)).toHaveCount(1);
  // ...and the tally comes back with it, to the digit.
  expect(await page.locator('header').innerText()).toBe(before);

  // A few words at different levels, for eyeballing the ladder on the plate. Each is
  // taken from whatever is in shot, and hinting one takes it out of that pool, so the
  // three are different words.
  for (const clicks of [1, 3, 20]) {
    let dot;
    try {
      dot = await inShot(page, '[aria-label^="Unnamed word. Reveal"]');
    } catch {
      break;
    }
    const box = await dot.boundingBox();
    if (!box) break;
    // Clicked by position rather than through the locator: the accessible label is the
    // thing a hint changes, so an index into "unnamed words" points at a different word
    // after the first click, and the ladder would be spread over the whole board.
    const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    for (let i = 0; i < clicks; i++) await page.mouse.click(at.x, at.y);
  }
  await page.screenshot({ path: 'e2e/shots/hints.png' });
});

test('finishing a round offers the result to copy', async ({ page }) => {
  const { puzzle, path, wrongTurn } = puzzleWithPar(3);
  await page.goto(board(puzzle, '?dev=0'));
  await expect(dots(page).first()).toBeVisible();

  // Take one hint, then go the wrong way once before solving it — so the result has
  // something to say: a stray mark, a hint, and a score over par.
  await (await inShot(page, '[aria-label^="Unnamed word. Reveal"]')).click();
  await guess(page, wrongTurn);
  await guess(page, path[0]!);
  for (const word of path.slice(1)) await guess(page, word);

  const panel = result(page);
  await expect(panel).toContainText('Found it');
  // The score, both halves of it.
  await expect(panel).toContainText(`par ${puzzle.par}`);
  await expect(panel).toContainText('hints');
  // One mark per guess, in order, ending on the target — which is always on the
  // line, so the last mark is gold. The wrong turn is not: whether it reads as an
  // alternative or as a stray depends on whether the board had drawn it, and
  // share.test.ts is where that distinction is pinned.
  const trail = page.locator('[aria-label="Your route, as marks"]');
  await expect(trail).toHaveText(new RegExp(`^[🟨🟩🟥]{${puzzle.par + 1}}$`, 'u'));
  await expect(trail).toContainText('🟨');
  const marks = [...(await trail.innerText())];
  expect(marks.at(-1)).toBe('🟨');
  expect(marks.filter((mark) => mark !== '🟨')).not.toHaveLength(0);

  // The text itself is on screen, so copy and paste is possible whatever the
  // clipboard does, and the button copies exactly what is shown.
  const shown = await page.locator('pre').innerText();
  expect(shown).toContain('ReCurse Words · Day');
  expect(shown).toContain(`/${puzzle.id}`);
  expect(shown).toContain(`par ${puzzle.par}`);

  await page.getByRole('button', { name: 'Copy result' }).click();
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(shown);

  await page.screenshot({ path: 'e2e/shots/completed.png' });
});

/**
 * The whole point of the share: what somebody opens is the board, not a description of it.
 *
 * Which is two promises, and the second is the one worth guarding. The round comes back — the
 * same guesses, the same hints, the same trail — and none of it lands in the visitor's own
 * game: the game store is keyed by word pair, so a link that wrote itself down would overwrite
 * their progress on that puzzle with a stranger's and file a round they never played. See
 * lib/boardCode.ts and `frozen` in App.
 */
test('a shared link opens the round somebody played, and writes nothing down', async ({ page }) => {
  const { puzzle, path, wrongTurn } = puzzleWithPar(3);
  await page.goto(board(puzzle, '?dev=0'));
  await expect(dots(page).first()).toBeVisible();

  // A round with something in it, so the code has more than a chain to carry: one hint, one
  // wrong turn, then the answer.
  await (await inShot(page, '[aria-label^="Unnamed word. Reveal"]')).click();
  await guess(page, wrongTurn);
  // Back to the source, which is free and leaves no mark — and, being a move made from
  // somewhere other than where the last guess landed, is exactly the case a code has to
  // record a `stand` for.
  await guess(page, path[0]!);
  for (const word of path.slice(1)) await guess(page, word);

  // The figures, not the whole header: the masthead carries a Share button on the player's own
  // board and none on somebody else's, so the two headers are deliberately not the same string.
  const score = await page.locator('[data-tour="tally"] dd').allInnerTexts();
  const trail = await page.locator('[aria-label="Your route, as marks"]').innerText();
  // From the button and not from the text on screen: what is shown is the *plain* result,
  // whose link is the puzzle alone. Carrying the round is the other button's business — see
  // "the result offers the score and the board separately".
  await page.getByRole('button', { name: 'Copy with board' }).click();
  const link = (await page.evaluate(() => navigator.clipboard.readText()))
    .trim()
    .split('\n')
    .at(-1)!;
  // The board's own address, and the round hanging off it in base64url.
  expect(link).toMatch(new RegExp(`/${puzzle.id}/[A-Za-z0-9_-]+$`));

  // Now arrive as somebody who has never played this board.
  await page.evaluate(() => {
    localStorage.removeItem('recurse.games.v2');
    localStorage.removeItem('recurse.stats.v1');
  });
  await page.goto(link);

  // Their round, said to be theirs, down to the tallies in the header.
  await expect(page.getByRole('region', { name: /Someone else/ })).toBeVisible();
  await expect(result(page)).toContainText('Found it');
  expect(await page.locator('[aria-label="Your route, as marks"]').innerText()).toBe(trail);
  expect(await page.locator('[data-tour="tally"] dd').allInnerTexts()).toEqual(score);

  // And nothing written down: not the visitor's game, not their record.
  expect(
    await page.evaluate(() => [
      localStorage.getItem('recurse.games.v2'),
      localStorage.getItem('recurse.stats.v1'),
    ]),
  ).toEqual([null, null]);

  await page.screenshot({ path: 'e2e/shots/shared.png' });

  // Taking it over is a board of their own at the same address — the code is the whole of
  // what a shared board is, so dropping it is playing.
  await page.getByRole('button', { name: 'Play it yourself' }).click();
  await expect(page.getByRole('region', { name: /Someone else/ })).toHaveCount(0);
  await expect(page.getByLabel(/Your guess/)).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(`/${puzzle.id}`);
});

/**
 * Sharing a board part-played, from the masthead.
 *
 * The reason this exists rather than only the result box's button: a round is worth handing
 * over long before it is finished — "look what I'm stuck on" is most of what people send. The
 * format does not care whether the two ends have met, so nothing had to be added to it.
 *
 * It is in the masthead and not the menu on purpose, and the phone project is what checks
 * that: the four destinations fold into a hamburger at that width, and a share that costs
 * opening a menu first is a share nobody makes.
 */
test('the masthead hands on a board that is only part played', async ({ page }) => {
  const { puzzle, path } = puzzleWithPar(4);
  await page.goto(board(puzzle, '?dev=0'));
  await expect(dots(page).first()).toBeVisible();
  await guess(page, path[1]!);

  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(page.getByText('Board link copied')).toBeVisible();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toMatch(new RegExp(`/${puzzle.id}/[A-Za-z0-9_-]+$`));

  // And it opens as somebody else's board, part played — with no share button of its own,
  // because that round is not the visitor's to hand on.
  await page.goto(link);
  await expect(page.getByRole('region', { name: /Someone else/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Share', exact: true })).toHaveCount(0);
  await expect(tally(page, 'guessed')).toHaveText('1');
});

/**
 * Two things to copy, because a score and a solved board are two different things to hand over.
 *
 * The four lines are identical and the last line is not: one link is the puzzle, the other is
 * the round. That is the whole of the difference and it is what makes the plain one safe to
 * post where people have not played today yet — see `text` and `withBoard` in App's `result`.
 */
test('the result offers the score and the board separately', async ({ page }) => {
  const { puzzle, path } = puzzleWithPar(3);
  await page.goto(board(puzzle, '?dev=0'));
  await expect(dots(page).first()).toBeVisible();
  for (const word of path.slice(1)) await guess(page, word);

  await page.getByRole('button', { name: 'Copy result' }).click();
  const plain = await page.evaluate(() => navigator.clipboard.readText());
  await page.getByRole('button', { name: 'Copy with board' }).click();
  const withBoard = await page.evaluate(() => navigator.clipboard.readText());

  expect(plain.split('\n').slice(0, -1)).toEqual(withBoard.split('\n').slice(0, -1));
  expect(plain.trim().split('\n').at(-1)).toMatch(new RegExp(`/${puzzle.id}$`));
  expect(withBoard.trim().split('\n').at(-1)).toMatch(
    new RegExp(`/${puzzle.id}/[A-Za-z0-9_-]+$`),
  );

  // The text on screen is the plain one, so nobody pastes a solved board having only read the
  // four lines above it.
  await expect(page.locator('pre')).toContainText(`/${puzzle.id}`);
  await expect(page.locator('pre')).not.toContainText(withBoard.trim().split('\n').at(-1)!);
});

test('the result is still there on a later visit', async ({ page }) => {
  // The case this is for: solving today's puzzle in the morning and wanting the
  // score again in the evening, on a phone that threw the tab away in between.
  const { puzzle, path } = puzzleWithPar(3);
  await page.goto(board(puzzle, '?dev=0'));
  for (const word of path.slice(1)) await guess(page, word);

  const before = await page.locator('pre').innerText();
  await expect(result(page)).toContainText('Perfect');

  await page.reload();

  // Straight back to the completed view — not an empty guess bar on a solved board.
  await expect(result(page)).toContainText('Perfect');
  await expect(page.getByLabel(/Your guess/)).toHaveCount(0);
  expect(await page.locator('pre').innerText()).toBe(before);
});

/**
 * A round shared before the word list changed says so.
 *
 * The other half of the same trade. An id no longer depends on the word list, so the *board*
 * opens either way — but a code is a list of positions into lists that word list determines,
 * so it may name words nobody played. That is the failure a visitor cannot see, which is why
 * the code carries twelve bits of the vocabulary and the screen reads them. See `staleCode`.
 */
test('a round shared before the word list changed says so', async ({ page }) => {
  const { puzzle, path } = puzzleWithPar(3);
  await page.goto(board(puzzle, '?dev=0'));
  await expect(page.locator('header')).toContainText(puzzle.source);
  for (const word of path.slice(1)) await guess(page, word);

  await page.getByRole('button', { name: 'Copy with board' }).click();
  const link = (await page.evaluate(() => navigator.clipboard.readText()))
    .trim()
    .split('\n')
    .at(-1)!;

  // The same round, written against a word list this build has never seen. Built here rather
  // than kept as a fixture because what makes it stale is the *current* data moving, so a
  // stored string would stop being the thing under test at the next rebuild.
  await page.goto(`/${puzzle.id}/${staleVersionOf(link)}`);

  await expect(page.getByRole('region', { name: /Someone else/ })).toBeVisible();
  await expect(page.getByRole('region', { name: /Someone else/ })).toContainText(
    /fresh link/i,
  );
  // The board is still the board. That is the whole of what taking the vocabulary out of the
  // address bought: a stale link costs the round and never the board.
  await expect(page.locator('header')).toContainText(puzzle.source);
  await expect(page.locator('header')).toContainText(puzzle.target);
});
