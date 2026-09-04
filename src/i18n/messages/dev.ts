/**
 * The instrument panel, and the two states the app can be in before there is a board.
 *
 * Dev mode's words are here for the same reason every other word is: the rule is that a
 * string a human reads is in the catalog, and a rule with an exception in it is a rule
 * nobody can check. They are terse on purpose — this is a bar of instruments, not part of
 * the game — and a translator can leave them alone without any harm done.
 *
 * The load-failure page is the other thing here, and it is not dev-only: it is what a
 * player sees when the data will not load. The underlying error is *not* translated. It
 * is a `fetch` failure or a version mismatch, written for whoever reads a console, and
 * turning it into a sentence would lose the one thing it is good for.
 */

import { defineMessages } from 'react-intl';

export const dev = defineMessages({
  bar: {
    id: 'dev.bar',
    defaultMessage: 'DEV',
    description: 'Marks the instrument bar, so a screenshot of it is never mistaken for the game.',
  },
  prev: {
    id: 'dev.prev',
    defaultMessage: 'Previous puzzle',
    description: 'Accessible name of the back arrow, which steps the calendar.',
  },
  next: {
    id: 'dev.next',
    defaultMessage: 'Next puzzle',
    description: 'Accessible name of the forward arrow.',
  },
  position: {
    id: 'dev.position',
    defaultMessage: '{index}/{total}',
    description: 'Where in the bank the board on screen is.',
  },
  goTo: {
    id: 'dev.goTo',
    defaultMessage: 'go to',
    description: 'Placeholder in the field that jumps to a puzzle by number.',
  },
  goToLabel: {
    id: 'dev.goToLabel',
    defaultMessage: 'Jump to puzzle number',
    description: 'Accessible name of that field.',
  },
  findSource: {
    id: 'dev.findSource',
    defaultMessage: 'source',
    description: 'Placeholder in the first field of the pair lookup.',
  },
  findTarget: {
    id: 'dev.findTarget',
    defaultMessage: 'target',
    description: 'Placeholder in the second.',
  },
  findWaiting: {
    id: 'dev.findWaiting',
    defaultMessage: '…',
    description:
      'Stands in for both until the pair index has been fetched, which happens on the first keystroke here.',
  },
  findLabel: {
    id: 'dev.findLabel',
    defaultMessage: 'Find a puzzle by its {which} word',
    description: 'Accessible name of a lookup field. {which} is "source" or "target".',
  },
  openPair: {
    id: 'dev.openPair',
    defaultMessage: 'Open the puzzle about these two words',
    description: 'Accessible name of the button that opens the board the lookup found.',
  },
  open: {
    id: 'dev.open',
    defaultMessage: 'open',
    description: 'On that button when the two words name a board.',
  },
  noPair: {
    id: 'dev.noPair',
    defaultMessage: 'no pair',
    description: 'On that button when they do not.',
  },
  find: {
    id: 'dev.find',
    defaultMessage: 'find',
    description: 'On that button before the index has arrived.',
  },

  id: { id: 'dev.id', defaultMessage: 'id', description: 'The board’s address, which the survey quotes.' },
  par: { id: 'dev.par', defaultMessage: 'par', description: 'The board’s par.' },
  routes: {
    id: 'dev.routes',
    defaultMessage: 'routes',
    description: 'How many shortest routes through there are.',
  },
  corridor: {
    id: 'dev.corridor',
    defaultMessage: 'corridor',
    description: 'How many nodes the builder put on the board, before the player strayed.',
  },
  alt: {
    id: 'dev.alt',
    defaultMessage: 'alt',
    description: 'How many drawn words are off the answer.',
  },
  rank: { id: 'dev.rank', defaultMessage: 'rank', description: 'The board’s widest rung.' },
  guessed: {
    id: 'dev.guessed',
    defaultMessage: 'guessed',
    description: 'Guesses made so far in this round.',
  },

  nameAll: {
    id: 'dev.nameAll',
    defaultMessage: 'name all',
    description:
      'Labels every word on the board at once. An inspection, never a hint: it is not counted and not written down.',
  },
  solve: {
    id: 'dev.solve',
    defaultMessage: 'solve',
    description: 'Walks the answer in one click. Never recorded in the history.',
  },
  reset: {
    id: 'dev.reset',
    defaultMessage: 'reset',
    description: 'Starts this board again.',
  },
  hide: {
    id: 'dev.hide',
    defaultMessage: 'hide ⌃D',
    description:
      'Puts the instruments away. Says the key as well, because with the bar gone it is the only way back.',
  },
  hideLabel: {
    id: 'dev.hideLabel',
    defaultMessage: 'Hide dev mode',
    description: 'Accessible name of that button.',
  },

  answer: {
    id: 'dev.answer',
    defaultMessage: 'answer',
    description: 'Introduces the route par is measured on.',
  },
  noPath: {
    id: 'dev.noPath',
    defaultMessage: 'no path',
    description: 'Shown when there is no route to print, which should not happen.',
  },
  secret: {
    id: 'dev.secret',
    defaultMessage: 'secret{n, select, none {} other { {n}}}',
    description:
      'Introduces a route shorter than par. Numbered only when there is more than one, since a lone "secret 1" reads as though others were missing.',
  },

  /* Before there is a board. */
  loadFailed: {
    id: 'dev.loadFailed',
    defaultMessage: 'The puzzle didn’t load',
    description:
      'Heading of the page shown when the game data will not load. Seen by players, not only by developers.',
  },
  rebuild: {
    id: 'dev.rebuild',
    defaultMessage: 'Run npm run data to rebuild it',
    description:
      'What to do about it. Aimed at whoever is running the game locally, which is who sees this most.',
  },
  loading: {
    id: 'dev.loading',
    defaultMessage: 'Shuffling',
    description:
      'Shown while the word data is being fetched, which is a few megabytes and a real wait.',
  },
  outOfStep: {
    id: 'dev.outOfStep',
    defaultMessage: 'the puzzle data is out of step with the app: rebuild it',
    description:
      'Shown on that page when the data loaded but is a version this build cannot read.',
  },
});

/**
 * What the three lengths are called.
 *
 * The builder writes "short", "medium" and "long" into the manifest from
 * `RECURSE_BAND_CUTS`, so these names arrive as *data* rather than from the code. The
 * client looks a name up here and falls back to whatever the data said, which means a band
 * renamed or added in the builder still draws — it simply draws untranslated until somebody
 * adds a message for it. See `bandName` in `src/i18n/bands.ts`.
 */
export const bands = defineMessages({
  short: {
    id: 'bands.short',
    defaultMessage: 'short',
    description: 'The day’s shortest board. Par 3–4 as the bank currently stands.',
  },
  medium: {
    id: 'bands.medium',
    defaultMessage: 'medium',
    description: 'The day’s middle board.',
  },
  long: {
    id: 'bands.long',
    defaultMessage: 'long',
    description: 'The day’s longest board.',
  },
});
