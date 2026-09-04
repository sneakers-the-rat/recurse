/**
 * The tutorial itself: which board it is taught on, and which card says what.
 *
 * **This is still the file to edit for the *shape* of the lesson** — which cards there are,
 * what each one points at, where the camera looks, and what the player has to do before it
 * gives way. Everything structural is in `lib/tutorial.ts` and none of it needs touching to
 * reorder the lesson or teach it on another board.
 *
 * **What each card *says* is in `i18n/messages/tutorial.ts`**, like every other word in the
 * game. That is the one thing that moved: a card used to carry its own JSX prose, and the
 * words are now named rather than written here. The `<w>`, `<add>` and `<cut>` inks travel
 * inside the messages, so a translator can move a coloured piece to wherever their language
 * puts it — see `src/i18n/provider.tsx`.
 *
 * The board is `showing → towing`, and it was chosen rather than found:
 *
 *  - **Its first move is an insertion inside a word.** `showing` is `sh·owing`, and putting
 *    `ad` in the middle of it gives `shadowing`. That is the thing newcomers misread the
 *    game as not doing, and it is the very first thing they are asked to type.
 *  - **The goal has exactly one ordinary way out.** `towing − to = wing`, and nothing else -
 *    so standing on the goal and working backwards is one obvious move rather than a search,
 *    which is what makes it teachable as a *habit* rather than as a trick.
 *  - **`wing` has a hundred and sixty moves off the board**, a dozen of them ordinary words
 *    two letters different. "The board is a suggestion, not the rules" can be demonstrated
 *    rather than asserted.
 *  - **Par 4, one route through the common words, and a shortcut at 3.** Short enough to walk
 *    in a sitting, and it can teach every mechanic the game has - including the one that is
 *    otherwise hard to arrange for, since `showing − sh = owing` is a single guess that lights
 *    a whole route nobody has walked.
 *
 * The messages name that board's words, so the two travel together: change `puzzle` and the
 * prose in the catalog is wrong. A rebuild that changes this puzzle's answer changes its id,
 * and the tutorial then refuses to run rather than teaching these words over some other
 * board - see `Tutorial.tsx`.
 *
 * Three things learned by writing these, worth knowing before writing more:
 *
 * - **Spotlight what the player has to touch**, not what the card is about. The panel is
 *   placed beside whatever is lit, so a card that asks for a tap on one thing while
 *   pointing at another has a good chance of covering the first with its own prose.
 * - **One act per beat.** "Tap this word, then name that one" is two places on the screen,
 *   so it is two `beats` of one card: the prose stays put and the spotlight moves from the
 *   plate to the guess bar. Asking for both at once means the light is on the wrong one for
 *   half the instruction.
 * - **A card inherits where the last one left the cursor.** Guesses are made from the
 *   word the player is standing on, and after a card that moved them that is not the
 *   word the next one's prose has in mind unless it says so.
 */

import { FormattedMessage } from 'react-intl';
import { tutorial as says } from '../i18n/messages/tutorial';
import {
  foundShortcut,
  hinted,
  hintedLetters,
  markedMove,
  reached,
  solved,
  standingOn,
  strayed,
  walkedMove,
  type Lesson,
} from '../lib/tutorial';

/** One paragraph of a card. The cards are prose, and prose is paragraphs. */
function P({ id }: { id: (typeof says)[keyof typeof says] }) {
  return (
    <p>
      <FormattedMessage {...id} />
    </p>
  );
}

export const LESSON: Lesson = {
  puzzle: 'c3316c6086c4',

  steps: [
    {
      id: 'welcome',
      title: says.welcomeTitle,
      look: { at: 'board' },
      body: (
        <>
          <P id={says.welcomeRule} />
          <P id={says.welcomeExamples} />
          <P id={says.welcomeShape} />
        </>
      ),
    },

    {
      id: 'statement',
      title: says.statementTitle,
      spotlight: { on: 'chrome', part: 'statement' },
      body: (
        <>
          <P id={says.statementWhat} />
          <P id={says.statementGoal} />
        </>
      ),
    },

    {
      id: 'par',
      title: says.parTitle,
      spotlight: { on: 'chrome', part: 'tally' },
      body: (
        <>
          <P id={says.parWhat} />
          <P id={says.parRelax} />
        </>
      ),
    },

    {
      id: 'board',
      title: says.boardTitle,
      spotlight: { on: 'chrome', part: 'plate' },
      look: { at: 'board' },
      body: (
        <>
          <P id={says.boardSpine} />
          <P id={says.boardAround} />
        </>
      ),
    },

    {
      id: 'first-move',
      title: says.firstMoveTitle,
      // The whole bar, not the field alone. Lighting the field puts the panel directly
      // above it, over the readout that spells out the move as it is typed - which is the
      // half of the guess bar this card is actually about.
      spotlight: { on: 'chrome', part: 'guess' },
      look: { at: 'words', words: ['showing', 'shadowing', 'swing'] },
      body: (
        <>
          <P id={says.firstMoveWhere} />
          <P id={says.firstMoveWhole} />
          <P id={says.firstMoveWhich} />
        </>
      ),
      ask: { prompt: says.firstMoveAsk, done: reached('shadowing') },
    },

    {
      id: 'the-line',
      title: says.lineTitle,
      spotlight: { on: 'move', between: ['showing', 'shadowing'] },
      // The same framing the move was made at, so the board does not jump between making a
      // move and being told what it looks like - and a third word to widen it, because two
      // rungs alone fill a phone's plate and leave the panel nowhere to sit but on top.
      look: { at: 'words', words: ['showing', 'shadowing', 'swing'] },
      body: (
        <>
          <P id={says.lineWritten} />
          <P id={says.lineTicks} />
        </>
      ),
    },

    {
      id: 'hint-word',
      title: says.hintWordTitle,
      spotlight: { on: 'word', word: 'swing' },
      look: { at: 'words', words: ['showing', 'swing', 'shadowing'] },
      body: <P id={says.hintWordBody} />,
      ask: { prompt: says.hintWordAsk, done: hinted('swing') },
      beats: [
        {
          spotlight: { on: 'word', word: 'swing' },
          ask: { prompt: says.hintWordAgain, done: hintedLetters('swing', 1) },
        },
        {
          spotlight: { on: 'word', word: 'swing' },
          ask: { prompt: says.hintWordMore, done: hintedLetters('swing', 1) },
        },
      ],
    },

    {
      id: 'hint-route',
      title: says.hintRouteTitle,
      spotlight: { on: 'word', word: 'sowing' },
      look: { at: 'words', words: ['shadowing', 'sowing', 'wing'] },
      body: (
        <>
          <P id={says.hintRouteWhy} />
          <P id={says.hintRouteWhat} />
          <P id={says.hintRouteRead} />
        </>
      ),
      ask: { prompt: says.hintRouteAsk, done: markedMove('shadowing', 'sowing') },
      beats: [
        {
          spotlight: { on: 'word', word: 'sowing' },
          ask: { prompt: says.hintRouteAskPlus, done: markedMove('sowing', 'wing') },
        },
        {
          spotlight: { on: 'word', word: 'sowing' },
          ask: { prompt: says.hintRouteAskMore, done: () => true },
        },
      ],
    },

    {
      id: 'both-ends',
      title: says.bothEndsTitle,
      spotlight: { on: 'word', word: 'towing' },
      look: { at: 'words', words: ['wing', 'towing'] },
      body: (
        <>
          <P id={says.bothEndsAny} />
          <P id={says.bothEndsWhy} />
        </>
      ),
      ask: { prompt: says.bothEndsAsk, done: standingOn('towing') },
      beats: [
        {
          spotlight: { on: 'chrome', part: 'guess' },
          ask: { prompt: says.bothEndsGuess, done: walkedMove('towing', 'wing') },
        },
      ],
    },

    {
      id: 'off-board',
      title: says.offBoardTitle,
      spotlight: { on: 'chrome', part: 'guess' },
      look: { at: 'words', words: ['wing', 'towing'] },
      body: (
        <>
          <P id={says.offBoardWhat} />
          <P id={says.offBoardFamily} />
        </>
      ),
      ask: { prompt: says.offBoardAsk, done: strayed() },
    },

    {
      id: 'shortcut',
      title: says.shortcutTitle,
      spotlight: { on: 'word', word: 'showing' },
      look: { at: 'words', words: ['showing', 'shadowing', 'swing'] },
      body: (
        <>
          <P id={says.shortcutWhy} />
          <P id={says.shortcutThis} />
        </>
      ),
      ask: { prompt: says.shortcutAsk, done: standingOn('showing') },
      beats: [
        {
          spotlight: { on: 'chrome', part: 'guess' },
          ask: { prompt: says.shortcutGuess, done: foundShortcut() },
        },
      ],
    },

    {
      id: 'finish',
      title: says.finishTitle,
      // The guess bar rather than nothing: with no spotlight the panel is centred, and the
      // one card that hands the board back to the player would be sitting in the middle of
      // it. Lit here it sits at the foot of the screen, out of the way of the figure.
      spotlight: { on: 'chrome', part: 'guess' },
      look: { at: 'board' },
      body: <P id={says.finishBody} />,
      ask: { prompt: says.finishAsk, done: walkedMove('owing', 'bestowing') },
      beats: [
        {
          spotlight: { on: 'chrome', part: 'guess' },
          ask: { prompt: says.finishJoin, done: solved() },
        },
      ],
    },
  ],
};
