/**
 * The walkthrough: `/tutorial`, which is a real board with a lesson drawn over it.
 *
 * **These test the scaffold, not the lesson.** What the cards say is content and will change
 * every time somebody reads it on a phone and winces; what must not change is the machinery
 * around them, so nothing here names a card, a word or a sentence. The claims are the ones
 * `lib/tutorial.ts` makes:
 *
 *  - the page is reached by its own address, from the masthead at either width;
 *  - a beat that asks for something holds the forward arrow until it gets it;
 *  - going back does not bounce forward again, which is the one subtle rule in `observe`;
 *  - what is lit is *drawn* as well as cut out of the overlay, which is the difference
 *    between a spotlight and a slightly-less-black square on a black board;
 *  - the board underneath is live, and the whole of it — a lesson never takes the page
 *    hostage, which is what the overlay overrides in index.css are for;
 *  - and a lesson leaves nothing behind, because the board it teaches on is a real puzzle
 *    somebody may want to play properly one day.
 *
 * How far a beat is from the first gate is a fact about the lesson, so the walk here is
 * "press forward until it stops" rather than a count.
 */

import { expect, test, type Page } from '@playwright/test';
import { masthead } from './fixtures';

const pathOf = (url: string) => new URL(url).pathname.replace(/^\//, '').split('?')[0];

const panel = (page: Page) => page.locator('.driver-popover');
const card = (page: Page) => page.locator('[data-step]');
const onward = (page: Page) => panel(page).getByRole('button', { name: /Next step|Finish/ });
const back = (page: Page) => panel(page).getByRole('button', { name: 'Previous step' });

/**
 * Where in the lesson we are: the card and which beat of it.
 *
 * Both, because a card can be read in several beats — "tap this word, then name that one" is
 * two — and the card alone does not change when the spotlight moves from the plate to the
 * guess bar.
 */
async function beat(page: Page): Promise<string> {
  const one = card(page);
  return `${await one.getAttribute('data-step')}#${await one.getAttribute('data-beat')}`;
}

/** Open the lesson and wait for it to have something to say. */
async function openLesson(page: Page) {
  await page.goto('/tutorial');
  await expect(card(page)).toBeVisible({ timeout: 20_000 });
}

/** Forward until a beat refuses to be walked past. Returns the beat that stopped it. */
async function toTheFirstGate(page: Page): Promise<string> {
  for (let i = 0; i < 20; i++) {
    if (await onward(page).isDisabled()) return beat(page);
    const was = await beat(page);
    await onward(page).click();
    await expect.poll(() => beat(page)).not.toBe(was);
  }
  throw new Error('the lesson never asks the player to do anything');
}

test('the masthead opens the lesson at its own address', async ({ page }) => {
  await page.goto('/');
  await masthead(page, 'Tutorial');
  await expect(card(page)).toBeVisible();
  expect(pathOf(page.url())).toBe('tutorial');

  // Pushed, not replaced: back is the board that was being played, not off the site.
  await page.goBack();
  await expect(card(page)).toHaveCount(0);
  await expect(page.getByLabel(/Your guess/)).toBeVisible();
});

test('a direct visit works, and the board under it is the real game', async ({ page }) => {
  // The path fallback, as for the other two pages. Unlike them this one *is* a board, so the
  // guess bar and the plate are both there — the lesson is a layer, not a screen.
  await openLesson(page);
  await expect(page.getByLabel(/Your guess/)).toBeVisible();
  await expect(page.locator('[data-word]').first()).toBeVisible();
  await expect(page.locator('header')).toContainText('par:');
});

test('the panel says which card and which beat', async ({ page }) => {
  // Both, because a card can be read in several beats and the card alone does not change
  // when the spotlight moves from the plate to the guess bar. That the shipped lesson
  // actually uses them is checked where the lesson can be read: `tutorial.test.ts`.
  await openLesson(page);
  await expect(card(page)).toHaveAttribute('data-step', /.+/);
  await expect(card(page)).toHaveAttribute('data-beat', /^\d+$/);
});

test('a beat that asks for something holds the forward arrow', async ({ page }) => {
  await openLesson(page);
  const gate = await toTheFirstGate(page);

  await expect(onward(page)).toBeDisabled();
  // And it says what it wants, in its own line rather than buried in the prose.
  await expect(panel(page).getByRole('status')).toBeVisible();
  // Back is never held, because rereading is not a mistake.
  await expect(back(page)).toBeEnabled();
  expect(gate).not.toBe('');
});

test('the arrows are a thumb’s worth on a phone', async ({ page }, info) => {
  await openLesson(page);
  await toTheFirstGate(page);
  const box = await back(page).boundingBox();
  const wide = info.project.name !== 'phone';
  // The panel's only controls, and a phone is the target. They shrink to the chrome's own
  // scale on a wide screen, where there is a pointer to aim with.
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(wide ? 24 : 40);
});

test('what is lit is drawn, not merely undimmed', async ({ page }) => {
  await openLesson(page);
  await toTheFirstGate(page);

  // A cutout in a dark overlay is a slightly-less-dark rectangle, which over a black board
  // with a four-pixel dot on it reads as nothing at all. The hairline is what makes it a
  // mark, and it has to be over something rather than parked at nothing.
  const stage = page.locator('.recurse-stage');
  await expect(stage).toHaveCSS('border-top-color', 'rgb(191, 159, 96)');
  const box = await stage.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(0);
  expect(box?.height ?? 0).toBeGreaterThan(0);
});

test('the board stays live under the overlay', async ({ page }) => {
  await openLesson(page);
  await toTheFirstGate(page);

  // driver.js would ordinarily stop everything but what it is pointing at. The overrides in
  // index.css undo that, because a player who wants to type something the step never asked
  // for is playing the game, which is the thing being taught.
  await expect(page.locator('.driver-overlay')).toHaveCSS('pointer-events', 'none');
  const field = page.getByLabel(/Your guess/);
  await field.fill('nonsense');
  await expect(field).toHaveValue('nonsense');
});

test('the arrow keys turn the cards', async ({ page }) => {
  await openLesson(page);
  const first = await beat(page);

  await page.keyboard.press('ArrowRight');
  await expect.poll(() => beat(page)).not.toBe(first);
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => beat(page)).toBe(first);

  // Except where they are somebody's text cursor. A player editing a guess is moving
  // through their own letters, and the lesson does not get to take that.
  await page.getByLabel(/Your guess/).click();
  await page.getByLabel(/Your guess/).fill('abc');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(400);
  expect(await beat(page)).toBe(first);
});

test('a reload picks the lesson up where it was left', async ({ page }) => {
  await openLesson(page);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  const got = await beat(page);
  expect(got).not.toBe('welcome#0');

  await page.reload();
  await expect(card(page)).toBeVisible({ timeout: 20_000 });
  expect(await beat(page)).toBe(got);

  // And there is a way to forget, which is the other half of remembering.
  await panel(page).getByRole('button', { name: 'start over' }).click();
  await expect.poll(() => beat(page)).not.toBe(got);
  await page.reload();
  await expect(card(page)).toBeVisible({ timeout: 20_000 });
  expect((await beat(page)).endsWith('#0')).toBe(true);
});

test('going back to a beat already answered stays there', async ({ page }) => {
  await openLesson(page);
  const gate = await toTheFirstGate(page);
  // The beat before the gate has nothing to ask, so it is cleared by being read — which is
  // the case `observe` has to tell from "answered just now" or the arrows are unusable.
  await back(page).click();
  await expect.poll(() => beat(page)).not.toBe(gate);

  const behind = await beat(page);
  await page.waitForTimeout(1200);
  expect(await beat(page)).toBe(behind);
  await expect(onward(page)).toBeEnabled();
});

test('a lesson leaves nothing behind', async ({ page }) => {
  await openLesson(page);
  await toTheFirstGate(page);
  // Whatever the first gate asks for, playing is the only way past it — so play. A guess
  // that is refused still counts as a miss, which is enough to make a game worth keeping.
  await page.getByLabel(/Your guess/).fill('nonsense');
  await page.keyboard.press('Enter');
  await expect(page.locator('#guess-error')).not.toBeEmpty();

  // The board it teaches on is a real puzzle. Writing the walkthrough into its slot would
  // hand somebody a board they had never seen, part solved — so the lesson keeps its own,
  // which is also what lets a reload pick it up.
  const kept = await page.evaluate(() => Object.keys({ ...localStorage }));
  expect(kept).not.toContain('recurse.games.v2');
  expect(kept).not.toContain('recurse.stats.v1');
  expect(kept).toContain('recurse.tutorial.v1');
});
