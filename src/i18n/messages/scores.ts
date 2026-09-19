/**
 * The low score screen, and taking a name for it.
 *
 * Careful about one word throughout: this is a game where **lower is better**, so nothing here
 * may call a score high. "Fewest guesses" says the direction in the heading and every other
 * line can then be plain.
 *
 * "Anonymous" is here and not in the data. The server stores a null name for somebody who has
 * not registered, and this is the word that draws it — so it is translated, and a scoreboard in
 * French does not have an English word down one side of it.
 *
 * The refusals say what to do next where there is anything to do. `offline` deliberately does
 * not apologise: the round is safe on the player's own device, the board is a nicety, and a
 * sentence that sounded like something had gone wrong would be a lie about their score.
 */

import { defineMessages } from 'react-intl';

export const scores = defineMessages({
  /* The panel itself. */
  heading: {
    id: 'scores.heading',
    defaultMessage: 'Fewest guesses',
    description:
      'Heading of the score table shown when a round ends. Lower is better in this game, so the heading says the direction rather than calling it a high score.',
  },
  waiting: {
    id: 'scores.waiting',
    defaultMessage: 'Reading the board…',
    description: 'Shown while the list of other players’ scores is being fetched.',
  },
  offline: {
    id: 'scores.offline',
    defaultMessage: 'No board just now',
    description:
      'Shown when the optional score server could not be reached. Deliberately not an apology: the player’s round is safely recorded on their own device either way.',
  },
  nobody: {
    id: 'scores.nobody',
    defaultMessage: 'First one here',
    description:
      'Shown when nobody else has finished this puzzle yet, so the score table has only the player on it.',
  },
  anonymous: {
    id: 'scores.anonymous',
    defaultMessage: 'anonymous',
    description:
      'Stands in for the name of a player who has not registered. The server stores no name at all; this is the word that draws one.',
  },
  you: {
    id: 'scores.you',
    defaultMessage: 'you',
    description: 'Marks the player’s own row in the score table.',
  },
  /* Column headings. Short, because the table is narrow on a phone. */
  rank: {
    id: 'scores.rank',
    defaultMessage: 'Rank',
    description: 'Column heading: position on the score table, 1 being fewest guesses.',
  },
  player: {
    id: 'scores.player',
    defaultMessage: 'Player',
    description: 'Column heading: who played the round.',
  },
  guesses: {
    id: 'scores.guesses',
    defaultMessage: 'Guesses',
    description: 'Column heading: how many guesses the round took. The score, and lower is better.',
  },
  hints: {
    id: 'scores.hints',
    defaultMessage: 'Hints',
    description: 'Column heading: how many hints were bought during the round.',
  },
  players: {
    id: 'scores.players',
    defaultMessage: '{count, plural, one {# finished} other {# finished}}',
    description:
      'How many people have finished this puzzle in total, shown beside the table when it shows only the first few.',
  },

  /* Having a name on it. */
  playingAs: {
    id: 'scores.playingAs',
    defaultMessage: 'Playing as {name}',
    description: 'Says which registered name the player’s scores appear under.',
  },
  playingAnonymously: {
    id: 'scores.playingAnonymously',
    defaultMessage: 'Your scores are anonymous',
    description:
      'Says that the player has not registered, so their rows on the score table carry no name.',
  },
  takeAName: {
    id: 'scores.takeAName',
    defaultMessage: 'Take a name',
    description: 'Button that opens the form for choosing a username and password.',
  },
  signOut: {
    id: 'scores.signOut',
    defaultMessage: 'Sign out',
    description: 'Button that forgets the account on this device.',
  },
  username: {
    id: 'scores.username',
    defaultMessage: 'Name',
    description: 'Label of the username field.',
  },
  password: {
    id: 'scores.password',
    defaultMessage: 'Password',
    description: 'Label of the password field.',
  },
  join: {
    id: 'scores.join',
    defaultMessage: 'Take it',
    description: 'Button that registers the chosen name and password.',
  },
  comeBack: {
    id: 'scores.comeBack',
    defaultMessage: 'I have one',
    description: 'Button that signs in to an account the player already has.',
  },
  cancel: {
    id: 'scores.cancel',
    defaultMessage: 'Not now',
    description: 'Button that closes the name form without doing anything.',
  },
  keepsHistory: {
    id: 'scores.keepsHistory',
    defaultMessage: 'Everything you have already played keeps counting — it becomes this name’s.',
    description:
      'Reassurance beside the registration form. Registering names the player row that already exists, so an anonymous history is not lost.',
  },
  noReset: {
    id: 'scores.noReset',
    defaultMessage: 'There are no email addresses here, so a forgotten password cannot be reset.',
    description:
      'Warning beside the registration form. The game stores no email, so there is no way to recover an account.',
  },
  rules: {
    id: 'scores.rules',
    defaultMessage:
      '{min}–{max} characters: letters, digits, - and _. A password of at least {least}.',
    description:
      'What a username and password may be, shown under the fields so the rules are known before the form is sent.',
  },

  /* What went wrong, where there is something to do about it. */
  taken: {
    id: 'scores.taken',
    defaultMessage: 'That name is taken. Try another.',
    description: 'Refusal: somebody else already registered that username.',
  },
  wrong: {
    id: 'scores.wrong',
    defaultMessage: 'That name and password do not go together.',
    description:
      'Refusal on signing in. Says nothing about which half was wrong, because the server does not either.',
  },
  invalid: {
    id: 'scores.invalid',
    defaultMessage: 'That name or password is not allowed.',
    description: 'Refusal: the username or password does not follow the rules above.',
  },
  tooFast: {
    id: 'scores.tooFast',
    defaultMessage: 'Too many tries just now. Give it a minute.',
    description: 'Refusal: the server is rate-limiting this caller.',
  },
  wentWrong: {
    id: 'scores.wentWrong',
    defaultMessage: 'That did not work. Try again in a moment.',
    description:
      'Refusal for everything else — the server being unreachable, or something going wrong at its end.',
  },
});
