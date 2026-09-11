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

  id: { id: 'dev.id', defaultMessage: 'id', description: 'The board’s address, which is what a shared link carries.' },
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

  /* The code inspector: a shared board's code, taken apart. See `ReadCode` in DevBar. */
  code: {
    id: 'dev.code',
    defaultMessage: 'id/code',
    description:
      'Placeholder in the field that takes a shared board to pieces. It accepts a bare code, an id and a code, or a whole URL — and the id is what lets a code from somebody else’s board be read without going there first.',
  },
  codeLabel: {
    id: 'dev.codeLabel',
    defaultMessage: 'A board code to read',
    description: 'The accessible name of that field.',
  },
  readCode: {
    id: 'dev.readCode',
    defaultMessage: 'read',
    description: 'The button that takes the pasted code apart.',
  },
  codeTitle: {
    id: 'dev.codeTitle',
    defaultMessage: '{chars} characters · {bits} bits',
    description:
      'Heads the inspector: how long the pasted code is, in the two units it is read in. Six bits a character.',
  },
  codeReading: {
    id: 'dev.codeReading',
    defaultMessage: 'Reading…',
    description:
      'Shown in the inspector while a pasted code is being resolved. A code naming another board has to fetch that board’s shard, and sometimes the other game’s graph, so this is a real wait rather than a flicker.',
  },
  codeRefused: {
    id: 'dev.codeRefused',
    defaultMessage:
      'Nothing read. A bare code is read against the board on screen — put the puzzle id in front of it if it came from another. Failing that it is cut short, or from another build.',
    description:
      'Shown when a pasted code will not decode. A code is only meaningful against the puzzle it was written for, so the commonest cause is a code from another board pasted without its id — and that is what the sentence leads with.',
  },
  codeSpend: {
    id: 'dev.codeSpend',
    defaultMessage: 'Where the length goes',
    description:
      'Heads the summary: bits per kind of field, dearest first. The question anybody looking at a long code is actually asking.',
  },
  codeActions: {
    id: 'dev.codeActions',
    defaultMessage: 'What it says',
    description: 'Heads the decoded round: the series of actions the code expands to.',
  },
  codeFields: {
    id: 'dev.codeFields',
    defaultMessage: 'Field by field',
    description:
      'Heads the annotated dump: every field of the code, its offset, its bits and what it names.',
  },
  closeCode: {
    id: 'dev.closeCode',
    defaultMessage: 'Close',
    description: 'Shuts the inspector.',
  },
});

/**
 * What the three lengths are called.
 *
 * Every mode declares them in `recurse.yaml` and the builder writes them into the manifest,
 * so these labels arrive as *data* rather than from the code. The client looks a label up here
 * and falls back to whatever the data said, which means a band renamed or added in the builder
 * still draws — it simply draws untranslated until somebody adds a message for it. See
 * `bandName` in `src/i18n/bands.ts`.
 *
 * Both games offer all three, so these words say a length and nothing about which game. What
 * says that is `modes` below, and the menu that groups one under the other.
 */
export const bands = defineMessages({
  short: {
    id: 'bands.short',
    defaultMessage: 'short',
    description: 'The day’s shortest board in a game. Par 3–4 as the bank currently stands.',
  },
  medium: {
    id: 'bands.medium',
    defaultMessage: 'medium',
    description: 'The day’s middle board in a game.',
  },
  long: {
    id: 'bands.long',
    defaultMessage: 'long',
    description: 'The day’s longest board in a game.',
  },
});

/**
 * What the games are called.
 *
 * Same arrangement as `bands` and for the same reason: a mode's name is written in
 * `recurse.yaml`, ships in the manifest, and falls back to itself when there is no message —
 * which is what keeps adding a game a change to one file. See `gameName`.
 */
export const modes = defineMessages({
  /**
   * A board said in full, for the places a band has to stand on its own: an archive card, the
   * share text, the list of a day's boards still going. Both games have a "short", so the
   * length alone names two different boards there and the game has to come with it.
   *
   * A message rather than a template literal because the order is a translator's to decide.
   */
  board: {
    id: 'modes.board',
    defaultMessage: '{game} {band}',
    description:
      'Names one board in full: which game, and which of its three lengths. For example "phonemes long". Shown wherever there is nothing else on the line to say which game is meant.',
  },
  letters: {
    id: 'modes.letters',
    defaultMessage: 'letters',
    description:
      'The original game, where a word is its spelling and a move finds a word inside a word by the letters it is written with.',
  },
  phonemes: {
    id: 'modes.phonemes',
    defaultMessage: 'phonemes',
    description:
      'The game played by ear, where a word is its pronunciation and a move finds a word inside a word by sound: coolest − coo = lust.',
  },
});
