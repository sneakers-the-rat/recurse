/**
 * The archive: `/puzzles`, where every board already played can be found by date or by
 * its two words.
 *
 * Dates themselves are not here. They stay `YYYY-MM-DD` wherever they are shown, because
 * a date on this page is an address as much as a caption — it is how a board is named in
 * the record and in the share text — and a localised one would say a different thing in
 * each of those places. Month *names* are language and are here, as a `select` on the
 * month number, so `archive.ts` keeps its date arithmetic and knows nothing about words.
 */

import { defineMessages } from 'react-intl';

export const archive = defineMessages({
  title: {
    id: 'archive.title',
    defaultMessage: 'Puzzles',
    description: 'Heading of the archive page.',
  },
  backToBoard: {
    id: 'archive.backToBoard',
    defaultMessage: 'back to the board',
    description: 'Leaves the archive or the stats page for whatever board is being played.',
  },
  stats: {
    id: 'archive.stats',
    defaultMessage: 'Stats',
    description: 'Link from the archive to the record of finished rounds.',
  },
  today: {
    id: 'archive.today',
    defaultMessage: 'Today’s puzzles',
    description: 'The first thing offered, because it is what most visits are after.',
  },
  todayDay: {
    id: 'archive.todayDay',
    defaultMessage: 'day {day}',
    description: 'The day number beside that link.',
  },
  byWords: {
    id: 'archive.byWords',
    defaultMessage: 'By its two words',
    description: 'Heads the search half of the archive.',
  },
  byDate: {
    id: 'archive.byDate',
    defaultMessage: 'By date',
    description: 'Heads the calendar half of the archive.',
  },

  /* Searching by word. */
  searchHint: {
    id: 'archive.searchHint',
    defaultMessage: 'Part of either word will do. Only puzzles that have already come up.',
    description:
      'Shown before anything is typed. Says the search matches substrings, and that the future is not on offer.',
  },
  fieldSource: {
    id: 'archive.fieldSource',
    defaultMessage: 'source',
    description: 'Placeholder in the field matching the first of a puzzle’s two words.',
  },
  fieldTarget: {
    id: 'archive.fieldTarget',
    defaultMessage: 'target',
    description: 'Placeholder in the field matching the second of a puzzle’s two words.',
  },
  fieldLoading: {
    id: 'archive.fieldLoading',
    defaultMessage: 'loading…',
    description:
      'Stands in for those placeholders until the index of every pair has arrived, since a search that silently matches nothing looks like a search with no answer.',
  },
  findBySource: {
    id: 'archive.findBySource',
    defaultMessage: 'Find a puzzle by its source word',
    description: 'Accessible name of the source field.',
  },
  findByTarget: {
    id: 'archive.findByTarget',
    defaultMessage: 'Find a puzzle by its target word',
    description: 'Accessible name of the target field.',
  },
  noMatches: {
    id: 'archive.noMatches',
    defaultMessage: 'No puzzle yet with those words.',
    description: 'Said when a search matches nothing that has already been played.',
  },
  matches: {
    id: 'archive.matches',
    defaultMessage:
      '{total, plural, one {# puzzle} other {# puzzles}}{capped, select, true {, showing {shown}} other {}}',
    description:
      'How many boards a search found, and how many of them are listed — a two-letter query matches thousands and nobody reads thousands.',
  },
  found: {
    id: 'archive.found',
    defaultMessage: 'Puzzles found',
    description: 'Names the group of result cards.',
  },

  /* Browsing by date. */
  monthBefore: {
    id: 'archive.monthBefore',
    defaultMessage: 'The month before',
    description: 'Accessible name of the back arrow while a month is being looked at.',
  },
  monthAfter: {
    id: 'archive.monthAfter',
    defaultMessage: 'The month after',
    description: 'Accessible name of the forward arrow while a month is being looked at.',
  },
  yearBefore: {
    id: 'archive.yearBefore',
    defaultMessage: 'The year before',
    description: 'Accessible name of the back arrow while a whole year is being looked at.',
  },
  yearAfter: {
    id: 'archive.yearAfter',
    defaultMessage: 'The year after',
    description: 'Accessible name of the forward arrow while a whole year is being looked at.',
  },
  prev: {
    id: 'archive.prev',
    defaultMessage: '‹ prev',
    description:
      'The back arrow’s own label. The guillemet is part of it; the accessible name above says what it steps by.',
  },
  next: {
    id: 'archive.next',
    defaultMessage: 'next ›',
    description: 'The forward arrow’s own label.',
  },
  reading: {
    id: 'archive.reading',
    defaultMessage: 'Reading the calendar…',
    description: 'Shown while the year file for the month on screen is still arriving.',
  },
  emptyMonth: {
    id: 'archive.emptyMonth',
    defaultMessage: 'Nothing from this month yet.',
    description:
      'Shown for a month entirely in the future, or before the game began. Every day that has happened holds three boards, so an empty month means the month is outside the archive.',
  },
  monthName: {
    id: 'archive.monthName',
    defaultMessage:
      '{month, select, 1 {January} 2 {February} 3 {March} 4 {April} 5 {May} 6 {June} 7 {July} 8 {August} 9 {September} 10 {October} 11 {November} 12 {December} other {?}} {year}',
    description:
      'The heading over a month of the calendar. Month and year together, because where the year goes is not the same in every language.',
  },
  monthShort: {
    id: 'archive.monthShort',
    defaultMessage:
      '{month, select, 1 {January} 2 {February} 3 {March} 4 {April} 5 {May} 6 {June} 7 {July} 8 {August} 9 {September} 10 {October} 11 {November} 12 {December} other {?}}',
    description: 'A month on its own, for the twelve buttons of the year view.',
  },

  /* A card, wherever it is met. */
  cardToday: {
    id: 'archive.cardToday',
    defaultMessage: ' · today',
    description:
      'Marks the current day beside its date. The separator is part of it, since it only appears with the word.',
  },
  cardTitle: {
    id: 'archive.cardTitle',
    defaultMessage: '{band}: {source} → {target}',
    description:
      'Tooltip on a puzzle card: its length and the two words. The arrow is a mark and stays as it is.',
  },
  cardWaiting: {
    id: 'archive.cardWaiting',
    defaultMessage: '…',
    description:
      'Stands in for a card’s two words while the index is still arriving, so the row keeps its shape rather than appearing under the pointer.',
  },
});
