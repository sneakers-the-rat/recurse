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

  chooseLength: {
    id: 'header.chooseLength',
    defaultMessage: 'Choose a length',
    description: 'Accessible name of the button that opens the length menu.',
  },
  lengthMenu: {
    id: 'header.lengthMenu',
    defaultMessage: 'Length',
    description: 'Accessible name of the open length menu itself.',
  },
  lengthHolds: {
    id: 'header.lengthHolds',
    defaultMessage: 'par {min}–{max}',
    description:
      'What a length holds, in small caps beside its name: the range of par it covers. The dash is an en dash.',
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

  par: {
    id: 'header.par',
    defaultMessage: 'par: {count, plural, one {# move} other {# moves}}',
    description: 'The shortest route through ordinary words: what the player is measured against.',
  },
  shortcuts: {
    id: 'header.shortcuts',
    defaultMessage: '{count, plural, one {# shortcut} other {# shortcuts}}',
    description:
      'How many ways through are shorter than par. Said out loud from the start: that a shortcut exists is the hook, which words it runs through is the puzzle. Never shown at zero.',
  },
  guesses: {
    id: 'header.guesses',
    defaultMessage: '{count, plural, =0 {no guesses yet} other {# guessed}}',
    description: 'Guesses made so far, beside par.',
  },
  hints: {
    id: 'header.hints',
    defaultMessage: '{count, plural, one {# hint} other {# hints}}',
    description:
      'Hints asked for. Only shown once any have been: a nought here would read as a score to protect.',
  },
});
