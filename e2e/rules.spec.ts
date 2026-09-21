/**
 * The rules a player runs into, checked against the real dictionary in a real
 * browser. These are the cases that were reported as feeling like bugs.
 */

import { expect, test, type Page } from '@playwright/test';
import { board, gameData } from './fixtures';

/** Start a game positioned on a chosen word, whatever today's puzzle is. */
async function startOn(page: Page, word: string) {
  const { puzzles } = gameData();
  const puzzle = puzzles.find((p) => p.source === word);
  expect(puzzle, `no puzzle starts on "${word}"`).toBeDefined();
  await page.goto(board(puzzle!));
  return puzzle!;
}

async function guess(page: Page, word: string) {
  await page.getByLabel(/Your guess/).fill(word);
  await page.getByRole('button', { name: 'Guess', exact: true }).click();
}

const error = (page: Page) => page.locator('#guess-error');

test('accepts an ordinary word that no puzzle is built from', async ({ page }) => {
  const { graph, puzzles } = gameData();
  // A legal move from the source that the puzzle bank has no use for — no puzzle
  // is built on it, and it is not on the intended answer. It is still a real
  // word, so it plays. (Asking for `source + "s"` was the old version of this
  // test and became wrong when the shortest addable word grew to two letters.)
  const offBank = new Set(puzzles.flatMap((p) => [p.source, p.target]));
  const found = puzzles
    .map((puzzle) => ({
      puzzle,
      move: graph
        .neighbors(puzzle.source)
        .find((word) => word !== puzzle.target && !offBank.has(word)),
    }))
    .find((candidate) => candidate.move !== undefined);
  test.skip(!found, 'no suitable move in the bank');

  await startOn(page, found!.puzzle.source);
  await guess(page, found!.move!);
  await expect(error(page)).toHaveText('');
});

test('a bare ending is a legal move, not a special case', async ({ page }) => {
  const { graph, puzzles } = gameData();
  /*
    -less and friends used to be refused outright. Whether a *solution* should lean on one is
    a puzzle-selection matter, never a rule of play.

    **The ending has to be a word itself, and that is the part that moved.** `ing` is not one
    any more — see tools/nonwords.txt — so `show + ing` is not a move for anybody. That is not
    the special case coming back: it is the one rule there has ever been, applied to a word
    list that no longer claims `ing` is English. `less` is a word and still plays, which is
    what this asks about.
  */
  const endings = ['less', 'ness', 'ful', 'able'].filter((end) => graph.isWord(end));
  const found = puzzles
    .flatMap((puzzle) => endings.map((end) => ({ from: puzzle.source, to: `${puzzle.source}${end}` })))
    .find((one) => graph.isWord(one.to) && graph.neighbors(one.from).includes(one.to));
  test.skip(!found, 'no bare ending in the word list makes a move out of a bank word');

  await startOn(page, found!.from);
  await guess(page, found!.to);
  await expect(error(page)).toHaveText('');
  await expect(page.locator('main svg text', { hasText: new RegExp(`^${found!.to}$`) }).first())
    .toBeVisible();
});

test('explains letters arriving in two places', async ({ page }) => {
  const { puzzles } = gameData();
  await page.goto(board(puzzles[0]!));
  const source = puzzles[0]!.source;
  // Letters at both ends: no single word was inserted anywhere.
  await guess(page, `x${source}y`);
  await expect(error(page)).toContainText('single unbroken run');
});

test('explains a same-length swap as a different kind of move', async ({ page }) => {
  const { graph, puzzles } = gameData();
  const puzzle = puzzles[0]!;
  // Any real word of the same length that is not a legal move.
  const swap = graph.words.find(
    (w) => w.length === puzzle.source.length && w !== puzzle.source && !graph.findMove(puzzle.source, w),
  );
  test.skip(!swap, 'no same-length word available');

  await page.goto(board(gameData().puzzles[0]!));
  await guess(page, swap!);
  await expect(error(page)).toContainText('same length');
});

test('refuses something that is not a word at all', async ({ page }) => {
  await page.goto(board(gameData().puzzles[0]!));
  await guess(page, 'qwertzxcv');
  await expect(error(page)).not.toHaveText('');
});
