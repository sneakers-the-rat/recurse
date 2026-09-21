/**
 * The explore mode, played in a real browser.
 *
 * Words are taken off the shipped data rather than written down, the way every other spec here
 * does it — a rebuild moves which words are in which territory, and a test naming one would be
 * asserting the bank rather than the game.
 *
 * What is checked is the shape of the mode and not its taste: a map starts, grows, remembers
 * itself, travels, pays out and spends. Whether the map *reads* is the contact sheet's
 * question, which asserts nothing and is meant to be looked at.
 */

import { expect, test, type Page } from '@playwright/test';
import { gameData } from './fixtures';
import { buildRegions, type RawRegions } from '../src/lib/regions';
import { modeFile, type RawManifest } from '../src/lib/data';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data');

/** The letters map, read the way the app reads it. */
function map() {
  const manifest = JSON.parse(
    readFileSync(join(dataDir, 'puzzles', 'manifest.json'), 'utf8'),
  ) as RawManifest;
  const raw = JSON.parse(
    readFileSync(join(dataDir, modeFile('regions', 0, manifest)), 'utf8'),
  ) as RawRegions;
  return buildRegions(raw, gameData().graph.words);
}

/** A word with plenty of room around it, so a test can walk without running out. */
function busy(): string {
  const { graph } = gameData();
  const regions = map();
  const biggest = [...Array(regions.count).keys()].sort(
    (one, two) => regions.words(two).length - regions.words(one).length,
  )[0]!;
  return regions
    .words(biggest)
    .slice()
    .sort((one, two) => graph.commonNeighbors(two).length - graph.commonNeighbors(one).length)[0]!;
}

const guessField = (page: Page) => page.getByLabel(/Your guess/);

/**
 * Start a letters map at `word` and wait for the board.
 *
 * Straight to the game's own address, which is where the board switch sends you: with no map
 * of it yet that is the list, ready to make one of this game. See `open` in Explore.tsx.
 */
async function start(page: Page, word: string, search = '') {
  await page.goto(`/explore/letters${search}`);
  await page.getByRole('textbox').first().fill(word);
  await page.getByRole('button', { name: 'Begin' }).click();
  await expect(page.locator('svg[role="img"]')).toBeVisible();
  await expect(page.locator(`g[data-word="${word}"]`)).toBeVisible();
}

/** Everything drawn, and everything reached. */
async function drawn(page: Page) {
  return page.locator('g[data-word]').evaluateAll((nodes) =>
    nodes.map((node) => (node as HTMLElement).dataset.word ?? ''),
  );
}

async function guess(page: Page, word: string) {
  await guessField(page).fill(word);
  await page.getByRole('button', { name: 'Guess', exact: true }).click();
}

/** How many words the map says have been found. */
async function tally(page: Page): Promise<number> {
  const text = await page.locator('header').innerText();
  return Number(/FOUND\s+(\d+)/i.exec(text)?.[1] ?? '0');
}

test('a map starts from a typed word and draws what is one move from it', async ({ page }) => {
  const { graph } = gameData();
  const from = busy();
  await start(page, from);

  // The rim: every common neighbour of the start is on the board, unnamed.
  const board = new Set(await drawn(page));
  for (const near of graph.commonNeighbors(from).slice(0, 6)) {
    expect(board, `${near} should be on the rim of ${from}`).toContain(near);
  }
  expect(await tally(page)).toBe(1);
});

test('refuses a word with nowhere to go, and says why', async ({ page }) => {
  const { graph } = gameData();
  const regions = map();
  const lonely = graph.words.find(
    (word) => graph.isCommon(word) && !regions.has(word) && word.length > 3,
  );
  test.skip(!lonely, 'every common word is on the map');

  await page.goto('/explore/letters');
  await page.getByRole('textbox').first().fill(lonely!);
  await page.getByRole('button', { name: 'Begin' }).click();
  await expect(page.getByText(/nowhere to go/i)).toBeVisible();
  await expect(page.locator('svg[role="img"]')).toBeHidden();
});

test('a guess is free, and what it lands on is drawn with its own moves around it', async ({
  page,
}) => {
  const { graph } = gameData();
  const from = busy();
  const next = graph.commonNeighbors(from)[0]!;
  await start(page, from);
  await guess(page, next);

  await expect(page.locator(`g[data-word="${next}"] text.word`)).toHaveText(next);
  expect(await tally(page)).toBe(2);
  // And the guess bar is now standing on it.
  await expect(page.getByText(new RegExp(`from\\s+${next}`, 'i'))).toBeVisible();
});

test('typing somewhere already found goes there rather than being refused', async ({ page }) => {
  const { graph } = gameData();
  const from = busy();
  /*
    Two steps out, because the word you came from is always a move *back*.

    Travel is what happens when nothing plays, so a test of it has to stand somewhere the
    start is genuinely not reachable from — which is any word two moves away that is not
    itself beside the start.
  */
  const near = new Set(graph.commonNeighbors(from));
  const step = graph
    .commonNeighbors(from)
    .map((one) => ({
      one,
      two: graph.commonNeighbors(one).find((w) => w !== from && !near.has(w)),
    }))
    .find((pair) => pair.two !== undefined);
  test.skip(!step, 'no two-step walk out of the busiest word');

  await start(page, from);
  await guess(page, step!.one);
  await guess(page, step!.two!);
  expect(await tally(page)).toBe(3);

  await guessField(page).fill(from);
  await expect(page.getByText(new RegExp(`go to ${from}`, 'i'))).toBeVisible();
  await page.getByRole('button', { name: 'Guess', exact: true }).click();
  await expect(page.getByText(new RegExp(`from\\s+${from}`, 'i'))).toBeVisible();
  // Travel is not discovery: nothing new was found.
  expect(await tally(page)).toBe(3);
});

/**
 * Open the missions drawer, which is shut when a map opens.
 *
 * Shut because the table is five lines over a board that wants the height — see `Missions`. So
 * every test of what is in it has to open it first, and what the shut line says is a test of its
 * own.
 */
async function showMissions(page: Page) {
  await page.getByRole('button', { name: /show missions/i }).click();
}

/** The rows with a *Take* on them, which is what an offer is and a mission in hand is not. */
function onOffer(page: Page) {
  return page
    .locator('li')
    .filter({ has: page.getByRole('button', { name: /^take$/i }) });
}

/**
 * The words currently on offer, exactly.
 *
 * Read out and compared rather than matched with `hasText`, which is a substring: an offer of
 * `abort` is replaced by the next word at its own distance, and at that rung the next word
 * alphabetically was `aborts`.
 */
async function offered(page: Page): Promise<string[]> {
  return (await onOffer(page).allInnerTexts()).map((row) => row.trim().split(/\s+/)[0]!);
}

test('missions name a word and what it pays, and never say where from', async ({ page }) => {
  await start(page, busy());
  await showMissions(page);
  await expect(onOffer(page).first()).toBeVisible();

  const text = await onOffer(page).first().innerText();
  // How far out, and what it pays. Never which found word it is that far from.
  expect(text).toMatch(/\d+ away/i);
  expect(text).toMatch(/\+\d+/);
});

/**
 * **The drawer is shut and still says what is in it**, which is the whole reason it may be shut:
 * the two things worth knowing without opening it are how many slots are full and how many words
 * are on the table.
 */
test('the missions drawer folds away, and says what it holds while it is shut', async ({
  page,
}) => {
  await start(page, busy());
  const line = page.getByRole('button', { name: /show missions/i });
  await expect(line).toHaveAttribute('aria-expanded', 'false');
  await expect(line).toContainText(/0 of \d+ in hand/i);
  await expect(line).toContainText(/\d+ on offer/i);
  await expect(onOffer(page)).toHaveCount(0);

  await showMissions(page);
  await expect(page.getByRole('button', { name: /hide missions/i })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect(onOffer(page).first()).toBeVisible();
});

test('a mission is taken into a slot, and there are only so many', async ({ page }) => {
  await start(page, busy());
  await showMissions(page);
  const empty = page.getByText(/empty slot/i);
  const gaveUp = page.getByRole('button', { name: /give up/i });
  const takes = page.getByRole('button', { name: /^take$/i });

  // Every slot is drawn whether or not there is anything in it, which is how the player can
  // see there is a limit before they meet it.
  const slots = await empty.count();
  expect(slots).toBeGreaterThan(0);

  const before = await offered(page);
  await takes.first().click();
  await expect(empty).toHaveCount(slots - 1);
  await expect(gaveUp).toHaveCount(1);
  // Taken is no longer offered, and its place on the table is filled.
  expect(await offered(page)).not.toContain(before[0]);
  expect(await offered(page)).toHaveLength(before.length);

  // Fill the rest: with every slot full nothing more can be accepted, and the button says so
  // rather than disappearing.
  for (let n = 1; n < slots; n++) await takes.first().click();
  await expect(empty).toHaveCount(0);
  await expect(gaveUp).toHaveCount(slots);
  await expect(takes.first()).toBeDisabled();

  // Given up one at a time, each freeing its own slot.
  await gaveUp.first().click();
  await expect(empty).toHaveCount(1);
  await expect(gaveUp).toHaveCount(slots - 1);
  await expect(takes.first()).toBeEnabled();
});

/**
 * The instruments, which are the same `?dev` the daily board has and almost none of the same
 * controls — see `AtlasDevBar`. The two walks are what is worth a test: the contact sheet builds
 * its maps with `fill`, so a map of two thousand words rests on that working, and `walk` is the
 * one a person reaches for.
 */
test('the instrument panel grows a map without anybody typing', async ({ page }) => {
  await start(page, busy(), '?dev=1');
  expect(await tally(page)).toBe(1);

  await page.getByLabel(/how many moves to walk/i).fill('12');
  await page.getByRole('button', { name: /^fill$/ }).click();
  await expect.poll(() => tally(page)).toBeGreaterThan(5);
});

/**
 * And `walk` plays the same run **one guess at a time**, which is the only way the question the
 * panel exists for — what does a guess onto a hub look like arriving — can be answered at all.
 *
 * Asserted as the tally climbing rather than arriving: a walk made all at once is one number one
 * frame later, and that is exactly what this is not.
 */
test('a walk is played one guess at a time', async ({ page }) => {
  await start(page, busy(), '?dev=1');

  await page.getByLabel(/how many moves to walk/i).fill('6');
  await page.getByRole('button', { name: /^walk$/ }).click();
  // The key offers to call it off while one is running, which is the whole reason it says so.
  await expect(page.getByRole('button', { name: /^stop$/ })).toBeVisible();

  await expect.poll(() => tally(page), { timeout: 30_000 }).toBeGreaterThan(1);
  const partway = await tally(page);
  await expect
    .poll(() => tally(page), { timeout: 60_000 })
    .toBeGreaterThan(partway);
  await expect(page.getByRole('button', { name: /^walk$/ })).toBeVisible({ timeout: 60_000 });
});

/**
 * **A move between two words the player has found is drawn as a move they have**, whether or not
 * they typed it. On a daily board that would contradict par; here there is no par and nothing to
 * be earnt by typing a word you are already looking at.
 *
 * Tested through a *drop*, because a drop is the one way to put a word on the map with no move
 * behind it: nothing is in the log, so the line between it and the word beside it can only be
 * gilt because both ends are found.
 */
test('a move between two found words is drawn as one, typed or not', async ({ page }) => {
  const { graph } = gameData();
  const from = busy();
  const rim = graph.commonNeighbors(from)[0]!;
  await start(page, from, '?dev=1');

  // Mana enough to buy anything, then the power, then the word typed into the guess field.
  await page.getByRole('button', { name: /^pay$/ }).click();
  await page.getByRole('button', { name: /drop a word/i }).click();
  await guess(page, rim);
  await expect(page.locator(`g[data-word="${rim}"] text.word`)).toHaveText(rim);

  const key = [from, rim].sort().join(' ');
  await expect(page.locator(`g[data-edge="${key}"] line`).first()).toHaveAttribute(
    'stroke',
    'var(--color-gilt)',
  );
});

test('a power says what to do next, and refuses what cannot be paid for', async ({ page }) => {
  const { graph } = gameData();
  const from = busy();
  await start(page, from);

  await page.getByRole('button', { name: /count letters/i }).click();
  await expect(page.getByText(/tap a word you have not found/i)).toBeVisible();

  // Nothing has been earned yet, so the next tap is refused rather than spending nothing.
  const rim = graph.commonNeighbors(from)[0]!;
  await page.locator(`g[data-word="${rim}"] circle[role="button"]`).click();
  await expect(page.getByText(/not enough mana/i)).toBeVisible();
});

test('a map keeps itself, and comes back where it was left', async ({ page }) => {
  const { graph } = gameData();
  const from = busy();
  const next = graph.commonNeighbors(from)[0]!;
  await start(page, from);
  await guess(page, next);

  const at = page.url();
  const before = await camera(page);
  // The map is written down on a pause, so give it one.
  await page.waitForTimeout(1400);
  await page.reload();

  await expect(page.locator(`g[data-word="${next}"] text.word`)).toHaveText(next);
  expect(page.url()).toBe(at);
  expect(await tally(page)).toBe(2);

  /*
    And looking at the same place from the same distance, which is half of what coming back to
    a map you know even means.

    The camera and not the `viewBox`: the two are the same fact but the box is the camera
    *through the plate's pixel size*, and the plate is a few pixels taller or shorter depending
    on whether the missions row has wrapped. Asserting the box compares the window to the
    furniture around it.
  */
  const after = await camera(page);
  expect(after.cx).toBeCloseTo(before.cx, 1);
  expect(after.cy).toBeCloseTo(before.cy, 1);
  expect(after.width).toBeCloseTo(before.width, 1);
});

/** Where the map is being looked at from, read off the one transform the plate has. */
async function camera(page: Page) {
  const box = (await page.locator('svg[role="img"]').getAttribute('viewBox'))!;
  const [x, y, width, height] = box.split(' ').map(Number) as [number, number, number, number];
  return { cx: x + width / 2, cy: y + height / 2, width };
}

/**
 * **Which map of a game is in front of you is the one you opened last**, and two made on the same
 * day have to be told apart.
 *
 * This is the whole of how the mode is addressed: `explore/letters` names the *game*, so nothing
 * in the path says which map, and the store answers. It answered with a `YYYY-MM-DD`, which two
 * maps made today tie on — and what broke the tie was IndexedDB's key order over random ids, so
 * making a second map opened the first one instead. See `opened` in atlasStore.
 */
test('a new map is the one that opens, and so is one picked off the list', async ({ page }) => {
  const { graph } = gameData();
  const first = busy();
  // A second start word in the same game, so both maps are letters maps made the same day.
  const second = graph.commonNeighbors(first)[0]!;

  await start(page, first);
  await page.waitForTimeout(1400);

  // A second map, made from the list. It is the one that opens.
  await page.getByRole('button', { name: /^maps$/i }).click();
  await page.getByLabel(/start from/i).fill(second);
  await page.getByRole('button', { name: 'Begin' }).click();
  await expect(page.locator(`g[data-word="${second}"] text.word`)).toHaveText(second);
  expect(await tally(page)).toBe(1);

  // And going back to the first one off the list — where a map's own name is what opens it —
  // opens *that* one, and puts it back at the head of the list.
  await page.waitForTimeout(1400);
  await page.getByRole('button', { name: /^maps$/i }).click();
  await expect(page.locator('main li button').first()).toHaveText(second);
  await page.getByRole('button', { name: first, exact: true }).click();
  await expect(page.locator(`g[data-word="${first}"] text.word`)).toHaveText(first);

  // A reload comes back to it too, the path naming the game rather than the map.
  await page.waitForTimeout(1400);
  await page.reload();
  await expect(page.locator(`g[data-word="${first}"] text.word`)).toHaveText(first);
});

test('the list holds every map, and can lose one', async ({ page }) => {
  const from = busy();
  await start(page, from);
  await page.waitForTimeout(1400);

  // The list hangs off the map, the switch offering boards rather than lists of them.
  await page.getByRole('button', { name: /^maps$/i }).click();
  await expect(page.getByRole('button', { name: from, exact: true })).toBeVisible();

  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: /^delete$/i }).first().click();
  await expect(page.getByText(/no maps yet/i)).toBeVisible();
});

/**
 * **The open game is a board in the switch, beside the six the day offers**, and going to one
 * and back is the same gesture as changing length. That is the whole of how it is reached:
 * it is a game, not a page about one.
 */
test('the switch offers both maps, and goes back to a daily board', async ({ page }) => {
  await start(page, busy());
  await expect(page).toHaveURL(/\/explore\/letters$/);

  const boards = page.getByRole('button', { name: /choose a board/i });
  await boards.click();
  await expect(page.getByRole('option', { name: /explore letters/i })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('option', { name: /explore phonemes/i })).toBeVisible();

  // Off to a daily board, which is a board id and not a page.
  await page.getByRole('option', { name: /letters medium/i }).click();
  await expect(page).toHaveURL(/\/[0-9a-f]{4,}$/);
  await expect(page.locator('main svg circle').first()).toBeVisible();

  // And back to the map that was open, which is remembered rather than addressed.
  await boards.click();
  await page.getByRole('option', { name: /explore letters/i }).click();
  await expect(page).toHaveURL(/\/explore\/letters$/);
  await expect(page.locator(`g[data-word="${busy()}"]`)).toBeVisible();
});
