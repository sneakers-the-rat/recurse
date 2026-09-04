/**
 * The rules dialog, and the first-visit offer of the walkthrough.
 *
 * The central rule is the one everybody misreads: the piece you add or take out has to be
 * a *word*, not any run of letters. It is worth saying more than once and worth showing,
 * which is why the examples are here as messages rather than as pictures — a translator
 * needs to be able to see that `colorations − ratio = colons` is a demonstration and that
 * substituting a pair from their own language would serve the reader better than
 * translating the sentence around it.
 *
 * The `<w>`, `<add>` and `<cut>` tags are the game's three inks and are declared once on
 * the provider. A message can use them anywhere; see `src/i18n/provider.tsx`.
 */

import { defineMessages } from 'react-intl';

export const howto = defineMessages({
  title: {
    id: 'howto.title',
    defaultMessage: 'How to play',
    description: 'Heading of the rules dialog.',
  },
  goal: {
    id: 'howto.goal',
    defaultMessage:
      'The goal of the game is to connect two words by adding and removing words within them using as few guesses and hints as possible.',
    description: 'The whole game in one sentence, said first and said loudly.',
  },
  exampleAdd: {
    id: 'howto.exampleAdd',
    defaultMessage: 'base <add>+ ball</add> = <w>base</w><add>ball</add>',
    description:
      'Worked example of adding a word. These are English wordplay: a translator should replace the words with a pair that demonstrates the same thing in their language rather than translating these.',
  },
  exampleRemove: {
    id: 'howto.exampleRemove',
    defaultMessage:
      'colo<cut>ratio</cut>ns <cut>− ratio</cut> = <w>colons</w>',
    description:
      'Worked example of removing a word from inside another. Replace with a demonstration that works in the target language.',
  },

  rules: {
    id: 'howto.rules',
    defaultMessage: 'Rules',
    description: 'Heads the list of rules.',
  },
  ruleActive: {
    id: 'howto.ruleActive',
    defaultMessage: 'The player selects a revealed word in the graph to be the "active word"',
    description: 'Rule: where a move starts from.',
  },
  ruleAddRemove: {
    id: 'howto.ruleAddRemove',
    defaultMessage:
      'Each turn you either <add>add</add> or <cut>remove</cut> a word from the active word.',
    description: 'Rule: what a turn is. The two inks are the game’s grammar.',
  },
  ruleValidWord: {
    id: 'howto.ruleValidWord',
    defaultMessage: 'The letters you add or remove must be a single valid word.',
    description: 'Rule: the central constraint, and the one most often misread.',
  },
  ruleContiguous: {
    id: 'howto.ruleContiguous',
    defaultMessage: 'The letters you add or remove must be contiguous',
    description: 'Rule: one unbroken run.',
  },
  ruleRemainder: {
    id: 'howto.ruleRemainder',
    defaultMessage:
      'The letters that are left after adding or removing must also be a word, and that becomes the next active word.',
    description: 'Rule: what you land on has to be a word too.',
  },
  rulePosition: {
    id: 'howto.rulePosition',
    defaultMessage:
      'The added or removed word can be in any position - before, after, and especially inside the other words.',
    description: 'Rule: position. "Inside" is the case that makes the game what it is.',
  },
  ruleMinWord: {
    id: 'howto.ruleMinWord',
    defaultMessage:
      'Words within the graph must be {min, plural, one {# letter} other {# letters}} or longer',
    description: 'Rule: the shortest a word on the board can be. The number is a build setting.',
  },
  ruleMinSub: {
    id: 'howto.ruleMinSub',
    defaultMessage:
      'Words added or removed to reach new words must be {min, plural, one {# letter} other {# letters}} or longer',
    description: 'Rule: the shortest a piece can be. The number is a build setting.',
  },

  graphTitle: {
    id: 'howto.graphTitle',
    defaultMessage: 'The Graph',
    description: 'Heads the explanation of the board.',
  },
  graphSpine: {
    id: 'howto.graphSpine',
    defaultMessage:
      'The golden center line, or <add>"spine"</add> of the graph is the shortest path between the two words you\'re trying to bridge. The rest of the graph are a subset of the words surrounding the spine that provide a few possible alternative paths. All <wordlists>valid words</wordlists> can be guessed, so the nodes you see when the game start are not the only paths between the words! If you guess a word that\'s not on the graph yet, it will be added and connected to any other words that it can reach.',
    description:
      'What the board is showing and what it is not. <wordlists> is a link down to the word list section.',
  },
  graphAnyWord: {
    id: 'howto.graphAnyWord',
    defaultMessage:
      'You can guess from <em>any</em> word you have already found, not just the last one. The game ends when you complete the path between the words, but you can double-back, work from both ends, leave dead ends, etc.',
    description:
      'That a player is not on rails: the round ends when the two ends join, from either direction.',
  },

  hintsTitle: {
    id: 'howto.hintsTitle',
    defaultMessage: 'Hints',
    description: 'Heads the explanation of hints.',
  },
  hintsBody: {
    id: 'howto.hintsBody',
    defaultMessage:
      'Tap or click an undiscovered node to receive a <w>hint</w> for it. You can\'t get length or letter hints for words on the spine or on shortcuts - only hints about whether the word can be reached by adding or removing a word. Hints are unlimited, and counted alongside your guesses. First you will see the number of letters in the word, and then each subsequent tap will reveal another letter. This is not a competitive game, go ahead and do a thousand hints, challenge yourself and use no hints, whatever.',
    description:
      'What a hint buys, and that they are unlimited. The last sentence is a decision, not an aside: this game does not ration help.',
  },

  shortcutsTitle: {
    id: 'howto.shortcutsTitle',
    defaultMessage: 'Shortcuts',
    description: 'Heads the explanation of shortcuts.',
  },
  shortcutsWhy: {
    id: 'howto.shortcutsWhy',
    defaultMessage:
      'The puzzle tries to be "playable" by using a smaller list of more common words, since it\'s not fun to get sniped by a squirrelly rare word. However, also to make the game "playable," we want to allow all words that someone might consider real because it\'s frustrating to guess a real word and have it be refused.',
    description: 'Why there are two word lists at all.',
  },
  shortcutsWhat: {
    id: 'howto.shortcutsWhat',
    defaultMessage:
      'The ability to guess rare words means that some boards have <add>shortcuts</add> - paths between the two target words that are shorter than the par score, which is computed from the smaller word list.',
    description: 'What a shortcut is, and why one can exist.',
  },
  shortcutsFound: {
    id: 'howto.shortcutsFound',
    defaultMessage:
      'If your guess stumbles you onto a shortcut, the shortcut path will appear and be highlighted and be all shiny to let you know that the rest of the shortcut is possible.',
    description: 'What happens when one is found.',
  },

  wordListsTitle: {
    id: 'howto.wordListsTitle',
    defaultMessage: 'Word Lists',
    description: 'Heads the explanation of the two dictionaries.',
  },
  wordListsIntro: {
    id: 'howto.wordListsIntro',
    defaultMessage: 'Recurse uses two word lists from <scowl>SCOWL/ESDB</scowl>:',
    description: 'Where the words come from. <scowl> is a link out to the word list project.',
  },
  wordListCommon: {
    id: 'howto.wordListCommon',
    defaultMessage:
      '<b>SCOWL {size}</b> - A smaller list of more common used when constructing the puzzles, computing pars, and finding initial non-spine graph nodes.',
    description: 'The smaller dictionary: what the game shows and offers.',
  },
  wordListLegal: {
    id: 'howto.wordListLegal',
    defaultMessage: '<b>SCOWL {size}</b> - A much larger list of words that are valid as guesses.',
    description: 'The larger dictionary: what a player may guess.',
  },

  begin: {
    id: 'howto.begin',
    defaultMessage: 'Begin',
    description: 'Closes the rules dialog and returns to the board.',
  },

  /* The instruments, set apart below a rule. Not part of the game. */
  devShowing: {
    id: 'howto.devShowing',
    defaultMessage: 'Instruments are showing',
    description: 'Said beside the dev switch when the instrument panel is on.',
  },
  devOffer: {
    id: 'howto.devOffer',
    defaultMessage: 'Building this thing?',
    description: 'Said beside the dev switch when it is off, as an invitation rather than a state.',
  },
  devHide: {
    id: 'howto.devHide',
    defaultMessage: 'hide dev tools',
    description:
      'The switch, which says which way it is going rather than what it currently is — "dev mode: off" is ambiguous about which half is the button.',
  },
  devShow: {
    id: 'howto.devShow',
    defaultMessage: 'show dev tools',
    description: 'The same switch, the other way.',
  },
});

/** The first visit's offer of the walkthrough. See `Welcome.tsx`. */
export const welcome = defineMessages({
  title: {
    id: 'welcome.title',
    defaultMessage: 'New here?',
    description: 'Heading of the dialog a first visit is greeted with, once.',
  },
  what: {
    id: 'welcome.what',
    defaultMessage:
      'The game is getting from one word to another by adding or removing a whole word from inside it.',
    description: 'The rule, stated. It is not guessable from anything on screen.',
  },
  example: {
    id: 'welcome.example',
    defaultMessage: '<w>c</w><cut>our</cut><w>age</w> <cut>− our</cut> = <w>cage</w>',
    description:
      'The rule, shown. English wordplay: replace with a demonstration that works in the target language rather than translating it.',
  },
  offer: {
    id: 'welcome.offer',
    defaultMessage: 'There is a short walkthrough on a real board. It takes a couple of minutes.',
    description: 'What is being offered, and what it costs.',
  },
  take: {
    id: 'welcome.take',
    defaultMessage: 'Show me how',
    description: 'Accepts the walkthrough.',
  },
  skip: {
    id: 'welcome.skip',
    defaultMessage: 'Skip — I’ll work it out',
    description: 'Declines it. Both answers are remembered; the prompt never comes back.',
  },
  whereItWent: {
    id: 'welcome.whereItWent',
    defaultMessage: 'It stays in the menu, under “Tutorial”.',
    description:
      'What declining costs, which is nothing, said where the decision is made — or the choice is not a real one.',
  },
});
