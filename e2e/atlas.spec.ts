/**
 * A contact sheet for judging the map: one shot per size, at each viewport.
 *
 * The same instrument `boards.spec.ts` is for the daily figure, asking the same question about
 * a different thing. What the daily sheet is looking for is whether thirty words and their
 * labels fit; what this is looking for is whether a map of a thousand *reads* — whether the
 * territories are places, whether the crossings between them say anything, and at what size it
 * stops being a picture of the language and becomes a smear.
 *
 * Asserts nothing. Change a force, re-shoot, look.
 *
 *     RECURSE_LOOK=1 npm run e2e -- e2e/atlas.spec.ts
 */

import { expect, test, type Page } from '@playwright/test';
import { gameData } from './fixtures';
import { buildRegions, type RawRegions } from '../src/lib/regions';
import { modeFile, type RawManifest } from '../src/lib/data';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

test.skip(!process.env.RECURSE_LOOK, 'contact sheet: run with RECURSE_LOOK=1');

// A map of two thousand is two thousand guesses, each of them judged and played for real.
test.setTimeout(20 * 60 * 1000);

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data');

/** The busiest word of the biggest territory: somewhere with room to grow in every direction. */
function busiest(): string {
  const manifest = JSON.parse(
    readFileSync(join(dataDir, 'puzzles', 'manifest.json'), 'utf8'),
  ) as RawManifest;
  const regions = buildRegions(
    JSON.parse(readFileSync(join(dataDir, modeFile('regions', 0, manifest)), 'utf8')) as RawRegions,
    gameData().graph.words,
  );
  const { graph } = gameData();
  const biggest = [...Array(regions.count).keys()].sort(
    (one, two) => regions.words(two).length - regions.words(one).length,
  )[0]!;
  return regions
    .words(biggest)
    .slice()
    .sort((one, two) => graph.commonNeighbors(two).length - graph.commonNeighbors(one).length)[0]!;
}

/**
 * Grow a map by making `moves` guesses, and say how many words it came to.
 *
 * **Through the instrument panel, which plays them for real.** `fill` is `wander` in atlas.ts:
 * a word already found that still has somewhere to go, one of the places it goes, over and
 * over, every one of them through the same `guess` a typed word goes through. So what is shot
 * is a map somebody could have played, which is the only kind worth judging the layout on.
 *
 * It used to type every word into the guess bar from here, two fills and two clicks per word,
 * and a map of two thousand was most of an hour of round trips through the DOM. The run is one
 * click.
 *
 * **`fill` and not `walk`.** The bar has both, and the difference is animation: `walk` plays the
 * run one guess at a time so that an arrival can be watched, which for two thousand moves is
 * half an hour. What this wants is the map, not the growing of it.
 */
async function grow(page: Page, moves: number) {
  /** The map's own tally, which is in the header and so clear of the bar's copy of it. */
  const tally = async () =>
    Number(/FOUND\s+(\d+)/i.exec(await page.locator('header').innerText())?.[1] ?? '0');

  await page.getByLabel(/how many moves to walk/i).fill(String(moves));
  await page.getByRole('button', { name: /^fill$/ }).click();
  // The whole walk is one synchronous pass, then one arrangement, then the ooze into it.
  await expect.poll(tally, { timeout: 10 * 60 * 1000 }).toBeGreaterThan(1);
  await page.waitForTimeout(2000);
  return tally();
}

for (const size of [120, 600, 2000]) {
  test(`a map of about ${size} words`, async ({ page }, info) => {
    const from = busiest();
    // `?dev` survives the client-side move onto the board, which is what puts the walk within
    // reach — see `useDevMode`.
    await page.goto('/explore?dev=1');
    await page.getByRole('textbox').first().fill(from);
    await page.getByRole('button', { name: 'Begin' }).click();
    await expect(page.locator('svg[role="img"]')).toBeVisible();

    const grew = await grow(page, size);

    // Framed whole, which is the view this is about: whether the map is a shape at the size
    // it actually comes to.
    await page.getByRole('button', { name: /show the whole puzzle/i }).click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `e2e/shots/atlas-${info.project.name}-${grew}.png` });

    /*
      And again at reading distance, which is the other thing worth looking at: whether a
      territory is legible from inside it.

      **On the middle of the plate**, because the wheel zooms about the pointer: a map framed
      whole sits in the middle of a plate wider than it is, and a fixed point near the corner
      was over nothing at all — eight steps in on empty space and the shot came back blank.
    */
    const plate = (await page.locator('main').boundingBox())!;
    await page.mouse.move(plate.x + plate.width / 2, plate.y + plate.height / 2);
    for (let step = 0; step < 8; step++) await page.mouse.wheel(0, -120);
    await page.waitForTimeout(600);
    await page.screenshot({ path: `e2e/shots/atlas-near-${info.project.name}-${grew}.png` });
  });
}
