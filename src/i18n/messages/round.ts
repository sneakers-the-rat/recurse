/**
 * The opening card, the end of a round, and the text a player pastes.
 *
 * The share lines are the ones to be careful with. They are read by people who have not
 * played the board, so they must give away nothing: a day, a length, a date, two counts
 * and a row of marks. Keep them that way — a message here that named a word would spoil
 * the puzzle for everyone the score is sent to.
 *
 * They are also *translated*, which is a decision worth knowing about: a player reading
 * the game in French pastes French. The marks and the link are the same either way, so a
 * trail still reads across languages even when the words above it do not.
 */

import { defineMessages } from 'react-intl';

export const round = defineMessages({
  /* The title card a round opens on, and the day line in the finished round. */
  day: {
    id: 'round.day',
    defaultMessage: 'Day {day}',
    description: 'The puzzle’s number, on the opening card and in the finished round.',
  },

  /* The verdict, which is decided by the score and nothing else. */
  secret: {
    id: 'round.secret',
    defaultMessage: 'A secret way through',
    description:
      'The heading when a player beat par, which means a rarer word cut a corner nobody expected. The loudest heading in the game.',
  },
  perfect: {
    id: 'round.perfect',
    defaultMessage: 'Perfect',
    description: 'The heading when a player finished in exactly par guesses.',
  },
  found: {
    id: 'round.found',
    defaultMessage: 'Found it',
    description: 'The heading when a player finished in more than par guesses.',
  },

  guessesStat: {
    id: 'round.guessesStat',
    defaultMessage: 'guesses',
    description: 'Label on the guess count in the result.',
  },
  parStat: {
    id: 'round.parStat',
    defaultMessage: '/ par {par}',
    description: 'Shown after the guess count, giving what it is measured against.',
  },
  hintsStat: {
    id: 'round.hintsStat',
    defaultMessage: 'hints',
    description: 'Label on the hint count in the result.',
  },
  refusedStat: {
    id: 'round.refusedStat',
    defaultMessage: 'refused',
    description: 'Label on the count of guesses the game would not accept. Hidden at zero.',
  },
  underParStat: {
    id: 'round.underParStat',
    defaultMessage: 'under par',
    description: 'Label on how many guesses under par a player came in, when they beat it.',
  },

  trail: {
    id: 'round.trail',
    defaultMessage: 'Your route, as marks',
    description:
      'Accessible name for the row of coloured squares summarising the round, one per guess.',
  },
  result: {
    id: 'round.result',
    defaultMessage: 'Result',
    description: 'Names the panel holding the verdict and the score.',
  },
  copy: {
    id: 'round.copy',
    defaultMessage: 'Copy result',
    description: 'The button that puts the share text on the clipboard.',
  },
  copied: {
    id: 'round.copied',
    defaultMessage: 'Copied',
    description: 'Shown on that button for a moment afterwards. A receipt, not a state.',
  },
  copyBlocked: {
    id: 'round.copyBlocked',
    defaultMessage: 'Copying was blocked — select the text above',
    description:
      'Shown when the clipboard refuses. There is nothing to retry: the text is on screen and selectable, so this says where it is.',
  },

  alsoToday: {
    id: 'round.alsoToday',
    defaultMessage: 'Also today',
    description: 'Introduces the day’s other lengths, offered once a round is finished.',
  },
  partway: {
    id: 'round.partway',
    defaultMessage: '· {count} in',
    description:
      'How far into another length the player already is. Shown only when they have started it, because carrying on and starting are different invitations.',
  },

  theRound: {
    id: 'round.theRound',
    defaultMessage: 'The round',
    description: 'Heads the list of every move made, below the board.',
  },
  playAgain: {
    id: 'round.playAgain',
    defaultMessage: 'Another puzzle',
    description: 'Moves on to the next board. Dev mode only.',
  },

  /* The share text. Four lines, no words that could spoil a live puzzle. */
  shareTitle: {
    id: 'round.shareTitle',
    defaultMessage: 'ReCurse Words · Day {day} · {band} · {date}',
    description:
      'First line of the pasted result: which puzzle and when. "ReCurse Words" is the game’s name and stays as it is. {band} is the length — short, medium or long.',
  },
  shareScore: {
    id: 'round.shareScore',
    defaultMessage:
      '{guesses, plural, one {# guess} other {# guesses}} · {under, select, true {par {par}, under par} other {par {par}}} · {hints, plural, one {# hint} other {# hints}}',
    description:
      'Second line of the pasted result: how it went. Beating par is said out loud, because it is the best thing that can happen in a round.',
  },
});
