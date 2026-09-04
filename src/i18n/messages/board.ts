/**
 * What the board says out loud.
 *
 * Almost all of it is `aria-label`. The plate is one `<svg role="img">` and every word on
 * it is a labelled circle, so these *are* the board for anyone not looking at it — and
 * they carry more than a name, because what a click buys depends on the word. A word on
 * the answer sells the shape of a move; an ordinary one sells letters; a word only a
 * shortcut draws sells nothing. The label has to say which, or the board is a field of
 * identical dots.
 *
 * `state` on the word messages is a `select` rather than a set of separate messages
 * because the alternative is five near-identical sentences that drift apart in
 * translation, and the difference between them is one clause.
 */

import { defineMessages } from 'react-intl';

export const board = defineMessages({
  plate: {
    id: 'board.plate',
    defaultMessage:
      'Map of moves between {source} and {target}. {named} of {total} words named.',
    description:
      'The whole board, as one image. Read before any of the words on it, so it says what the figure is and how far in the player is.',
  },

  reached: {
    id: 'board.reached',
    defaultMessage:
      '{word}{selected, select, true {, selected} other {}}. Guess from here.',
    description:
      'A word the player has reached. Somewhere to stand, so a tap selects it rather than buying a hint.',
  },
  goal: {
    id: 'board.goal',
    defaultMessage:
      '{word}, the goal{selected, select, true {, selected} other {}}. Guess from here.',
    description:
      'The word the puzzle is aiming at. It is somewhere to stand from the first move, which is how a player works backwards from it.',
  },
  onRoute: {
    id: 'board.onRoute',
    defaultMessage: 'Unnamed word on the best route. Show which way one of its moves goes.',
    description:
      'An unnamed word on a shortest route. It never gives letters — three of the seven in such a word names it — so a click buys the direction of one of its moves instead.',
  },
  unhinted: {
    id: 'board.unhinted',
    defaultMessage: 'Unnamed word. Reveal how many letters it has.',
    description: 'An ordinary unnamed word nothing has been asked about yet.',
  },
  spelled: {
    id: 'board.spelled',
    defaultMessage: 'Unnamed word, spelled {word}. Nothing left to hint.',
    description: 'An unnamed word whose every letter has been bought.',
  },
  partly: {
    id: 'board.partly',
    defaultMessage:
      'Unnamed word, {count, plural, one {# letter} other {# letters}}{shown, select, none {} other {, showing {shown}}}. Reveal another letter.',
    description:
      'An unnamed word part-way through being spelled out. Says what the next click buys, since that is the decision being made.',
  },

  noHintOnShortcut: {
    id: 'board.noHintOnShortcut',
    defaultMessage: 'There are no hints on shortcuts!',
    description:
      'Said when a word only a shortcut draws is clicked. It gives nothing and costs nothing, and the reason is a rule the player has not met before.',
  },

  resetView: {
    id: 'board.resetView',
    defaultMessage: 'Show the whole puzzle',
    description:
      'The button that puts the camera back where the round opened. Both its accessible name and its tooltip.',
  },
  reset: {
    id: 'board.reset',
    defaultMessage: 'reset',
    description:
      'The word written on that button, which is only as long as there is room for. The name above says what it does.',
  },
});
