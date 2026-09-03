/**
 * The rules. Worth being precise about, because the central constraint — that
 * the piece you add or remove must itself be a word — is the whole game and is
 * easy to misread as "any letters".
 *
 * And, at the foot of it, the switch for the instrument panel. It is here because this is
 * the only dialog the game has, and because the other two ways in — `?dev` and Ctrl+D —
 * both need hardware a phone does not have, while looking at a real board on a real phone
 * is most of what the panel is for. Set apart below a rule and labelled for what it is, so
 * it reads as the back of the manual rather than as part of the game.
 */

interface Props {
  minWord: number;
  minSub: number;
  devMode: boolean;
  onToggleDev: () => void;
  onClose: () => void;
}

export function HowTo({ minWord, minSub, devMode, onToggleDev, onClose }: Props) {
  return (
    <div
      id="how-to"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="border-rule bg-noir-2 max-h-[85vh] w-full max-w-lg overflow-y-auto border p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="howto-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="howto-title" className="text-bone mb-1 text-2xl font-semibold">
          How to play
        </h2>

        <div className="text-bone-dim space-y-4 text-[0.9375rem] leading-relaxed">
          <p>
            <span className="text-bone font-bold">
              The goal of the game is to connect two words by adding and removing words within them
              using as few guesses and hints as possible.{' '}
            </span>
          </p>

          <figure className="border-rule bg-noir-3 border p-3">
            <p className="word text-base">
              base <span className="text-gilt">+ ball</span> ={' '}
              <span className="text-bone">base</span>
              <span className="text-gilt">ball</span>
            </p>
            <p className="word mt-1.5 text-base">
              colo<span className="text-blood-lit">ratio</span>ns{' '}
              <span className="text-blood-lit">− ratio</span> ={' '}
              <span className="text-bone">colons</span>
            </p>
          </figure>

          <h3 className="text-bone mb-1 text-xl font-semibold">Rules</h3>
          <p>
            
            <ul>
            <li>The player selects a revealed word in the graph to be the "active word"</li>
            <li>Each turn you either{' '}<span className="text-gilt">add</span> or{' '}
            <span className="text-blood-lit">remove</span> a word from the active word.</li>
            <li>The letters you add or remove must be a single valid word.</li>
            <li>The letters you add or remove must be contiguous</li>
            <li>The letters that are left after adding or removing must also be a word, and that becomes the next active word.</li>
            <li>The added or removed word can be in any position - before, after,
            and especially inside the other words.</li>
          <li>
            Words within the graph must be {minWord} or more letters long
          </li>
          <li>
            Words added or removed to reach new words must be {' '}
            {minSub} or more letters long.
          </li>
          </ul>
          </p>


          <h3 className="text-bone mb-1 text-xl font-semibold">The Graph</h3>
          <p>
            The golden center line, or <span className="text-gilt">"spine"</span> 
            of the graph is the shortest path between the two words you're trying to bridge.
            The rest of the graph are a subset of the words surrounding the spine that provide a few possible alternative paths.
            All <a href="#wordlists">valid words</a> can be guessed,
            so the nodes you see when the game start are not the only paths between the words!
            If you guess a word that's not on the graph yet, it will be added and connected to any other words that it can reach.
          </p>

          <p>
            You can guess from <em className="text-bone not-italic">any</em> word you have
            already found, not just the last one. 
            The game ends when you complete the path between the words,
            but you can double-back, work from both ends, leave dead ends, etc.

          </p>

          <h3 className="text-bone mb-1 text-xl font-semibold">Hints</h3>
          <p>
            Tap or click an undiscovered node to receive a <span className="text-bone">hint</span> for it.
            You <emph>cannot</emph> get hints for words on the spine or on shortcuts.
            Hints are unlimited, and counted alongside your guesses.
            First you will see the number of letters in the word,
            and then each subsequent tap will reveal another letter.
            This is not a competitive game, go ahead and do a thousand hints,
            challenge yourself and use no hints, whatever.
          </p>

          <h3 className="text-bone mb-1 text-xl font-semibold">Shortcuts</h3>
          <p>
          The puzzle tries to be "playable" by using a smaller list of more common words,
          since it's not fun to get sniped by a squirrelly rare word.
          However, also to make the game "playable," we want to allow all words that someone might consider real
          because it's frustrating to guess a real word and have it be refused.
          </p>

          <p>
            The ability to guess rare words means that some boards have <span className="text-gilt">shortcuts</span> - {' '}
            paths between the two target words that are <emph>shorter</emph> than the par score,
            which is computed from the smaller word list.
          </p>

          <p>
            If your guess stumbles you onto a shortcut, the shortcut path will appear and be highlighted
            and be all shiny to let you know that the rest of the shortcut is possible.
          </p>


          <h3 id="wordlists" className="text-bone mb-1 text-xl font-semibold">Word Lists</h3>
          <p>
            Recurse uses two word lists from <a href="https://wordlist.aspell.net/scowl_v1-readme/">SCOWL/ESDB</a>:
            <ul>
              <li><bold>SCOWL 35</bold> - A smaller list of more common used when constructing the puzzles, computing pars, and finding initial non-spine graph nodes.</li>
              <li><bold>SCOWL 80</bold> - A much larger list of words that are valid as guesses.</li>
            </ul>
          </p>


        </div>

        <button
          onClick={onClose}
          className="label border-rule text-bone hover:border-gilt hover:text-gilt mt-6 w-full border py-2.5 transition-colors"
          type="button"
        >
          Begin
        </button>

        {/*
          The instruments. Not part of the rules, so it sits under a rule of its own, in the
          quietest ink the palette has — and it says which way it is going rather than what
          it currently is, because a switch that reads "dev mode: off" is ambiguous about
          which half of it is the state and which is the button.
        */}
        <div className="border-rule mt-6 flex items-center justify-between border-t pt-4">
          <p className="label text-ash-lit normal-case">
            {devMode ? 'Instruments are showing' : 'Building this thing?'}
          </p>
          <button
            onClick={onToggleDev}
            className="label border-rule text-ash-lit hover:border-gilt hover:text-gilt border px-3 py-1.5 transition-colors"
            type="button"
            aria-pressed={devMode}
          >
            {devMode ? 'hide dev tools' : 'show dev tools'}
          </button>
        </div>
      </div>
    </div>
  );
}
