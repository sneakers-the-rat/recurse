/**
 * What the masthead says.
 *
 * The two menus, the day number, the puzzle statement's tally, and the names of the
 * three lengths as the switch offers them. Nothing here is a fact about a board — the
 * words and the numbers arrive as values.
 *
 * `ReCurse` itself is not here. It is a name rather than a sentence, it is drawn in two
 * spans so `Curse` can be blood-red and italic, and translating it would be translating a
 * logo. See `Header.tsx`.
 */

import { defineMessages } from 'react-intl';

export const header = defineMessages({
  day: {
    id: 'header.day',
    defaultMessage: '№ {day}',
    description: 'The puzzle number, beside the title. № is the numero sign.',
  },

  chooseBoard: {
    id: 'header.chooseBoard',
    defaultMessage: 'Choose a board',
    description:
      'Accessible name of the button that opens the board menu. A board and not a length, because the menu holds every game there is — the three lengths of each daily one, and the open map of each vocabulary.',
  },
  boardMenu: {
    id: 'header.boardMenu',
    defaultMessage: 'Board',
    description: 'Accessible name of the open board menu itself.',
  },
  lengthHolds: {
    id: 'header.lengthHolds',
    defaultMessage: '({min}–{max})',
    description:
      'What a length holds, in small caps beside its name: the range of par it covers. Bracketed numbers rather than "par 3–4", because the masthead has to fit six boards’ worth of switch onto a phone and the word is the only part a reader does not need — the two numbers beside a length are legible as its range. The dash is an en dash.',
  },

  menu: {
    id: 'header.menu',
    defaultMessage: 'Menu',
    description: 'Accessible name of the hamburger that holds the links on a phone.',
  },
  puzzles: {
    id: 'header.puzzles',
    defaultMessage: 'Puzzles',
    description: 'Link to the archive of every board already played.',
  },
  stats: {
    id: 'header.stats',
    defaultMessage: 'Stats',
    description: 'Link to the record of every round finished.',
  },
  tutorial: {
    id: 'header.tutorial',
    defaultMessage: 'Tutorial',
    description: 'Link to the walkthrough.',
  },
  howToPlay: {
    id: 'header.howToPlay',
    defaultMessage: 'How to play',
    description: 'Link that opens the rules dialog.',
  },

  /*
    The tally, as a table: a row is a label and a number, so each of these names a *column
    entry* and never the figure beside it. That is what lets the values line up on their own
    edge — see the tally in Header.tsx. Written as plurals where English has one, because the
    label sits beside the count and "1 hints" is what a table that ignores agreement reads like.
  */
  par: {
    id: 'header.par',
    defaultMessage: 'par',
    description:
      'Labels the shortest route through ordinary words — what the player is measured against. The figure beside it is a number of moves.',
  },
  shortcuts: {
    id: 'header.shortcuts',
    defaultMessage: '{count, plural, one {shortcut} other {shortcuts}}',
    description:
      'Labels how many ways through are shorter than par. Said out loud from the start: that a shortcut exists is the hook, which words it runs through is the puzzle. The row is absent at zero.',
  },
  guesses: {
    id: 'header.guesses',
    defaultMessage: 'guessed',
    description:
      'Labels the guesses made so far. A past participle rather than a noun, so it does not need agreement: "guessed 1", "guessed 12".',
  },
  hints: {
    id: 'header.hints',
    defaultMessage: '{count, plural, one {hint} other {hints}}',
    description:
      'Labels the hints asked for. The row is absent until any have been: a nought here would read as a score to protect, and hints are not something to be stingy with.',
  },
  shareBoard: {
    id: 'header.shareBoard',
    defaultMessage: 'Share',
    description:
      'Puts a link to the board as it stands on the clipboard, part-played or finished. Beside the day rather than in the menu, because it is a thing done to this board and the menu holds ways off it.',
  },
});
