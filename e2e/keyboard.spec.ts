/**
 * A board under an on-screen keyboard, and in a resized window.
 *
 * The keyboard lies over the board: nothing on it moves, and the guess bar rides on top of
 * the keyboard. No browser here opens one, so this stands in the visual viewport a keyboard
 * leaves: shorter, and panned down to the input. See viewport.ts.
 */

import { expect, test, type Page } from '@playwright/test';
import { canStart } from '../src/lib/atlas';
import { board, mapData, puzzleWithPar } from './fixtures';

const KEYBOARD = 300;

declare global {
  interface Window {
    keyboard(open: boolean): void;
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((covers) => {
    const view = Object.assign(new EventTarget(), {
      width: innerWidth,
      height: innerHeight,
      scale: 1,
      offsetLeft: 0,
      offsetTop: 0,
      pageLeft: 0,
      pageTop: 0,
    });
    Object.defineProperty(window, 'visualViewport', { value: view, configurable: true });
    window.keyboard = (open) => {
      view.height = innerHeight - (open ? covers : 0);
      // The browser pans down so the focused input clears the keyboard. See `onScreen`.
      view.pageTop = open ? covers : 0;
      view.dispatchEvent(new Event('resize'));
    };
  }, KEYBOARD);
});

/** Some word a map can start from. */
function startable(): string {
  const { graph, regions } = mapData();
  return regions.words(0).find((word) => canStart(graph, regions, word))!;
}

/** Reduced motion still runs every transition for a frame (index.css), so wait it out. */
async function still(page: Page) {
  await page.evaluate(() => Promise.all(document.getAnimations().map((one) => one.finished)));
}

/** Where things are on screen. */
async function onScreen(page: Page, open: boolean, word: string) {
  await page.evaluate((open) => window.keyboard(open), open);
  await still(page);
  // The browser's pan, as a scroll, so boxes are where a phone would draw them. After the
  // board has moved, or there is no page yet to scroll.
  await page.evaluate(() => window.scrollTo(0, window.visualViewport!.pageTop));
  const y = async (selector: string) => (await page.locator(selector).first().boundingBox())!;
  const field = await page.getByLabel(/Your guess/).boundingBox();
  const plate = await y('main');
  return {
    header: (await y('header')).y,
    plate: { y: plate.y, height: plate.height },
    word: (await y(`g[data-word="${word}"]`)).y,
    fieldBottom: field!.y + field!.height,
  };
}

async function liesOver(page: Page, word: string) {
  const visible = page.viewportSize()!.height - KEYBOARD;
  const before = await onScreen(page, false, word);
  const during = await onScreen(page, true, word);

  expect(during.header).toBeCloseTo(0, 0);
  expect(during.plate).toEqual(before.plate);
  expect(during.word).toBeCloseTo(before.word, 0);
  expect(during.fieldBottom).toBeLessThanOrEqual(visible + 1);

  expect(await onScreen(page, false, word)).toEqual(before);
}

test('a keyboard lies over the daily board, and the guess bar rides on it', async ({ page }) => {
  const { puzzle } = puzzleWithPar(3);
  await page.goto(board(puzzle));
  await expect(page.getByLabel(/Your guess/)).toBeVisible();
  await liesOver(page, puzzle.source);
});

test('and over the open map', async ({ page }) => {
  const word = startable();
  await page.goto('/explore/letters');
  await page.getByRole('textbox').first().fill(word);
  await page.getByRole('button', { name: 'Begin' }).click();
  await expect(page.getByLabel(/Your guess/)).toBeVisible();
  await liesOver(page, word);
});

test('a shorter window keeps both ends of the puzzle in shot', async ({ page }) => {
  const { puzzle } = puzzleWithPar(3);
  await page.goto(board(puzzle));
  await expect(page.getByLabel(/Your guess/)).toBeVisible();

  const { width, height } = page.viewportSize()!;
  await page.setViewportSize({ width, height: Math.round(height * 0.6) });
  await still(page);

  const plate = (await page.locator('main').boundingBox())!;
  for (const word of [puzzle.source, puzzle.target]) {
    const box = (await page.locator(`g[data-word="${word}"]`).boundingBox())!;
    expect(box.y, word).toBeGreaterThanOrEqual(plate.y);
    expect(box.y + box.height, word).toBeLessThanOrEqual(plate.y + plate.height);
  }
});
