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

/** Where the camera is looking, in graph units — the middle of the viewBox. */
async function looking(page: Page): Promise<[number, number]> {
  const [x, y, w, h] = await view(page);
  return [x! + w! / 2, y! + h! / 2];
}

/**
 * Where a word is drawn, in graph units, read off the group the plate places it with.
 *
 * Graph units and not pixels, because that is what the camera is in: a claim about what is
 * in shot is a claim about a point against the viewBox, and going through the screen would
 * be asking the same question twice with a scale factor in between.
 */
async function spot(page: Page, word: string): Promise<[number, number] | null> {
  return page.evaluate((wanted) => {
    for (const g of document.querySelectorAll('main svg g[transform]')) {
      if (g.querySelector('text')?.textContent !== wanted) continue;
      const m = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(g.getAttribute('transform') ?? '');
      if (m) return [Number(m[1]), Number(m[2])] as [number, number];
    }
    return null;
  }, word);
}

/** Is that point in shot? */
async function shows(page: Page, word: string): Promise<boolean> {
  const at = await spot(page, word);
  if (!at) return false;
  const [x, y, w, h] = await view(page);
  return at[0] >= x! && at[0] <= x! + w! && at[1] >= y! && at[1] <= y! + h!;
}

async function guess(page: Page, word: string) {
  await page.getByLabel(/Your guess/).fill(word);
  await page.getByRole('button', { name: 'Guess', exact: true }).click();
}

/**
 * Drag the board sideways by `dx` pixels, along the bottom of the plate.
 *
 * Along the bottom because that is reliably empty board; a drag that starts on a word is
 * still a drag — the click is swallowed — but a test should not be leaning on that.
 */
async function drag(page: Page, dx: number) {
  const box = (await page.locator('main svg').boundingBox())!;
  const y = box.y + box.height - 30;
  const from = dx > 0 ? box.x + 20 : box.x + box.width - 20;
  await page.mouse.move(from, y);
  await page.mouse.down();
  await page.mouse.move(from + dx, y, { steps: 8 });
  await page.mouse.up();
}

/** One sweep of the whole plate. */
async function sweep(page: Page) {
  const box = (await page.locator('main svg').boundingBox())!;
  await drag(page, box.width - 40);
}

/** Sweep until the board has been dragged clear off the plate, or give up saying so. */
async function panAway(page: Page, word: string): Promise<boolean> {
  for (let i = 0; i < 5; i++) {
    if (!(await shows(page, word))) return true;
    await sweep(page);
  }
  return !(await shows(page, word));
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
  // What the camera is *for*: the scale is fixed by the spine, never by how much else
  // there is to draw. So crowd one board and check it did not budge.
  //
  // This used to load two *different* puzzles of the same par and compare their viewBox
  // widths, which does not isolate crowdedness. `playCamera` divides the *plate's* height
  // by the spine, and the plate gets whatever the chrome leaves it — the statement shrinks
  // to fit the longer of the two words on one line, so a puzzle with longer words has a
  // taller header and a shorter plate. The two boards came out half a pixel apart on every
  // run, which is a true fact about their word lengths and nothing to do with the promise
  // being tested. One board, before and after, has no such confound.
  const { puzzle } = puzzleWithPar(3);
  await page.goto(board(puzzle, '?dev=0'));
  const nodes = () => page.locator('main svg circle[role="button"]');
  await expect(nodes().first()).toBeVisible();

  const before = await nodes().count();
  const [, , wide] = await view(page);

  // A legal move off the intended route, which draws its own neighbourhood too — this is
  // the board growing under the player, which is exactly the thing that must not rescale.
  const { graph } = gameData();
  const stray = graph.neighbors(puzzle.source).find((w) => w !== puzzle.target);
  test.skip(!stray, 'no stray move available');
  await guess(page, stray!);

  await expect.poll(() => nodes().count()).toBeGreaterThan(before);

  // Width, not the whole viewBox: the camera is allowed to *move* to bring the new word
  // into shot, and on a phone it does. What it may not do is change the scale.
  const [, , afterwards] = await view(page);
  expect(afterwards).toBeCloseTo(wide!, 1);
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
    await page.getByRole('button', { name: 'Guess', exact: true }).click();
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

test('a guess brings the word it landed on back into shot', async ({ page }) => {
  // The conservative half of following, and the one both viewports do. The game is played
  // by typing, so a player can be looking anywhere on the board when they name a word —
  // and a move that lands off the plate leaves them to go and find their own move with a
  // thumb before they can make the next one.
  const { puzzle, path } = puzzleWithPar(3);
  await page.goto(board(puzzle, '?dev=0'));
  await expect(page.locator('main svg circle').first()).toBeVisible();

  // Drag until the source is off the plate. The next word sprouts from it, so it lands off
  // the plate too — which is the state this is about.
  test.skip(!(await panAway(page, puzzle.source)), 'the board would not drag clear');

  await guess(page, path[1]!);
  await expect(
    page.locator('main svg text', { hasText: new RegExp(`^${path[1]}$`) }).first(),
  ).toBeVisible();
  await expect.poll(() => shows(page, path[1]!)).toBe(true);
});

test('a phone follows every guess and a wider screen holds still', async ({ page }) => {
  // The other half, and the one that differs by width — the same 40rem the masthead folds
  // its menus at. On a phone the board is played zoomed in with most of it off the edges,
  // so the word just named is brought to the middle whether or not it was already in shot.
  // On a screen holding the whole figure there is nothing to fetch, and a board that moved
  // anyway would be motion the player did not ask for.
  const { puzzle, path } = puzzleWithPar(3);
  await page.goto(board(puzzle, '?dev=0'));
  await expect(page.locator('main svg circle').first()).toBeVisible();

  // Nudged off centre, but not far: the word about to be named is still going to be in
  // shot, so nothing here is about rescuing it. That is the whole question — what the
  // camera does when it does not *have* to do anything.
  await drag(page, 110);
  const before = await looking(page);

  await guess(page, path[1]!);
  await expect(
    page.locator('main svg text', { hasText: new RegExp(`^${path[1]}$`) }).first(),
  ).toBeVisible();
  // Words on the answer are pinned to the centre line, so this one is exactly where the
  // spine put it and both halves below can be tight about where the camera ends up.
  const at = (await spot(page, path[1]!))!;

  if ((page.viewportSize()?.width ?? 0) < 640) {
    await expect.poll(async () => (await looking(page))[0]).toBeCloseTo(at[0], 0);
    expect((await looking(page))[1]).toBeCloseTo(at[1], 0);
    // And it really did have to move to get there.
    expect(Math.abs(before[0] - at[0])).toBeGreaterThan(20);
  } else {
    // The word was in shot already, so the camera has no business moving at all. Where it
    // is looking, not the whole viewBox: the plate itself resizes during ordinary play.
    await page.waitForTimeout(600);
    expect(await shows(page, path[1]!)).toBe(true);
    const after = await looking(page);
    expect(after[0]).toBeCloseTo(before[0]!, 1);
    expect(after[1]).toBeCloseTo(before[1]!, 1);
  }
});

test('the reset button puts the whole puzzle back in shot', async ({ page }) => {
  const { puzzle } = puzzleWithPar(4);
  await page.goto(board(puzzle, '?dev=0'));
  await expect(page.locator('main svg circle').first()).toBeVisible();

  const opened = await looking(page);
  test.skip(!(await panAway(page, puzzle.source)), 'the board would not drag clear');

  await page.getByRole('button', { name: 'Show the whole puzzle' }).click();

  // Both of the puzzle's own words, which is what the playing view promises.
  await expect.poll(() => shows(page, puzzle.source)).toBe(true);
  expect(await shows(page, puzzle.target)).toBe(true);
  const back = await looking(page);
  expect(back[0]).toBeCloseTo(opened[0]!, 1);
  expect(back[1]).toBeCloseTo(opened[1]!, 1);

  // And it did not take the typing with it: a tap on the board must never cost the player
  // the guess field, which is the whole reason focus is not moved on click.
  await page.keyboard.type('bat');
  await expect(page.getByLabel(/Your guess/)).toHaveValue('bat');
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

  // The source, by name.
  //
  // This used to hover whichever circle happened to be first in shot, and what gets drawn
  // is a route *from the hovered word to the target* — so on a board whose first drawn
  // circle was the goal there was nothing ahead to draw and the count stayed at nought.
  // The source is the one word guaranteed a whole route ahead of it, which is what makes
  // this deterministic rather than a question about node order.
  await page.locator(`[data-word="${puzzles[0]!.source}"] circle[role="button"]`).hover();
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
  await page.getByRole('button', { name: 'Guess', exact: true }).click();
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
