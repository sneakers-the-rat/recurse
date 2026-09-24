/**
 * Screenshots of the open map at several sizes, at each viewport; the map's counterpart of
 * `boards.spec.ts`. Asserts nothing.
 *
 *     RECURSE_LOOK=1 npm run e2e -- e2e/atlas.spec.ts
 */

import { expect, test, type Page } from '@playwright/test';
import { mapData } from './fixtures';

test.skip(!process.env.RECURSE_LOOK, 'contact sheet: run with RECURSE_LOOK=1');

test.setTimeout(20 * 60 * 1000);

/** The word with the most common moves in the largest region of the letters map. */
function busiest(): string {
  const { graph, regions } = mapData();
  const biggest = [...Array(regions.count).keys()].sort(
    (one, two) => regions.words(two).length - regions.words(one).length,
  )[0]!;
  return regions
    .words(biggest)
    .slice()
    .sort((one, two) => graph.commonNeighbors(two).length - graph.commonNeighbors(one).length)[0]!;
}

/**
 * Make `moves` guesses with the dev bar's `fill` (unanimated; see AtlasDevBar.tsx), and return
 * how many words the map has.
 */
async function grow(page: Page, moves: number) {
  /** The count in the header, not the dev bar's copy. */
  const tally = async () =>
    Number(/FOUND\s+(\d+)/i.exec(await page.locator('header').innerText())?.[1] ?? '0');

  await page.getByLabel(/how many moves to walk/i).fill(String(moves));
  await page.getByRole('button', { name: /^fill$/ }).click();
  await expect.poll(tally, { timeout: 10 * 60 * 1000 }).toBeGreaterThan(1);
  await page.waitForTimeout(2000);
  return tally();
}

for (const size of [120, 600, 2000]) {
  test(`a map of about ${size} words`, async ({ page }, info) => {
    const from = busiest();
    await page.goto('/explore?dev=1');
    await page.getByRole('textbox').first().fill(from);
    await page.getByRole('button', { name: 'Begin' }).click();
    await expect(page.locator('svg[role="img"]')).toBeVisible();

    const grew = await grow(page, size);

    await page.getByRole('button', { name: /show the whole puzzle/i }).click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `e2e/shots/atlas-${info.project.name}-${grew}.png` });

    // Zoomed in about the middle, since the wheel zooms about the pointer and the framed map
    // may not reach the plate's corners.
    const plate = (await page.locator('main').boundingBox())!;
    await page.mouse.move(plate.x + plate.width / 2, plate.y + plate.height / 2);
    for (let step = 0; step < 8; step++) await page.mouse.wheel(0, -120);
    await page.waitForTimeout(600);
    await page.screenshot({ path: `e2e/shots/atlas-near-${info.project.name}-${grew}.png` });
  });
}
