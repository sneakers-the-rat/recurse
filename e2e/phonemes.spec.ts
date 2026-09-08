/**
 * The game played by ear, in a browser.
 *
 * The claim worth testing here is the seam and nothing else: a board whose nodes are
 * *pronunciations* is drawn as words, and a guess typed as a word is resolved back to a
 * pronunciation before it is judged. Everything between those two points is the same code the
 * letters game runs, and it is tested by every other spec in here.
 *
 * So this deliberately does not check that the board is pretty, that the layout copes with two
 * lines of label, or that any particular puzzle is any good. Those are taste and layout, and
 * both are somebody's judgement rather than an assertion.
 */

import { expect, test } from '@playwright/test';
import { board, gameData, today, todayNumber, boardOnDay } from './fixtures';

/** Which band the phonemes mode is. Found rather than assumed: modes are declared in the yaml. */
function phonemesBand(): number {
  const { manifest } = gameData();
  const at = manifest.bands.findIndex(
    (band) => manifest.modes[band.mode]?.alphabet === 'phonemes',
  );
  return at;
}

test('draws a pronunciation as a word, with how it is said underneath', async ({ page }) => {
  const band = phonemesBand();
  test.skip(band < 0, 'no mode in this bank is played by ear');

  const wanted = boardOnDay(todayNumber(), band);
  const { lexicon } = gameData(band);
  const { source, target } = wanted.puzzle;

  await page.goto(board(wanted.puzzle));
  await expect(page.locator('main svg circle').first()).toBeVisible();

  // The two endpoints are named by their *spellings*. The tokens they are stored as are runs
  // of phoneme codes, and a board that showed those would be unplayable.
  await expect(page.locator('header')).toContainText(lexicon.label(source));
  await expect(page.locator('header')).toContainText(lexicon.label(target));

  // And the transcription is on the plate, under the goal, which is the one node named from
  // the start. Slashes are the convention for "this is a sound and not a spelling".
  const plate = page.locator(`[data-word="${target}"]`);
  await expect(plate).toContainText(`/${lexicon.transcribe(target)}/`);
});

test('accepts a guess typed as a word and moves to the sound it names', async ({ page }) => {
  const band = phonemesBand();
  test.skip(band < 0, 'no mode in this bank is played by ear');

  const wanted = boardOnDay(todayNumber(), band);
  const { graph, lexicon } = gameData(band);
  const { source } = wanted.puzzle;

  // Somewhere real to go: a move the shipped graph already knows about, named the way a player
  // would have to type it. If this comes up empty the board has no moves at all, which is a
  // bank problem rather than a client one.
  const next = graph.commonNeighbors(source)[0];
  expect(next, 'the source of a shipped board should carry a move').toBeTruthy();
  const typed = lexicon.label(next!);

  await page.goto(board(wanted.puzzle));
  await expect(page.locator('main svg circle').first()).toBeVisible();

  await page.getByRole('textbox').fill(typed);
  await page.getByRole('textbox').press('Enter');

  // The word arrives on the board — as its spelling, at the node its *pronunciation* names.
  await expect(page.locator(`[data-word="${next}"]`)).toContainText(typed);
  // Nothing was refused: the guess bar is now asking from the word just reached.
  await expect(page.locator('body')).not.toContainText('isn’t in the word list');
});

test('says it does not know a word rather than calling it a non-word', async ({ page }) => {
  const band = phonemesBand();
  test.skip(band < 0, 'no mode in this bank is played by ear');

  const wanted = boardOnDay(todayNumber(), band);
  await page.goto(board(wanted.puzzle));
  await expect(page.locator('main svg circle').first()).toBeVisible();

  // A real word with no pronunciation in the corpus. The refusal has to name the gap in our
  // data rather than accusing the word, which is the whole reason `unknown-sound` exists.
  await page.getByRole('textbox').fill('abaciscus');
  await page.getByRole('textbox').press('Enter');
  await expect(page.locator('body')).toContainText('don’t know how');
});

/**
 * A hint is help naming the word, so it is letters — in this game as much as the other one.
 *
 * The claim is worth a test of its own because it is the one place the seam runs the other
 * way: everything else about a node here is its pronunciation, and this is the exception. It
 * is also easy to undo by accident, since the obvious thing to hand `hintLabel` is the token.
 */
test('hints are letters, not phonemes', async ({ page }) => {
  const band = phonemesBand();
  test.skip(band < 0, 'no mode in this bank is played by ear');

  const wanted = boardOnDay(todayNumber(), band);
  const { lexicon } = gameData(band);
  await page.goto(board(wanted.puzzle));
  await expect(page.locator('main svg circle').first()).toBeVisible();

  // Only a word off the answer sells its letters — one on it sells the shape of a move, and
  // one you are standing on is not a question. Which of the drawn nodes that is depends on
  // the board, so the first that answers with a count is the one this is about.
  const groups = await page.locator('main svg g[data-word]').all();
  let found: { token: string; count: string } | null = null;
  for (const group of groups) {
    const token = await group.getAttribute('data-word');
    const mark = group.locator('circle[role="button"]');
    if (!token || (await mark.count()) === 0) continue;
    await mark.first().click({ force: true });
    const [shown] = (await group.locator('text').allTextContents())
      .map((one) => one.trim())
      .filter((one) => one.length > 0);
    if (shown !== undefined && /^\d+$/.test(shown)) {
      found = { token, count: shown };
      break;
    }
  }
  expect(found, 'no word on this board sells letters').not.toBeNull();

  // The count is of the *spelling*. `died` is four letters and three phonemes, and telling
  // somebody a word has three of something they cannot count is not a hint.
  const spelled = lexicon.label(found!.token);
  expect(found!.count).toBe(String(spelled.length));

  // And what the next clicks turn up are that spelling's own letters, with dots for the rest
  // — never the transcription, which is neither typeable nor readable by most players.
  const group = page.locator(`main svg g[data-word="${found!.token}"]`);
  const mark = group.locator('circle[role="button"]').first();
  await mark.click({ force: true });
  await mark.click({ force: true });
  const [partial] = (await group.locator('text').allTextContents())
    .map((one) => one.trim())
    .filter((one) => one.length > 0);
  expect(partial).toMatch(/^[a-z·]+$/);
  expect(partial).toHaveLength(spelled.length);
  // Two letters bought, and they are in the right places.
  for (const [at, letter] of [...(partial ?? '')].entries()) {
    if (letter !== '·') expect(letter).toBe(spelled[at]);
  }
});

/**
 * The readout under the guess box has to describe the reading the game would *accept*.
 *
 * It picked the first reading and described that, which is how it came to say "not one run"
 * beneath a word that plays perfectly well — from `bears`, the first reading of `barons` is
 * `/bæɹənz/`, which is not a move, while `/bɛɹənz/` is. A readout that contradicts the judge
 * is worse than no readout: it is read as the answer, and the player never presses Guess.
 */
test('the readout describes the reading that plays, not the first one', async ({ page }) => {
  const band = phonemesBand();
  test.skip(band < 0, 'no mode in this bank is played by ear');

  const { graph, lexicon, puzzles } = gameData(band);

  /*
    A board whose opening word can move to a spelling that is said more than one way, where
    the *first* reading is not the move — the case that was wrong.

    Searched across the loaded shard rather than taken from today, because today's board need
    not have one and a test that skips itself guards nothing. Derived rather than hard-coded
    for the usual reason: a rebuild moves every id.
  */
  let found: { puzzle: (typeof puzzles)[number]; typed: string; plays: string } | null = null;
  for (const puzzle of puzzles) {
    const from = puzzle.source;
    for (const to of graph.neighbors(from)) {
      const spelling = lexicon.label(to);
      const readings = lexicon.parse(spelling);
      if (readings.length < 2 || graph.findMove(from, readings[0]!)) continue;
      const plays = readings.find((one) => graph.findMove(from, one));
      if (!plays) continue;
      found = { puzzle, typed: spelling, plays };
      break;
    }
    if (found) break;
  }
  expect(found, 'no board in this shard opens on a word said two ways').not.toBeNull();
  const { typed, plays } = found!;

  await page.goto(board(found!.puzzle));
  await expect(page.locator('main svg circle').first()).toBeVisible();
  await page.getByLabel(/Your guess/).fill(typed);

  // The transcription of the reading that plays, and no refusal.
  const readout = page.locator('form');
  await expect(readout).toContainText(lexicon.transcribe(plays));
  await expect(readout).not.toContainText('more than one place');

  // And the guess it was describing is in fact accepted.
  await page.getByRole('button', { name: 'Guess', exact: true }).click();
  await expect(page.locator('header')).toContainText('1 guessed', { ignoreCase: true });
});

test('the letters game is untouched by any of it', async ({ page }) => {
  // The seam is meant to be invisible from the other side: `PLAIN` is the identity, so a
  // letters board is drawn as the words it is stored as, with nothing underneath. Opened by
  // id rather than by a bare visit, which follows whichever band this browser last chose.
  const short = today(0);
  await page.goto(board(short.puzzle));
  await expect(page.locator('header')).toContainText(short.puzzle.source);
  await expect(page.locator(`[data-word="${short.puzzle.target}"]`)).toContainText(
    short.puzzle.target,
  );
  await expect(page.locator(`[data-word="${short.puzzle.target}"]`)).not.toContainText('/');
});
