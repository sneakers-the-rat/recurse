/**
 * The plate as a thing you move: dragging, zooming, and the way those must not get in
 * the way of playing.
 *
 * The camera arithmetic is unit-tested (camera.test.ts); this is about the gestures
 * reaching it, which needs a real pointer on a real SVG.
 */

import { expect, test, type Page } from '@playwright/test';
import { board, gameData, inShot, puzzleWithPar } from './fixtures';
import { buildPlate } from '../src/lib/plate';
import { drawOptions } from '../src/test/shipped';

const { puzzles } = gameData();

/** The viewBox, as four numbers. */
async function view(page: Page): Promise<number[]> {
  const box = await page.locator('main svg').getAttribute('viewBox');
  return (box ?? '').split(' ').map(Number);
}

test('the board opens framed on the answer', async ({ page }) => {
  const puzzle = puzzles[4]!;
  await page.goto(board(puzzle, '?dev=0'));
  await expect(page.locator('main svg circle').first()).toBeVisible();

  // Source and target are both in shot, which is the whole promise of the play view:
  // whatever else is on the board, the two words the puzzle is about are on screen.
  for (const word of [puzzle.source, puzzle.target]) {
    await expect(page.locator('main svg text', { hasText: new RegExp(`^${word}$`) }).first()).toBeInViewport();
  }
});

test('a word is the same size on a crowded board as on a bare one', async ({ page }) => {
  // What the camera is *for*. Both of these have the same par, so the same spine, so
  // the same scale — however many words each of them draws.
  const same = puzzles.filter((p) => p.par === puzzles[0]!.par).slice(0, 2);
  const scales: number[] = [];
  for (const puzzle of same) {
    await page.goto(board(puzzle, '?dev=0'));
    await expect(page.locator('main svg circle').first()).toBeVisible();
    const [, , width] = await view(page);
    scales.push(width!);
  }
  expect(scales[0]).toBeCloseTo(scales[1]!, 1);
});

test('the board can be dragged and zoomed', async ({ page }) => {
  await page.goto(board(puzzles[0]!, '?dev=0'));
  const svg = page.locator('main svg');
  await expect(svg.locator('circle').first()).toBeVisible();

  const before = await view(page);

  // Drag from a patch of empty board, so nothing is clicked.
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + 24, box.y + box.height - 24);
  await page.mouse.down();
  await page.mouse.move(box.x + 140, box.y + box.height - 90, { steps: 8 });
  await page.mouse.up();

  const panned = await view(page);
  expect(panned[0]).not.toBeCloseTo(before[0]!, 1);
  expect(panned[1]).not.toBeCloseTo(before[1]!, 1);
  // A pan moves the view, it does not resize it.
  expect(panned[2]).toBeCloseTo(before[2]!, 1);

  // The wheel is the page's until the board is asked for, which is done by resting a
  // pointer on it — the board is a screenful tall and the page scrolls past it, so a
  // notch over the plate would otherwise mean two things at once. See DWELL_MS.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const plate = page.locator('main');
  // The lit border is the board saying it has the wheel now.
  await expect(plate).toHaveCSS('border-top-color', 'rgb(125, 104, 68)');

  await page.mouse.wheel(0, -400);
  await expect.poll(async () => (await view(page))[2]!).toBeLessThan(panned[2]!);
});

test('a wheel is the page’s until the board is asked for', async ({ page }) => {
  // Both at once is the one answer that cannot be right, and it was the answer: React
  // registers `wheel` passively, so the handler's `preventDefault` was being ignored and
  // a notch over the plate scrolled the page *and* zoomed the board.
  //
  // On a finished board, because that is the page that scrolls: during play the screen is
  // fixed and there is nowhere for a scroll to go, so there would be no conflict to test.
  const { puzzle, path } = puzzleWithPar(3);
  await page.goto(board(puzzle, '?dev=0'));
  for (const word of path.slice(1)) {
    await page.getByLabel(/Your guess/).fill(word);
    await page.getByRole('button', { name: 'Name it' }).click();
  }
  await expect(page.getByRole('region', { name: 'Result' })).toBeVisible();

  const plate = page.locator('main');
  const box = (await page.locator('main svg').boundingBox())!;
  const mid = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const width = async () => (await view(page))[2]!;
  const scrollY = () => page.evaluate(() => window.scrollY);

  // Off the plate first, and confirmed off it. Solving the puzzle above left the pointer
  // wherever the last button was, and once the guess bar goes the board takes that space —
  // so the pointer has been resting on the plate for a second and a half and has already
  // earned the wheel, which is the feature working and the test starting in the wrong state.
  await page.mouse.move(4, 4);
  await expect(plate).toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)');

  // Read before moving: every round trip is time the pointer spends resting, and resting
  // is the thing being tested.
  const before = { y: await scrollY(), width: await width() };

  // Arriving: the board has not been asked for yet.
  await page.mouse.move(mid.x, mid.y);

  // And a wheel now does one thing, whichever thing it is.
  //
  // Which one is deliberately not asserted. The dwell is half a second of wall clock and
  // two round trips to the browser stand between the move above and the wheel below, so
  // under a loaded machine this pointer can genuinely have come to rest and earned the
  // wheel — the test would then be failing for the reason the feature exists. What must
  // never happen is *both*, and that is what was happening.
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(250);
  const scrolled = (await scrollY()) !== before.y;
  const zoomed = Math.abs((await width()) - before.width) > 0.5;
  expect(scrolled && zoomed).toBe(false);
  expect(scrolled || zoomed).toBe(true);

  // Resting on it: the board's, said with a lit border, and now the page holds still.
  // This half *can* be asserted outright, because waiting for the border to light is
  // waiting for exactly the state being tested rather than for a stopwatch.
  await page.mouse.move(mid.x, mid.y + 1);
  await expect(plate).toHaveCSS('border-top-color', 'rgb(125, 104, 68)');
  const rested = { y: await scrollY(), width: await width() };
  await page.mouse.wheel(0, -300);
  await expect.poll(width).toBeLessThan(rested.width);
  expect(await scrollY()).toBe(rested.y);
});

test('the figure reads as a graph', async ({ page }) => {
  // Three things went wrong at once when the layout was doing more than a layout should,
  // and every one of them is measurable — which is why this exists rather than another
  // screenshot. Labels sat on top of each other; words piled onto the frame's walls in
  // horizontal lines, thirty percent of every board, with their edges crossing between
  // them; and neighbours ended up nowhere near each other, links running at twice the
  // length the link force asks for. See `boxOf`, `forceLabelBox` and `CHARGE`.
  //
  // Measured on a *solved* board — the state a player actually ends in, with the answer
  // named and the rest still dots. Not `name all`: a word only claims a label's worth of
  // room once it is showing one (see `boxOf`), so reading every word aloud grows thirty
  // boxes at once and asks for more room than the figure has. That is dev mode inspecting
  // the board, not the board being wrong.
  for (const par of [4, 5]) {
    const puzzle = puzzles.find((p) => p.par === par && p.secret === 0)!;
    const plate = buildPlate(
      gameData().graph,
      puzzle.source,
      puzzle.target,
      [],
      drawOptions(puzzle),
    );

    await page.goto(board(puzzle, '?dev=1'));
    await expect(page.locator('main svg circle[role="button"]').first()).toBeVisible();
    await page.getByRole('button', { name: 'solve' }).click();
    await expect(page.getByRole('region', { name: 'Result' })).toBeVisible();

    const measured = await page.evaluate(
      ({ edges, charW }) => {
        const at: Record<string, [number, number]> = {};
        for (const g of document.querySelectorAll('main svg g[transform]')) {
          const word = g.querySelector('text')?.textContent;
          const m = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(g.getAttribute('transform') ?? '');
          if (word && m) at[word] = [Number(m[1]), Number(m[2])];
        }

        // Two labels overlap if their drawn boxes do. A label is its own width and the
        // one line it sits on, so the test is narrow vertically on purpose.
        const words = Object.keys(at);
        let overlapping = 0;
        for (let i = 0; i < words.length; i++) {
          for (let j = i + 1; j < words.length; j++) {
            const [ax, ay] = at[words[i]!]!;
            const [bx, by] = at[words[j]!]!;
            const wantX = ((words[i]!.length + words[j]!.length) * charW) / 2;
            if (Math.abs(bx - ax) < wantX && Math.abs(by - ay) < 12) overlapping++;
          }
        }

        // A clamp that is being reached is a line of words at one exact y.
        const rows = new Map<number, number>();
        for (const [, y] of Object.values(at)) rows.set(Math.round(y), (rows.get(Math.round(y)) ?? 0) + 1);
        const stacked = Math.max(0, ...[...rows.values()]);

        const lengths = edges
          .filter(([a, b]) => at[a] && at[b])
          .map(([a, b]) => Math.hypot(at[a]![0] - at[b]![0], at[a]![1] - at[b]![1]))
          .sort((x, y) => x - y);

        return {
          words: words.length,
          overlapping,
          stacked,
          median: lengths[Math.floor(lengths.length / 2)] ?? 0,
        };
      },
      { edges: plate.edges.map((e) => [e.a, e.b] as const), charW: 7.8 },
    );

    expect(measured.words).toBeGreaterThan(3);
    // No two words may be written on top of each other, ever.
    expect(measured.overlapping).toBe(0);
    // Three words on one exact y is a clamp, not a layout. Two can be coincidence.
    expect(measured.stacked).toBeLessThanOrEqual(2);
    // A link wants to be 74 units. Twice that is a figure held apart by something other
    // than its own connections; the broken version measured 122 to 176.
    expect(measured.median).toBeLessThan(150);
  }
});

test('dragging across a word does not select it', async ({ page }) => {
  // Panning with a thumb on a phone starts wherever the thumb lands, which is often on
  // a word. Ending the drag used to name it.
  const { puzzle } = { puzzle: puzzles[0]! };
  await page.goto(board(puzzle, '?dev=0'));
  const input = page.getByLabel(/Your guess/);
  await expect(input).toHaveAttribute('aria-label', new RegExp(`from ${puzzle.source}`));

  const node = page.locator('main svg circle[role="button"]').first();
  const at = (await node.boundingBox())!;
  await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
  await page.mouse.down();
  await page.mouse.move(at.x + at.width / 2 + 80, at.y + at.height / 2 + 40, { steps: 6 });
  await page.mouse.up();

  // Still guessing from the source: the drag was a drag.
  await expect(input).toHaveAttribute('aria-label', new RegExp(`from ${puzzle.source}`));
  await expect(page.locator('header')).not.toContainText('hint');
});

test('hovering a word shows the way on from it', async ({ page }) => {
  // The question a player asks by pointing at a word is "does this get me anywhere",
  // and the board already knows: it has every drawn word's distance to the target.
  await page.goto(board(puzzles[0]!, '?dev=0'));
  const svg = page.locator('main svg');
  await expect(svg.locator('circle').first()).toBeVisible();

  const gilt = () =>
    svg.locator('line').evaluateAll((lines) =>
      lines.filter((line) => {
        const stroke = line.getAttribute('stroke') ?? '';
        return stroke.includes('gilt') && Number(line.getAttribute('stroke-width')) >= 1.8;
      }).length,
    );
  expect(await gilt()).toBe(0);

  // A word part-way down the board that is in shot, so there is a route ahead of it to
  // draw and a pointer can reach it.
  await (await inShot(page, 'main svg circle[role="button"]')).hover();
  await expect.poll(gilt).toBeGreaterThan(0);
  await page.screenshot({ path: 'e2e/shots/hover.png' });

  // And it goes away again with the pointer.
  await page.mouse.move(4, 4);
  await expect.poll(gilt).toBe(0);
});

test('the board holds still for anything that is not a new word', async ({ page }) => {
  // The layout used to depend on which words were *labelled*, so the figure's own width
  // changed the moment a hint spelled one out — and every word on the board jumped to a
  // new place in a single frame. A hint, a tap, a refused guess: none of them is a new
  // word, and none of them may move anything.
  await page.goto(board(puzzles[0]!, '?dev=0'));
  const svg = page.locator('main svg');
  await expect(svg.locator('circle').first()).toBeVisible();

  const places = () =>
    svg.locator('g[transform]').evaluateAll((all) => all.map((g) => g.getAttribute('transform')));
  const before = await places();
  expect(before.length).toBeGreaterThan(5);

  // A hint, twice over, so the word goes from a dot to a spelling. Asked for in shot,
  // because most of this board is off the edges of the plate on purpose.
  const dot = await inShot(page, '[aria-label^="Unnamed word. Reveal"]');
  await dot.click();
  await (await inShot(page, '[aria-label^="Unnamed word, "]')).click();
  await expect(page.locator('header')).toContainText('2 hints');
  expect(await places()).toEqual(before);

  // A refused guess.
  await page.getByLabel(/Your guess/).fill('qwertzxcv');
  await page.getByRole('button', { name: 'Name it' }).click();
  await expect(page.locator('#guess-error')).not.toHaveText('');
  expect(await places()).toEqual(before);
});

test('tapping a word still works', async ({ page }) => {
  // The other half of the same rule: a tap that goes nowhere is still a tap.
  await page.goto(board(puzzles[0]!, '?dev=0'));
  const dot = await inShot(page, '[aria-label^="Unnamed word. Reveal"]');
  await expect(dot).toBeVisible();
  await dot.click();
  await expect(page.locator('header')).toContainText('1 hint');
});
