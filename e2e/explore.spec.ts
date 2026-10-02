/**
 * The open map in a browser: starting, guessing, travel, missions, powers, the dev bar, saving
 * and the list of maps. Words come from the shipped data. Layout is `atlas.spec.ts`'s job.
 */

import { expect, test, type Page } from '@playwright/test';
import { mapData } from './fixtures';

/** The word with the most common moves in the largest region. */
function busy(): string {
  const { graph, regions } = mapData();
  const biggest = [...Array(regions.count).keys()].sort(
    (one, two) => regions.words(two).length - regions.words(one).length,
  )[0]!;
  return regions
    .words(biggest)
    .slice()
    .sort((one, two) => graph.commonNeighbors(two).length - graph.commonNeighbors(one).length)[0]!;
}

const guessField = (page: Page) => page.getByLabel(/Your guess/);

/** Start a letters map at `word` from `/explore/letters`, and wait for the board. */
async function start(page: Page, word: string, search = '') {
  await page.goto(`/explore/letters${search}`);
  await page.getByRole('textbox').first().fill(word);
  await page.getByRole('button', { name: 'Begin' }).click();
  await expect(page.locator('svg[role="img"]')).toBeVisible();
  await expect(page.locator(`g[data-word="${word}"]`)).toBeVisible();
}

/** Every word drawn, found or not. */
async function drawn(page: Page) {
  return page.locator('g[data-word]').evaluateAll((nodes) =>
    nodes.map((node) => (node as HTMLElement).dataset.word ?? ''),
  );
}

async function guess(page: Page, word: string) {
  await guessField(page).fill(word);
  await page.getByRole('button', { name: 'Guess', exact: true }).click();
}

async function tally(page: Page): Promise<number> {
  const text = await page.locator('header').innerText();
  return Number(/FOUND\s+(\d+)/i.exec(text)?.[1] ?? '0');
}

test('a map starts from a typed word and draws what is one move from it', async ({ page }) => {
  const { graph } = mapData();
  const from = busy();
  await start(page, from);

  // The rim: the start's common neighbours, drawn unnamed.
  const board = new Set(await drawn(page));
  for (const near of graph.commonNeighbors(from).slice(0, 6)) {
    expect(board, `${near} should be on the rim of ${from}`).toContain(near);
  }
  expect(await tally(page)).toBe(1);
});

test('refuses a word with nowhere to go, and says why', async ({ page }) => {
  const { graph, regions } = mapData();
  const lonely = graph.words.find(
    (word) => graph.isCommon(word) && !regions.has(word) && word.length > 3,
  );
  test.skip(!lonely, 'every common word is on the map');

  await page.goto('/explore/letters');
  await page.getByRole('textbox').first().fill(lonely!);
  await page.getByRole('button', { name: 'Begin' }).click();
  await expect(page.getByText(/not on the map/i)).toBeVisible();
  await expect(page.locator('svg[role="img"]')).toBeHidden();
});

test('a guess is free, and what it lands on is drawn with its own moves around it', async ({
  page,
}) => {
  const { graph } = mapData();
  const from = busy();
  const next = graph.commonNeighbors(from)[0]!;
  await start(page, from);
  await guess(page, next);

  await expect(page.locator(`g[data-word="${next}"] text.word`)).toHaveText(next);
  expect(await tally(page)).toBe(2);
  await expect(page.getByText(new RegExp(`from\\s+${next}`, 'i'))).toBeVisible();
});

// Unlike the daily board, the map draws a subword only for moves of the word under the pointer.
test('a subword is drawn for the move under the pointer and no other', async ({ page }) => {
  const { graph } = mapData();
  const from = busy();
  const next = graph.commonNeighbors(from)[0]!;
  const sub = graph.findMove(from, next)!.sub;
  await start(page, from);
  await guess(page, next);

  const words = page.locator('svg[role="img"] text.word');
  // Only the two found words are named.
  await expect(words).toHaveCount(2);
  await expect(words.filter({ hasText: new RegExp(`^${sub}$`) })).toHaveCount(0);

  const mark = (await page.locator(`g[data-word="${from}"]`).boundingBox())!;
  await page.mouse.move(mark.x + mark.width / 2, mark.y + mark.height / 2);
  await expect(words.filter({ hasText: new RegExp(`^${sub}$`) })).toHaveCount(1);

  await page.mouse.move(mark.x + mark.width / 2, mark.y - 240);
  await expect(words).toHaveCount(2);
});

test('typing somewhere already found goes there rather than being refused', async ({ page }) => {
  const { graph } = mapData();
  const from = busy();
  // Travel happens only when nothing plays, so stand two moves out, where the start is no move.
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
  expect(await tally(page)).toBe(3);
});

/** Open the missions drawer, which starts shut. */
async function showMissions(page: Page) {
  await page.getByRole('button', { name: /show missions/i }).click();
}

/** Rows with a Take button: offers, not missions in hand. */
function onOffer(page: Page) {
  return page
    .locator('li')
    .filter({ has: page.getByRole('button', { name: /^take$/i }) });
}

/** The words on offer, compared exactly: `hasText` matches substrings (`abort`, `aborts`). */
async function offered(page: Page): Promise<string[]> {
  return (await onOffer(page).allInnerTexts()).map((row) => row.trim().split(/\s+/)[0]!);
}

test('missions name a word and what it pays, and never say where from', async ({ page }) => {
  await start(page, busy());
  await showMissions(page);
  await expect(onOffer(page).first()).toBeVisible();

  const text = await onOffer(page).first().innerText();
  expect(text).toMatch(/\d+ away/i);
  expect(text).toMatch(/\+\d+/);
});

test('the missions drawer folds away, and says what it holds while it is shut', async ({
  page,
}) => {
  await start(page, busy());
  const line = page.getByRole('button', { name: /show missions/i });
  await expect(line).toHaveAttribute('aria-expanded', 'false');
  await expect(line).toContainText(/0 of \d+ active/i);
  await expect(line).toContainText(/\d+ available/i);
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

  // Every slot is drawn, empty or not.
  const slots = await empty.count();
  expect(slots).toBeGreaterThan(0);

  const before = await offered(page);
  await takes.first().click();
  await expect(empty).toHaveCount(slots - 1);
  await expect(gaveUp).toHaveCount(1);
  // The taken offer is replaced.
  expect(await offered(page)).not.toContain(before[0]);
  expect(await offered(page)).toHaveLength(before.length);

  // With every slot full, Take is disabled rather than hidden.
  for (let n = 1; n < slots; n++) await takes.first().click();
  await expect(empty).toHaveCount(0);
  await expect(gaveUp).toHaveCount(slots);
  await expect(takes.first()).toBeDisabled();

  await gaveUp.first().click();
  await expect(empty).toHaveCount(1);
  await expect(gaveUp).toHaveCount(slots - 1);
  await expect(takes.first()).toBeEnabled();
});

// `fill` is what atlas.spec.ts builds its maps with. See AtlasDevBar.tsx.
test('the instrument panel grows a map without anybody typing', async ({ page }) => {
  await start(page, busy(), '?dev=1');
  expect(await tally(page)).toBe(1);

  await page.getByLabel(/how many moves to walk/i).fill('12');
  await page.getByRole('button', { name: /^fill$/ }).click();
  await expect.poll(() => tally(page)).toBeGreaterThan(5);
});

// Given a word, the run goes breadth first from it (`spread` in atlas.ts).
test('a run can be aimed outward from one word', async ({ page }) => {
  const { graph } = mapData();
  const from = busy();
  await start(page, from, '?dev=1');

  const near = graph.commonNeighbors(from);
  await page.getByLabel(/how many moves to walk/i).fill('8');
  await page.getByLabel(/which word to walk out from/i).fill(from);
  await page.getByRole('button', { name: /^fill$/ }).click();
  await expect.poll(() => tally(page)).toBe(9);

  const found = await page.locator('g[data-word] circle[stroke-width="1.4"]').count();
  expect(found).toBeGreaterThan(1);
  await expect(page.locator(`g[data-word="${near[0]}"]`)).toBeVisible();
});

// A run can only start from a found word; any other is marked invalid.
test('the run’s origin says when it names nowhere', async ({ page }) => {
  const from = busy();
  await start(page, from, '?dev=1');
  const box = page.getByLabel(/which word to walk out from/i);

  await box.fill('zzzznotaword');
  await expect(box).toHaveAttribute('aria-invalid', 'true');
  await page.getByRole('button', { name: /^fill$/ }).click();
  expect(await tally(page)).toBe(1);

  await box.fill(from);
  await expect(box).not.toHaveAttribute('aria-invalid', 'true');
  await box.fill('');
  await expect(box).not.toHaveAttribute('aria-invalid', 'true');
});

// Checked by the tally rising in steps, which a one-pass run would not do.
test('a walk is played one guess at a time', async ({ page }) => {
  await start(page, busy(), '?dev=1');

  await page.getByLabel(/how many moves to walk/i).fill('6');
  await page.getByRole('button', { name: /^walk$/ }).click();
  await expect(page.getByRole('button', { name: /^stop$/ })).toBeVisible();

  await expect.poll(() => tally(page), { timeout: 30_000 }).toBeGreaterThan(1);
  const partway = await tally(page);
  await expect
    .poll(() => tally(page), { timeout: 60_000 })
    .toBeGreaterThan(partway);
  await expect(page.getByRole('button', { name: /^walk$/ })).toBeVisible({ timeout: 60_000 });
});

// A dropped word has no move in the log, so its edge to `from` is gilt only because both ends
// are found. The edge is dim gilt until one end is pointed at.
test('a move between two found words is drawn as one, typed or not', async ({ page }) => {
  const { graph } = mapData();
  const from = busy();
  const rim = graph.commonNeighbors(from)[0]!;
  await start(page, from, '?dev=1');

  // `pay` is the dev bar's grant of points.
  await page.getByRole('button', { name: /^pay$/ }).click();
  await page.getByRole('button', { name: /drop a word/i }).click();
  await guess(page, rim);
  await expect(page.locator(`g[data-word="${rim}"] text.word`)).toHaveText(rim);

  // Drawn as made, in gilt, and lit: it touches the word now stood on.
  const key = [from, rim].sort().join(' ');
  const line = page.locator(`g[data-edge="${key}"] line`).first();
  await expect(line).toHaveAttribute('stroke', 'var(--color-gilt)');
  await expect(line).toHaveAttribute('stroke-opacity', '1');
});

test('a power says what to do next, and refuses what cannot be paid for', async ({ page }) => {
  const { graph } = mapData();
  const from = busy();
  await start(page, from);

  await page.getByRole('button', { name: /count letters/i }).click();
  await expect(page.getByText(/tap a word you have not found/i)).toBeVisible();

  // Nothing earned yet.
  const rim = graph.commonNeighbors(from)[0]!;
  await page.locator(`g[data-word="${rim}"] circle[role="button"]`).click();
  await expect(page.getByText(/not enough mana/i)).toBeVisible();
});

test('a map keeps itself, and comes back where it was left', async ({ page }) => {
  const { graph } = mapData();
  const from = busy();
  const next = graph.commonNeighbors(from)[0]!;
  await start(page, from);
  await guess(page, next);

  const at = page.url();
  // Wait for the save and for the camera to finish moving after the guess, then read it.
  await page.waitForTimeout(1400);
  const before = await camera(page);
  await page.reload();

  await expect(page.locator(`g[data-word="${next}"] text.word`)).toHaveText(next);
  expect(page.url()).toBe(at);
  expect(await tally(page)).toBe(2);

  // Centre and width only: the plate's height varies with whether the missions row wraps.
  const after = await camera(page);
  expect(after.cx).toBeCloseTo(before.cx, 1);
  expect(after.cy).toBeCloseTo(before.cy, 1);
  expect(after.width).toBeCloseTo(before.width, 1);
});

/** The viewBox's centre and width. */
async function camera(page: Page) {
  const box = (await page.locator('svg[role="img"]').getAttribute('viewBox'))!;
  const [x, y, width, height] = box.split(' ').map(Number) as [number, number, number, number];
  return { cx: x + width / 2, cy: y + height / 2, width };
}

// The path names only the game, so the map shown is the one opened last, even among maps made
// the same day. See `opened` in atlasStore.ts.
test('a new map is the one that opens, and so is one picked off the list', async ({ page }) => {
  const { graph } = mapData();
  const first = busy();
  const second = graph.commonNeighbors(first)[0]!;

  await start(page, first);
  await page.waitForTimeout(1400);

  await page.getByRole('button', { name: /^maps$/i }).click();
  await page.getByLabel(/start from/i).fill(second);
  await page.getByRole('button', { name: 'Begin' }).click();
  await expect(page.locator(`g[data-word="${second}"] text.word`)).toHaveText(second);
  expect(await tally(page)).toBe(1);

  await page.waitForTimeout(1400);
  await page.getByRole('button', { name: /^maps$/i }).click();
  await expect(page.locator('main li button').first()).toHaveText(second);
  await page.getByRole('button', { name: first, exact: true }).click();
  await expect(page.locator(`g[data-word="${first}"] text.word`)).toHaveText(first);

  await page.waitForTimeout(1400);
  await page.reload();
  await expect(page.locator(`g[data-word="${first}"] text.word`)).toHaveText(first);
});

test('the list holds every map, and can lose one', async ({ page }) => {
  const from = busy();
  await start(page, from);
  await page.waitForTimeout(1400);

  await page.getByRole('button', { name: /^maps$/i }).click();
  await expect(page.getByRole('button', { name: from, exact: true })).toBeVisible();

  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: /^delete$/i }).first().click();
  await expect(page.getByText(/no maps yet/i)).toBeVisible();
});

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

  await page.getByRole('option', { name: /letters medium/i }).click();
  await expect(page).toHaveURL(/\/[0-9a-f]{4,}$/);
  await expect(page.locator('main svg circle').first()).toBeVisible();

  // The same map comes back, though the path does not name it.
  await boards.click();
  await page.getByRole('option', { name: /explore letters/i }).click();
  await expect(page).toHaveURL(/\/explore\/letters$/);
  await expect(page.locator(`g[data-word="${busy()}"]`)).toBeVisible();
});
