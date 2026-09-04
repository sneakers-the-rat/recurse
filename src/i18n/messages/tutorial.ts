/**
 * The walkthrough: every card, every prompt, and the chrome around them.
 *
 * **These name a particular board's words.** The lesson is taught on `showing → towing`
 * and the prose says `shadowing`, `sowing`, `wing`, `owing`, `bestowing` out loud, because
 * a walkthrough that pointed at unnamed things would be teaching nothing. That is a
 * constraint on translating them: the *words* are the board and cannot change, so what a
 * translator changes is the sentences around them. If the board ever changes, these change
 * with it — see `LESSON.puzzle` in `components/lessons.tsx`.
 *
 * The prompts are the lines a player acts on, so they stay short and say one thing. A card
 * can hold several of them, one per beat.
 */

import { defineMessages } from 'react-intl';

export const tutorial = defineMessages({
  /* The chrome the cards sit in. */
  name: {
    id: 'tutorial.name',
    defaultMessage: 'Tutorial',
    description: 'Accessible name of the walkthrough’s own panel.',
  },
  leave: {
    id: 'tutorial.leave',
    defaultMessage: 'leave',
    description: 'Ends the walkthrough and hands the board back.',
  },
  startOver: {
    id: 'tutorial.startOver',
    defaultMessage: 'start over',
    description:
      'Empties what the lesson remembers and begins again. Offered wherever it is picked up, because a lesson that remembers needs a way to forget.',
  },
  progress: {
    id: 'tutorial.progress',
    defaultMessage: '{at}/{of}',
    description: 'How far through the lesson this beat is. Moves per beat, not per card.',
  },
  back: {
    id: 'tutorial.back',
    defaultMessage: 'Previous step',
    description: 'Accessible name of the back arrow.',
  },
  on: {
    id: 'tutorial.on',
    defaultMessage: 'Next step',
    description: 'Accessible name of the forward arrow.',
  },
  finish: {
    id: 'tutorial.finish',
    defaultMessage: 'Finish the tutorial',
    description: 'Accessible name of the last button, which is always pressable.',
  },
  done: {
    id: 'tutorial.done',
    defaultMessage: 'Done',
    description: 'The word on that last button.',
  },

  wrongBoardTitle: {
    id: 'tutorial.wrongBoardTitle',
    defaultMessage: 'The tutorial’s board is not in this bank',
    description:
      'Shown when the puzzle the lesson is taught on is missing. Its steps name that board’s own words, so teaching them over another board would be nonsense.',
  },
  wrongBoardBody: {
    id: 'tutorial.wrongBoardBody',
    defaultMessage:
      'It is taught on one particular puzzle, <w>{id}</w>, and a rebuild that changed that puzzle’s answer changed its address. Point <w>LESSON.puzzle</w> at a board that is still there, and rewrite the steps that name its words.',
    description: 'What to do about it. Read by whoever is building the game, not by a player.',
  },
  backToToday: {
    id: 'tutorial.backToToday',
    defaultMessage: 'Back to today',
    description: 'Leaves that message for the ordinary board.',
  },

  /* Card 1: what a move is. */
  welcomeTitle: {
    id: 'tutorial.welcomeTitle',
    defaultMessage: 'Words inside words',
    description: 'Title of the first card.',
  },
  welcomeRule: {
    id: 'tutorial.welcomeRule',
    defaultMessage:
      'Every move takes one whole word out of another, or puts one in. What is left has to be a word too.',
    description: 'The central rule, said before anything is asked of the player.',
  },
  welcomeExamples: {
    id: 'tutorial.welcomeExamples',
    defaultMessage:
      '<w>base</w> <add>+ ball</add> = <w>base</w><add>ball</add><br></br><w>colo</w><cut>ratio</cut><w>ns</w> <cut>− ratio</cut> = <w>colons</w>',
    description:
      'Two worked examples. English wordplay: replace with demonstrations that work in the target language.',
  },
  welcomeShape: {
    id: 'tutorial.welcomeShape',
    defaultMessage:
      'The piece you add or take out must be a word, must be in one run, and can sit anywhere - including in the middle.',
    description: 'The three constraints on a move, stated together.',
  },

  /* Card 2: the puzzle statement. */
  statementTitle: {
    id: 'tutorial.statementTitle',
    defaultMessage: 'The game',
    description: 'Title of the card about the statement at the top of the screen.',
  },
  statementWhat: {
    id: 'tutorial.statementWhat',
    defaultMessage:
      'The puzzle is stated at the top: connect <w>showing</w> and <w>towing</w>. You can move from any revealed node, so you can work from either end, backtrack and make a new branch, whatever.',
    description:
      'Names this lesson’s board. The two words are the board itself and stay as they are.',
  },
  statementGoal: {
    id: 'tutorial.statementGoal',
    defaultMessage:
      'The goal of the game is to <b>connect the two target words</b> by guessing some path between them using <b>as few guesses and hints as possible</b>.',
    description: 'What winning is, and what the score is.',
  },

  /* Card 3: par and the tally. */
  parTitle: {
    id: 'tutorial.parTitle',
    defaultMessage: 'Scoring',
    description: 'Title of the card about par.',
  },
  parWhat: {
    id: 'tutorial.parWhat',
    defaultMessage:
      '<w>par</w> is the shortest way through using ordinary words: four moves here. Your guesses and hints are counted beside it.',
    description: 'What par means. Four is this board’s par.',
  },
  parRelax: {
    id: 'tutorial.parRelax',
    defaultMessage:
      'Lower numbers of guesses and hints are better, but this isn\'t a competitive game: both are unlimited, and there\'s no penalty to wander off and explore the board. Especially if you\'re new, don\'t worry about keeping a tidy board or making optimal guesses. Take some time to fill in the board with guesses to get a feel for the game. If you\'re frustrated, get more hints!',
    description:
      'That the score is not a punishment. A decision about what the game is, not an aside.',
  },

  /* Card 4: the board. */
  boardTitle: {
    id: 'tutorial.boardTitle',
    defaultMessage: 'The Board',
    description: 'Title of the card about the figure.',
  },
  boardSpine: {
    id: 'tutorial.boardSpine',
    defaultMessage:
      'The gold line down the middle is the "spine" - the shortest way through using only common words. Its words are unnamed dots for now.',
    description: 'What the gilt line is.',
  },
  boardAround: {
    id: 'tutorial.boardAround',
    defaultMessage:
      'Around it are words that lead somewhere without being shortest. Every puzzle has many non-spine paths between the target words - a winning path does not need to touch the spine!',
    description: 'That the spine is not the only way through.',
  },

  /* Card 5: the first guess. */
  firstMoveTitle: {
    id: 'tutorial.firstMoveTitle',
    defaultMessage: 'babbies first move',
    description: 'Title of the card that asks for the first guess.',
  },
  firstMoveWhere: {
    id: 'tutorial.firstMoveWhere',
    defaultMessage:
      'The word with a gold ring around it is the word you are guessing from. Make moves by typing in the guess box.',
    description: 'Where a guess starts from, and where it is typed.',
  },
  firstMoveWhole: {
    id: 'tutorial.firstMoveWhole',
    defaultMessage:
      'Type the whole word you are guessing, not the piece. The game works out which piece you meant.',
    description: 'The one thing about the input that is not obvious.',
  },
  firstMoveWhich: {
    id: 'tutorial.firstMoveWhich',
    defaultMessage:
      'The next spine word after <w>showing</w> is <w>shadowing</w>, made by putting <add>ad</add> in the middle of it like <w>sh·</w><add>ad</add><w>·owing</w>',
    description:
      'The move to make, shown as well as named. An insertion inside a word, which is the thing newcomers misread the game as not doing.',
  },
  firstMoveAsk: {
    id: 'tutorial.firstMoveAsk',
    defaultMessage: 'Type shadowing and guess.',
    description: 'The prompt. Names this board’s word.',
  },

  /* Card 6: what a move looks like on the board. */
  lineTitle: {
    id: 'tutorial.lineTitle',
    defaultMessage: 'What that move look like',
    description: 'Title of the card about the drawn edge.',
  },
  lineWritten: {
    id: 'tutorial.lineWritten',
    defaultMessage:
      'The move is written along the edge: <add>+ad</add>, in gold (or <cut>red</cut> if a word was removed).',
    description: 'The grammar of an edge: gilt for letters arriving, blood for letters leaving.',
  },
  lineTicks: {
    id: 'tutorial.lineTicks',
    defaultMessage:
      'The tickmarks perpendicular from the edge of a node are an indicator of the "degree" of the node, or how many other nodes connect to it - the number of ticks isn\'t literal (i.e. there are more than 4 other words that can be reached from <w>showing</w>), but more ticks means higher degree.',
    description: 'What the fan of ticks beside a word means.',
  },

  /* Card 7: hints on an ordinary word. */
  hintWordTitle: {
    id: 'tutorial.hintWordTitle',
    defaultMessage: 'Hints!',
    description: 'Title of the card about hints.',
  },
  hintWordBody: {
    id: 'tutorial.hintWordBody',
    defaultMessage:
      'You can get hints for any undiscovered node! For non-spine nodes, the first click gives its length; every click after that reveals one more random letter.',
    description: 'What a hint on an ordinary word buys.',
  },
  hintWordAsk: {
    id: 'tutorial.hintWordAsk',
    defaultMessage: 'Click the lit dot to reveal its length.',
    description: 'First prompt of that card.',
  },
  hintWordAgain: {
    id: 'tutorial.hintWordAgain',
    defaultMessage: 'Click it again to reveal a letter.',
    description: 'Second prompt.',
  },
  hintWordMore: {
    id: 'tutorial.hintWordMore',
    defaultMessage: 'Keep revealing letters or move on',
    description: 'Third prompt, which is satisfied already and simply invites.',
  },

  /* Card 8: hints on a word of the answer. */
  hintRouteTitle: {
    id: 'tutorial.hintRouteTitle',
    defaultMessage: 'Spine Hints!',
    description: 'Title of the card about hints on the answer.',
  },
  hintRouteWhy: {
    id: 'tutorial.hintRouteWhy',
    defaultMessage: 'A spine word doesn\'t hint its length or letters, that would be too easy!',
    description: 'Why those words never give letters.',
  },
  hintRouteWhat: {
    id: 'tutorial.hintRouteWhat',
    defaultMessage:
      'Spine hints tell you how to reach a word from another. <add>+</add> by adding letters, <cut>−</cut> by taking them away.',
    description: 'What they give instead: the shape of a move.',
  },
  hintRouteRead: {
    id: 'tutorial.hintRouteRead',
    defaultMessage:
      'So a <cut>−</cut> here means to reach this word from <w>shadowing</w>, we have to remove a word, and vice versa for the <add>+</add>.',
    description: 'How to read the mark, on this board’s own words.',
  },
  hintRouteAsk: {
    id: 'tutorial.hintRouteAsk',
    defaultMessage: 'Click the gold dot to show a - hint.',
    description: 'First prompt of that card.',
  },
  hintRouteAskPlus: {
    id: 'tutorial.hintRouteAskPlus',
    defaultMessage: 'Click the gold dot until you get a + hint.',
    description: 'Second prompt.',
  },
  hintRouteAskMore: {
    id: 'tutorial.hintRouteAskMore',
    defaultMessage: 'Once more for the hell of it.',
    description: 'Third prompt, which is always satisfied.',
  },

  /* Card 9: working from the goal. */
  bothEndsTitle: {
    id: 'tutorial.bothEndsTitle',
    defaultMessage: 'Jumping around',
    description: 'Title of the card about playing from either end.',
  },
  bothEndsAny: {
    id: 'tutorial.bothEndsAny',
    defaultMessage:
      'You can guess from any word you have reached - including the goal - by tapping it.',
    description: 'That the goal is somewhere to stand, not only somewhere to arrive.',
  },
  bothEndsWhy: {
    id: 'tutorial.bothEndsWhy',
    defaultMessage:
      'Working from both ends is often easier: <w>towing</w> is <w>to·wing</w>, and taking <cut>to</cut> off gets us to "wing" which seems like the right direction.',
    description: 'The move to make, on this board’s own words.',
  },
  bothEndsAsk: {
    id: 'tutorial.bothEndsAsk',
    defaultMessage: 'Tap towing to guess from it.',
    description: 'First prompt: stand on the goal.',
  },
  bothEndsGuess: {
    id: 'tutorial.bothEndsGuess',
    defaultMessage: 'Now guess "wing"',
    description: 'Second prompt: make the move.',
  },

  /* Card 10: guessing off the board. */
  offBoardTitle: {
    id: 'tutorial.offBoardTitle',
    defaultMessage: 'Going offroad',
    description: 'Title of the card about words not drawn.',
  },
  offBoardWhat: {
    id: 'tutorial.offBoardWhat',
    defaultMessage:
      'The starting nodes on the board are a suggestion, but any word you can reach is valid. Guessing a word that isn\'t on the board adds it, along with any of its neighbors that might form a new route.',
    description: 'That the board is a suggestion rather than the rules.',
  },
  offBoardFamily: {
    id: 'tutorial.offBoardFamily',
    defaultMessage:
      'You are standing on <w>wing</w>. Two letters on the front of it is a whole family: <add>se</add>, <add>mo</add>, <add>vo</add>, <add>ca</add>.',
    description: 'Some words to try, on this board. English wordplay tied to this puzzle.',
  },
  offBoardAsk: {
    id: 'tutorial.offBoardAsk',
    defaultMessage: 'Name a word that\'s not on the board yet.',
    description: 'The prompt, satisfied by any word the board does not already draw.',
  },

  /* Card 11: shortcuts. */
  shortcutTitle: {
    id: 'tutorial.shortcutTitle',
    defaultMessage: 'Shortcuts',
    description: 'Title of the card about routes shorter than par.',
  },
  shortcutWhy: {
    id: 'tutorial.shortcutWhy',
    defaultMessage:
      'Par is measured over ordinary words, but you probably know lots of words that aren\'t so common! Sometimes there are shortcut paths through rare words, the header says when a board has one.',
    description: 'Why a shortcut can exist at all.',
  },
  shortcutThis: {
    id: 'tutorial.shortcutThis',
    defaultMessage:
      'This one does: <w>showing</w> is <cut>sh</cut><w>·owing</w>: Rare words aren\'t always long, "<w>sh</w>" is a word but not a very common one. take <cut>sh</cut> off the front, and the rest of the way through is drawn for you in gold.',
    description: 'This board’s own shortcut, shown.',
  },
  shortcutAsk: {
    id: 'tutorial.shortcutAsk',
    defaultMessage: 'Tap showing to stand on it.',
    description: 'First prompt.',
  },
  shortcutGuess: {
    id: 'tutorial.shortcutGuess',
    defaultMessage: 'Now name owing.',
    description: 'Second prompt: the guess that lights the whole shortcut.',
  },

  /* Card 12: finishing. */
  finishTitle: {
    id: 'tutorial.finishTitle',
    defaultMessage: 'Finish the game',
    description: 'Title of the last card.',
  },
  finishBody: {
    id: 'tutorial.finishBody',
    defaultMessage: 'Finish the game by reaching towing through the shortcut!',
    description: 'What is left to do.',
  },
  finishAsk: {
    id: 'tutorial.finishAsk',
    defaultMessage: 'Guess bestowing',
    description: 'First prompt of the last card.',
  },
  finishJoin: {
    id: 'tutorial.finishJoin',
    defaultMessage: 'Now finish the game by completing the connection to towing!',
    description: 'Last prompt: the move that joins the two ends.',
  },
});
