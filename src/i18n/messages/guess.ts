/**
 * The guess bar, the readout above it, and every way a guess can be refused.
 *
 * The refusals are the careful ones. A rejection has to leave the player knowing what to
 * do differently, so each names the thing that was wrong — the run they appear to have
 * tried, the length they fell short of, the word that is not a word — rather than saying
 * no. `judgeGuess` in moves.ts decides which of these applies and hands back the message
 * with its values; nothing there formats a sentence.
 *
 * The curly apostrophes are deliberate and match the rest of the game's typography.
 */

import { defineMessages } from 'react-intl';

export const guess = defineMessages({
  from: {
    id: 'guess.from',
    defaultMessage: 'from {word}',
    description:
      'Says which word the next guess is made from. The word itself is passed in and set in mono, so it must stay a placeholder rather than being written beside this — where it goes in the sentence is not the same in every language.',
  },
  field: {
    id: 'guess.field',
    defaultMessage: 'a word',
    description: 'Placeholder in the guess field. The player types a whole word, not the piece.',
  },
  fieldLabel: {
    id: 'guess.fieldLabel',
    defaultMessage: 'Your guess, starting from {from}',
    description: 'Accessible name of the guess field. {from} is the word being guessed from.',
  },
  submit: {
    id: 'guess.submit',
    defaultMessage: 'Guess',
    description: 'The button that submits a guess.',
  },

  /* The readout, which shows what the guess would do while it is still being typed. */
  prompt: {
    id: 'guess.prompt',
    defaultMessage: 'add or remove a word',
    description: 'Shown in the readout before anything has been typed: what a move is.',
  },
  unchanged: {
    id: 'guess.unchanged',
    defaultMessage: 'unchanged',
    description: 'Shown when what has been typed is the word the player is already standing on.',
  },
  sameLength: {
    id: 'guess.sameLength',
    defaultMessage: 'same length',
    description:
      'Shown in the readout when the typed word is the same length as the current one, so no word could have been added or removed.',
  },
  notOneRun: {
    id: 'guess.notOneRun',
    defaultMessage: 'not one run',
    description:
      'Shown in the readout when the letters would change in more than one place, so there is no single piece to mark.',
  },

  /* Refusals. See `judgeGuess`. */
  empty: {
    id: 'guess.empty',
    defaultMessage: 'Type a word.',
    description: 'Refusing an empty guess.',
  },
  notLetters: {
    id: 'guess.notLetters',
    defaultMessage: 'Letters only — no spaces, digits or punctuation.',
    description: 'Refusing a guess containing anything that is not a letter.',
  },
  identical: {
    id: 'guess.identical',
    defaultMessage: 'That’s still {from}. Add or remove a word to change it.',
    description: 'Refusing a guess that is the word the player is already standing on.',
  },
  identicalShort: {
    id: 'guess.identicalShort',
    defaultMessage: 'That’s still {from}.',
    description:
      'The same refusal without the advice, for a case the caller has already ruled out. Kept so the set of refusals stays exhaustive.',
  },
  swap: {
    id: 'guess.swap',
    defaultMessage:
      '{word} is the same length as {from}. Each turn you add a whole word or remove one — you can’t swap letters.',
    description:
      'Refusing a same-length guess. Worth its own message because swapping is a different kind of move rather than an illegal one.',
  },
  scattered: {
    id: 'guess.scattered',
    defaultMessage:
      '{adding, select, true {Those letters would be added in more than one place. The word you add has to be a single unbroken run.} other {Those letters would be removed in more than one place. The word you remove has to be a single unbroken run.}}',
    description:
      'Refusing a guess whose letters differ in more than one place, so no single word was inserted or deleted. This is the case players most need explained.',
  },
  subTooShort: {
    id: 'guess.subTooShort',
    defaultMessage:
      '“{sub}” is too short — the word you add or remove needs at least {min, plural, one {# letter} other {# letters}}.',
    description:
      'Refusing a guess whose added or removed piece is shorter than the minimum. {sub} is that piece.',
  },
  tooShort: {
    id: 'guess.tooShort',
    defaultMessage:
      'Words in this puzzle are at least {min, plural, one {# letter} other {# letters}}.',
    description: 'Refusing a guessed word shorter than the puzzle’s minimum word length.',
  },
  notAWord: {
    id: 'guess.notAWord',
    defaultMessage: '{word} isn’t in the word list.',
    description: 'Refusing a guess that is not a word at all.',
  },
  subNotWord: {
    id: 'guess.subNotWord',
    defaultMessage:
      '{adding, select, true {That would add “{sub}”, which isn’t a word.} other {That would remove “{sub}”, which isn’t a word.}}',
    description:
      'Refusing a guess where the edit is one clean run but the run itself is not a word. {sub} is the reading the player most likely intended.',
  },
  noMove: {
    id: 'guess.noMove',
    defaultMessage: 'No legal move gets from {from} to {word}.',
    description: 'The last refusal: both words are real but no move joins them.',
  },
});
