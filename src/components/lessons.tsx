/**
 * The tutorial itself: which board it is taught on, and what each card says.
 *
 * **This is the file to edit.** Everything structural is in `lib/tutorial.ts` - what a
 * beat may point at, what the camera may be asked to frame, what counts as the player
 * having done the thing - and none of it needs touching to change a word of the lesson,
 * reorder it, or teach it on another board.
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
 * The cards name that board's words, so the two travel together: change `puzzle` and the
 * words below are wrong. A rebuild that changes this puzzle's answer changes its id, and
 * the tutorial then refuses to run rather than teaching these words over some other board
 * - see `Tutorial.tsx`.
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
} from "../lib/tutorial";

/** A word, set the way the board sets it. */
function W({ children }: { children: string }) {
  return <span className="word text-bone">{children}</span>;
}

/** Letters arriving. */
function Add({ children }: { children: string }) {
  return <span className="word text-gilt">{children}</span>;
}

/** Letters leaving. */
function Cut({ children }: { children: string }) {
  return <span className="word text-blood-lit">{children}</span>;
}

export const LESSON: Lesson = {
  puzzle: "c3316c6086c4",

  steps: [
    {
      id: "welcome",
      title: "Words inside words",
      look: { at: "board" },
      body: (
        <>
          <p>
            Every move takes one whole word out of another, or puts one in. What
            is left has to be a word too.
          </p>
          <p>
            <W>base</W> <Add>+ ball</Add> = <W>base</W>
            <Add>ball</Add>
            <br />
            <W>colo</W>
            <Cut>ratio</Cut>
            <W>ns</W> <Cut>− ratio</Cut> = <W>colons</W>
          </p>
          <p>
            The piece you add or take out must be a word, must be in one run,
            and can sit anywhere - including in the middle.
          </p>
        </>
      ),
    },

    {
      id: "statement",
      title: "The game",
      spotlight: { on: "chrome", part: "statement" },
      body: (
        <>
          <p>
            The puzzle is stated at the top: connect <W>showing</W> and{" "}
            <W>towing</W>. You can move from any revealed node, so you can work
            from either end, backtrack and make a new branch, whatever.
          </p>
          <p>
            The goal of the game is to{" "}
            <span className="text-bone">connect the two target words</span> by
            guessing some path between them using{" "}
            <span className="text-bone">
              as few guesses and hints as possible
            </span>
            .
          </p>
        </>
      ),
    },

    {
      id: "par",
      title: "Scoring",
      spotlight: { on: "chrome", part: "tally" },
      body: (
        <>
          <p>
            <W>par</W> is the shortest way through using ordinary words: four
            moves here. Your guesses and hints are counted beside it.
          </p>
          <p>
            Lower numbers of guesses and hints are better, but this isn't a
            competitive game: both are unlimited, and there's no penalty to
            wander off and explore the board. Especially if you're new, don't
            worry about keeping a tidy board or making optimal guesses. Take
            some time to fill in the board with guesses to get a feel for the
            game. If you're frustrated, get more hints!
          </p>
        </>
      ),
    },

    {
      id: "board",
      title: "The Board",
      spotlight: { on: "chrome", part: "plate" },
      look: { at: "board" },
      body: (
        <>
          <p>
            The gold line down the middle is the "spine" - the shortest way
            through using only common words. Its words are unnamed dots for now.
          </p>
          <p>
            Around it are words that lead somewhere without being shortest.
            Every puzzle has many non-spine paths between the target words - a
            winning path does not need to touch the spine!
          </p>
        </>
      ),
    },

    {
      id: "first-move",
      title: "babbies first move",
      // The whole bar, not the field alone. Lighting the field puts the panel directly
      // above it, over the readout that spells out the move as it is typed - which is the
      // half of the guess bar this card is actually about.
      spotlight: { on: "chrome", part: "guess" },
      look: { at: "words", words: ["showing", "shadowing", "swing"] },
      body: (
        <>
          <p>
            The word with a gold ring around it is the word you are guessing
            from. Make moves by typing in the guess box.
          </p>
          <p>
            Type the whole word you are guessing, not the piece. The game works
            out which piece you meant.
          </p>
          <p>
            The next spine word after <W>showing</W> is <W>shadowing</W>, made
            by putting <Add>ad</Add> in the middle of it like{" "}
            <W>sh·</W><Add>ad</Add><W>·owing</W>
            
          </p>
        </>
      ),
      ask: { prompt: "Type shadowing and guess.", done: reached("shadowing") },
    },

    {
      id: "the-line",
      title: "What that move look like",
      spotlight: { on: "move", between: ["showing", "shadowing"] },
      // The same framing the move was made at, so the board does not jump between making a
      // move and being told what it looks like - and a third word to widen it, because two
      // rungs alone fill a phone's plate and leave the panel nowhere to sit but on top.
      look: { at: "words", words: ["showing", "shadowing", "swing"] },
      body: (
        <>
          <p>
            The move is written along the edge: <Add>+ad</Add>, in gold (or{" "}
            <Cut>red</Cut> if a word was removed).
          </p>
          <p>
            The tickmarks perpendicular from the edge of a node are an indicator
            of the "degree" of the node, or how many other nodes connect to it -
            the number of ticks isn't literal (i.e. there are more than 4 other
            words that can be reached from <W>showing</W>), but more ticks means
            higher degree.
          </p>
        </>
      ),
    },

    {
      id: "hint-word",
      title: "Hints!",
      spotlight: { on: "word", word: "swing" },
      look: { at: "words", words: ["showing", "swing", "shadowing"] },
      body: (
        <>
          <p>
            You can get hints for any undiscovered node! For non-spine nodes,
            the first click gives its length; every click after that reveals one
            more random letter.
          </p>
        </>
      ),
      ask: {
        prompt: "Click the lit dot to reveal its length.",
        done: hinted("swing"),
      },
      beats: [
        {
          spotlight: { on: "word", word: "swing" },
          ask: {
            prompt: "Click it again to reveal a letter.",
            done: hintedLetters("swing", 1),
          },
        },
        {
          spotlight: { on: "word", word: "swing" },
          ask: {
            prompt: "Keep revealing letters or move on",
            done: hintedLetters("swing", 1),
          },
        },
      ],
    },

    {
      id: "hint-route",
      title: "Spine Hints!",
      spotlight: { on: "word", word: "sowing" },
      look: { at: "words", words: ["shadowing", "sowing", "wing"] },
      body: (
        <>
          <p>
            A spine word doesn't hint its length or letters, that would be too
            easy!
          </p>
          <p>
            Spine hints tell you how to reach a word from another. <Add>+</Add>{" "}
            by adding letters, <Cut>−</Cut> by taking them away.
          </p>
          <p>
            So a <Cut>−</Cut> here means to reach this word from{" "}
            <W>shadowing</W>, we have to remove a word, and vice versa for the{" "}
            <Add>+</Add>.
          </p>
        </>
      ),
      ask: {
        prompt: "Click the gold dot to show a - hint.",
        done: markedMove("shadowing", "sowing"),
      },
      beats: [
        {
          spotlight: { on: "word", word: "sowing" },
          ask: {
            prompt: "Click the gold dot until you get a + hint.",
            done: markedMove("sowing", "wing"),
          },
        },
        {
          spotlight: { on: "word", word: "sowing" },
          ask: { prompt: "Once more for the hell of it.", done: () => true },
        },
      ],
    },
    {
      id: "both-ends",
      title: "Jumping around",
      spotlight: { on: "word", word: "towing" },
      look: { at: "words", words: ["wing", "towing"] },
      body: (
        <>
          <p>
            You can guess from any word you have reached - including the goal -
            by tapping it.
          </p>
          <p>
            Working from both ends is often easier: <W>towing</W> is{" "}
            <W>to·wing</W>, and taking <Cut>to</Cut> off gets us to "wing" which
            seems like the right direction.
          </p>
        </>
      ),
      ask: {
        prompt: "Tap towing to guess from it.",
        done: standingOn("towing"),
      },
      beats: [
        {
          spotlight: { on: "chrome", part: "guess" },
          ask: {
            prompt: 'Now guess "wing"',
            done: walkedMove("towing", "wing"),
          },
        },
      ],
    },

    {
      id: "off-board",
      title: "Going offroad",
      spotlight: { on: "chrome", part: "guess" },
      look: { at: "words", words: ["wing", "towing"] },
      body: (
        <>
          <p>
            The starting nodes on the board are a suggestion, but any word you
            can reach is valid. Guessing a word that isn't on the board adds it,
            along with any of its neighbors that might form a new route.
          </p>
          <p>
            You are standing on <W>wing</W>. Two letters on the front of it is a
            whole family: <Add>se</Add>, <Add>mo</Add>, <Add>vo</Add>,{" "}
            <Add>ca</Add>.
          </p>
        </>
      ),
      ask: {
        prompt: "Name a word that's not on the board yet.",
        done: strayed(),
      },
    },

    {
      id: "shortcut",
      title: "Shortcuts",
      spotlight: { on: "word", word: "showing" },
      look: { at: "words", words: ["showing", "shadowing", "swing"] },
      body: (
        <>
          <p>
            Par is measured over ordinary words, but you probably know lots of
            words that aren't so common! Sometimes there are shortcut paths
            through rare words, the header says when a board has one.
          </p>
          <p>
            This one does: <W>showing</W> is{" "}
            <Cut>sh</Cut><W>·owing</W>
            : Rare words aren't always long, "<W>sh</W>" is a word but not a
            very common one. take <Cut>sh</Cut> off the front, and the rest of
            the way through is drawn for you in gold.
          </p>
        </>
      ),
      ask: {
        prompt: "Tap showing to stand on it.",
        done: standingOn("showing"),
      },
      beats: [
        {
          spotlight: { on: "chrome", part: "guess" },
          ask: { prompt: "Now name owing.", done: foundShortcut() },
        },
      ],
    },

    {
      id: "finish",
      title: "Finish the game",
      // The guess bar rather than nothing: with no spotlight the panel is centred, and the
      // one card that hands the board back to the player would be sitting in the middle of
      // it. Lit here it sits at the foot of the screen, out of the way of the figure.
      spotlight: { on: "chrome", part: "guess" },
      look: { at: "board" },
      body: (
        <>
          <p>Finish the game by reaching towing through the shortcut!</p>
        </>
      ),
      ask: {
        prompt: "Guess bestowing",
        done: walkedMove("owing", "bestowing"),
      },
      beats: [
        {
          spotlight: { on: "chrome", part: "guess" },
          ask: {
            prompt:
              "Now finish the game by completing the connection to towing!",
            done: solved(),
          },
        },
      ],
    },
  ],
};
