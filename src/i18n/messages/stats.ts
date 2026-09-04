/**
 * `/stats`: every round finished, and the figures derived from them.
 *
 * Three of these are arguments rather than labels, and the prose says so. ±par is three
 * numbers because the bands are not evenly stocked; shortcuts get a denominator because
 * "3 found" is meaningless; there is one streak rather than three because three parallel
 * streaks is three ways to feel bad. Keep the reasoning if these are rewritten.
 *
 * The refusals at the bottom are read by players, so they are messages — unlike the errors
 * thrown in `data.ts`, which are for whoever is reading a console.
 */

import { defineMessages } from 'react-intl';

export const stats = defineMessages({
  title: {
    id: 'stats.title',
    defaultMessage: 'Stats',
    description: 'Heading of the record page.',
  },
  puzzles: {
    id: 'stats.puzzles',
    defaultMessage: 'Puzzles',
    description: 'Link from the record page to the archive.',
  },
  empty: {
    id: 'stats.empty',
    defaultMessage: 'Nothing here yet.',
    description: 'Shown when no round has been finished.',
  },

  /* The four figures at the top. */
  rounds: {
    id: 'stats.rounds',
    defaultMessage: 'rounds finished',
    description: 'How many rounds have been completed, all told.',
  },
  guessesPerRound: {
    id: 'stats.guessesPerRound',
    defaultMessage: 'guesses per round',
    description: 'Average guesses across every finished round.',
  },
  parNote: {
    id: 'stats.parNote',
    defaultMessage: 'par {par}',
    description: 'The average par those rounds were played against, under the guess average.',
  },
  againstPar: {
    id: 'stats.againstPar',
    defaultMessage: 'against par',
    description: 'Average guesses minus par, signed.',
  },
  hintsPerRound: {
    id: 'stats.hintsPerRound',
    defaultMessage: 'hints per round',
    description: 'Average hints bought per finished round.',
  },

  vsPar: {
    id: 'stats.vsPar',
    defaultMessage: 'Vs. par',
    description:
      'Heads the three ±par figures, one per length. Three numbers rather than one because the lengths are not evenly stocked, so a blend would mostly say which came up.',
  },
  roundsAt: {
    id: 'stats.roundsAt',
    defaultMessage: '{count, plural, one {# round} other {# rounds}}',
    description: 'How many rounds went into one length’s figure.',
  },
  noneYet: {
    id: 'stats.noneYet',
    defaultMessage: '—',
    description: 'Stands in for a figure at a length nothing has been played at.',
  },

  streak: {
    id: 'stats.streak',
    defaultMessage: 'Streak',
    description: 'Heads the streak figures.',
  },
  dayStreak: {
    id: 'stats.dayStreak',
    defaultMessage: 'day streak',
    description:
      'Consecutive days some board was finished, at any length. One streak, not three.',
  },
  longestStreak: {
    id: 'stats.longestStreak',
    defaultMessage: 'longest streak',
    description: 'The best such run so far.',
  },
  sweeps: {
    id: 'stats.sweeps',
    defaultMessage: 'clean sweeps',
    description: 'Days on which all three lengths were finished.',
  },
  sweepNote: {
    id: 'stats.sweepNote',
    defaultMessage: 'all three in a day',
    description: 'Explains what a clean sweep is.',
  },

  history: {
    id: 'stats.history',
    defaultMessage: 'History',
    description: 'Heads the charts.',
  },
  addsUpTo: {
    id: 'stats.addsUpTo',
    defaultMessage: 'What that adds up to',
    description: 'Heads the three sentences drawn from the record.',
  },

  noShortcuts: {
    id: 'stats.noShortcuts',
    defaultMessage: 'No board you have finished had a way through shorter than par.',
    description: 'Said when no finished board offered a shortcut at all.',
  },
  shortcutsFound: {
    id: 'stats.shortcutsFound',
    defaultMessage:
      'You found <gilt>{found}</gilt> of {offered, plural, one {the one shortcut} other {the {offered} shortcuts}} you were offered.',
    description:
      'Shortcuts found against shortcuts offered. The denominator is what makes it a score rather than a count. <gilt> sets the number in gilt.',
  },
  noGuesses: {
    id: 'stats.noGuesses',
    defaultMessage: 'You have not made a guess yet.',
    description: 'Said in place of the directness sentence when nothing has been guessed.',
  },
  directness: {
    id: 'stats.directness',
    defaultMessage:
      '<pct>{percent}%</pct> of your guesses landed on a shortest route — {on} of {total}. The rest was exploring.',
    description:
      'How often a guess was on a shortest route. Straying is not a fault, which is why the last clause is there.',
  },
  noHints: {
    id: 'stats.noHints',
    defaultMessage: 'You have never asked for a hint.',
    description: 'Said when no hint has ever been bought.',
  },
  lettersBought: {
    id: 'stats.lettersBought',
    defaultMessage: 'You have bought {count, plural, one {# letter} other {# letters}}.',
    description: 'How many letters have been bought across every round.',
  },

  keepMeeting: {
    id: 'stats.keepMeeting',
    defaultMessage: 'Words you keep meeting',
    description: 'Heads the words that have appeared on the most finished boards.',
  },
  wordCount: {
    id: 'stats.wordCount',
    defaultMessage: '×{count}',
    description: 'How many times one word has come up. The multiplication sign is a mark.',
  },

  everyRound: {
    id: 'stats.everyRound',
    defaultMessage: 'Every round',
    description: 'Heads the list of finished rounds.',
  },
  allLengths: {
    id: 'stats.allLengths',
    defaultMessage: 'all',
    description: 'The filter that shows every length at once.',
  },
  noneAtLength: {
    id: 'stats.noneAtLength',
    defaultMessage: 'no rounds at this length yet',
    description: 'Shown when the length filter matches nothing.',
  },

  /* Taking it away, and throwing it away. */
  export: {
    id: 'stats.export',
    defaultMessage: 'Export',
    description: 'Heads the export section, and labels the button that opens it.',
  },
  localOnly: {
    id: 'stats.localOnly',
    defaultMessage:
      'All your data is stored locally in your browser, so if that’s annoying you can export/import and sync between computers to keep it.',
    description: 'Says where the record lives and why there is a way out of it.',
  },
  import: {
    id: 'stats.import',
    defaultMessage: 'Import',
    description: 'Opens the import half.',
  },
  clear: {
    id: 'stats.clear',
    defaultMessage: 'Clear',
    description: 'Opens the confirmation for throwing the whole record away.',
  },
  download: {
    id: 'stats.download',
    defaultMessage: 'Download the file',
    description: 'Saves the record as a JSON file.',
  },
  copyText: {
    id: 'stats.copyText',
    defaultMessage: 'Copy the text',
    description:
      'Puts the record on the clipboard. Offered beside the download because a file on a phone goes somewhere nobody can find.',
  },
  copied: {
    id: 'stats.copied',
    defaultMessage: 'Copied',
    description: 'Shown on that button afterwards.',
  },
  asText: {
    id: 'stats.asText',
    defaultMessage: 'Your stats, as text',
    description: 'Names the block holding the exported record.',
  },
  importNote: {
    id: 'stats.importNote',
    defaultMessage:
      'A pair you already have is kept as it is — whole, never half of each. Stats only: games in progress stay where they are.',
    description: 'The merge rule, said before anything is merged.',
  },
  chooseFile: {
    id: 'stats.chooseFile',
    defaultMessage: 'A stats file to import',
    description: 'Accessible name of the file picker.',
  },
  pasteLabel: {
    id: 'stats.pasteLabel',
    defaultMessage: 'Stats to import, pasted',
    description: 'Accessible name of the paste box.',
  },
  pastePlaceholder: {
    id: 'stats.pastePlaceholder',
    defaultMessage: '…or paste it here',
    description: 'Placeholder in that box.',
  },
  readIt: {
    id: 'stats.readIt',
    defaultMessage: 'Read it',
    description:
      'Considers what an import would do without doing it. A merge that happened the instant a file was picked would be a merge nobody agreed to.',
  },
  offer: {
    id: 'stats.offer',
    defaultMessage:
      '{added} new, {kept} already here (kept yours){dropped, plural, =0 {} one {, # unreadable and dropped} other {, # unreadable and dropped}}.',
    description: 'What importing this file would do, in numbers, before it is done.',
  },
  nothingToAdd: {
    id: 'stats.nothingToAdd',
    defaultMessage: 'Nothing to add',
    description: 'Shown on the confirm button when the file holds nothing new.',
  },
  importThem: {
    id: 'stats.importThem',
    defaultMessage: 'Import them',
    description: 'Confirms the merge.',
  },
  imported: {
    id: 'stats.imported',
    defaultMessage: 'Imported {count, plural, one {# round} other {# rounds}}.',
    description: 'Said afterwards.',
  },
  clearWarning: {
    id: 'stats.clearWarning',
    defaultMessage:
      'This throws away all {count, plural, one {# round} other {# rounds}}, and there is nowhere else they exist. Export first if you might want them.',
    description:
      'The confirmation for clearing. It says where the data is not, which is the whole reason the export button is beside it.',
  },
  exportFirst: {
    id: 'stats.exportFirst',
    defaultMessage: 'Export first',
    description: 'Goes to the export instead of clearing.',
  },
  clearItAll: {
    id: 'stats.clearItAll',
    defaultMessage: 'Clear it all',
    description: 'Confirms the clear.',
  },
  keepIt: {
    id: 'stats.keepIt',
    defaultMessage: 'Keep it',
    description: 'Backs out of the clear.',
  },
  cleared: {
    id: 'stats.cleared',
    defaultMessage: 'Cleared.',
    description: 'Said afterwards.',
  },

  /* Refusing a file. Read by players, so said in a sentence. */
  notAFile: {
    id: 'stats.notAFile',
    defaultMessage: 'That is not a file this can read — it is not even JSON.',
    description: 'Refusing something that will not parse at all.',
  },
  notOurs: {
    id: 'stats.notOurs',
    defaultMessage: 'That is not a ReCurse stats file.',
    description: 'Refusing valid JSON that is not this game’s export.',
  },
  tooNew: {
    id: 'stats.tooNew',
    defaultMessage:
      'That file was written by a newer version of ReCurse ({version}, and this one reads {reads}). Update the game and try again.',
    description:
      'Refusing an export from a later version. The one place the record says no rather than salvaging what it can.',
  },

  /* The charts. `chart.ts` turns records into coordinates; these name what is drawn. */
  scoreTitle: {
    id: 'stats.scoreTitle',
    defaultMessage: 'Vs. Par History',
    description: 'Title of the scatter of every round against par.',
  },
  scoreLabel: {
    id: 'stats.scoreLabel',
    defaultMessage: 'Guesses against par, one mark per round',
    description: 'Accessible description of that chart.',
  },
  scoreMean: {
    id: 'stats.scoreMean',
    defaultMessage: 'mean {mean}',
    description: 'The average, in the caption. Already signed by the caller.',
  },
  histogramTitle: {
    id: 'stats.histogramTitle',
    defaultMessage: 'Vs. Par Distribution',
    description: 'Title of the histogram of scores against par.',
  },
  histogramLabel: {
    id: 'stats.histogramLabel',
    defaultMessage: 'How many rounds came in at each score against par',
    description: 'Accessible description of that chart.',
  },
  hintTitle: {
    id: 'stats.hintTitle',
    defaultMessage: 'Hints per round',
    description: 'Title of the stacked hint chart.',
  },
  hintLabel: {
    id: 'stats.hintLabel',
    defaultMessage: 'Hints bought per round',
    description: 'Accessible description of that chart.',
  },
  hintMost: {
    id: 'stats.hintMost',
    defaultMessage: 'most {most}',
    description: 'The tallest column, in the caption.',
  },
  hintLetters: {
    id: 'stats.hintLetters',
    defaultMessage: 'letters',
    description: 'Key for the letters half of the stack.',
  },
  hintShapes: {
    id: 'stats.hintShapes',
    defaultMessage: 'move shapes',
    description:
      'Key for the other half: hints on words of the answer, which sell the direction of a move rather than letters.',
  },
  chartEmpty: {
    id: 'stats.chartEmpty',
    defaultMessage: 'nothing yet',
    description: 'Stands in for a chart with no rounds behind it.',
  },
  noHintsAsked: {
    id: 'stats.noHintsAsked',
    defaultMessage: 'no hints asked for',
    description:
      'Stands in for the hint chart when rounds have been played but no hint bought — which is a different thing from no rounds, and says the opposite about the player.',
  },
});
