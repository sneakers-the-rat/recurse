/**
 * A contact sheet for judging the layout: one shot per puzzle, at each viewport.
 *
 * Scratch instrument, not an assertion. Deleted when the layout stops being worked
 * on; while it is, `npx playwright test boards` is how a change to the forces gets
 * looked at rather than argued about.
 */

import { expect, test } from '@playwright/test';
import { board, gameData } from './fixtures';

const { puzzles } = gameData();

// Screenshots cost the suite more than every assertion in it put together — a page
// load and a PNG encode each, eight of them, contending with the tests that actually
// check something. Run them when looking at the layout: `RECURSE_LOOK=1 npm run e2e`.
test.skip(!process.env.RECURSE_LOOK, 'contact sheet: run with RECURSE_LOOK=1');

// The worst case for label overlap: every word on the board showing its spelling.
for (const i of [0, 4]) {
  test(`labels ${i}: ${puzzles[i]!.source} to ${puzzles[i]!.target}`, async ({ page }, info) => {
    await page.goto(board(puzzles[i]!, '?dev'));
    await expect(page.locator('main svg circle').first()).toBeVisible();
    await page.getByRole('button', { name: 'name all' }).click();
    await page.getByLabel('Hide dev mode').click();
    // The re-settle a wider footprint asks for is animated, so let it finish.
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `e2e/shots/labels-${info.project.name}-${i}.png` });
  });
}

for (const i of [0, 2, 4, 5]) {
  test(`board ${i}: ${puzzles[i]!.source} to ${puzzles[i]!.target} (par ${puzzles[i]!.par})`, async ({
    page,
  }, info) => {
    await page.goto(board(puzzles[i]!, '?dev=0'));
    await expect(page.locator('main svg circle').first()).toBeVisible();
    await page.screenshot({ path: `e2e/shots/look-${info.project.name}-${i}.png` });
  });
}
