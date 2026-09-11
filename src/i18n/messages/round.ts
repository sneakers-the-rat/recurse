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
    description:
      'Puts the score on the clipboard with a plain link to the puzzle — safe to post where people have not played it yet.',
  },
  copyWithBoard: {
    id: 'round.copyWithBoard',
    defaultMessage: 'Copy with board',
    description:
      'The same, but the link carries the round: whoever opens it sees the solved figure rather than a description of it. For sending to somebody, not for posting.',
  },
  copied: {
    id: 'round.copied',
    defaultMessage: 'Copied',
    description: 'Shown on whichever button was pressed for a moment afterwards. A receipt, not a state.',
  },
  copyBlocked: {
    id: 'round.copyBlocked',
    defaultMessage: 'Copying was blocked — select the text above',
    description:
      'Shown when the clipboard refuses. There is nothing to retry: the text is on screen and selectable, so this says where it is.',
  },
  linkCopied: {
    id: 'round.linkCopied',
    defaultMessage: 'Board link copied',
    description:
      'Said after the header’s share button. The link carries the board as it stands, part-played or finished.',
  },
  linkBlocked: {
    id: 'round.linkBlocked',
    defaultMessage: 'Copying was blocked by the browser',
    description:
      'Said when the clipboard refuses the header’s share button. Unlike the result text there is nothing on screen to select instead, so this says only what happened.',
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

  /*
    Somebody else's board, opened from a link that carried their round with it.

    Three short things, above the figure: whose it is, that nothing here is being kept, and
    the one thing there is to do about it. See `SharedBoard` and lib/boardCode.ts.
  */
  sharedBoard: {
    id: 'round.sharedBoard',
    defaultMessage: 'Someone else’s board',
    description:
      'Heads the strip above a board opened from a shared link. Everything on screen — the guesses, the trail, the score — belongs to whoever sent it.',
  },
  sharedNote: {
    id: 'round.sharedNote',
    defaultMessage: 'Nothing here is saved to your game',
    description:
      'Says what a shared board is: a thing to look at. It is not written down, not counted in the player’s record, and does not touch their own progress on the puzzle.',
  },
  playShared: {
    id: 'round.playShared',
    defaultMessage: 'Play it yourself',
    description:
      'Leaves a shared board for the visitor’s own game on the same puzzle, which is whatever they had left there.',
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
