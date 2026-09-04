/**
 * Hints, and the end of a round: the score, the trail of marks, and the text a
 * player pastes somewhere.
 *
 * All of it in a real browser because all of it is behaviour the unit tests cannot
 * reach — a clipboard, a reload, and a plate you have to click to get anything out
 * of. `share.test.ts` covers what the text says; this covers that the game says it.
 */

import { expect, test, type Page } from '@playwright/test';
import { board, inShot, puzzleWithPar, result } from './fixtures';

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
  await expect(page.locator('header')).toContainText('1 hint');
  const counted = page.locator('[aria-label^="Unnamed word, "]').first();
  await expect(counted).toHaveAttribute('aria-label', /\d+ letters\. Reveal another letter\./);

  // Second click: a letter, somewhere in the word, and a second hint on the tally.
  await counted.click();
  await expect(page.locator('header')).toContainText('2 hints');
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
