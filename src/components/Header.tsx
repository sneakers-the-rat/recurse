/**
 * Masthead and the puzzle statement.
 *
 * The day number is the only number here that is decoration-adjacent, and it
 * earns its place: it is the real puzzle index, the thing a share string will
 * quote, and how players talk about a daily game.
 *
 * Memoised, like every other component App renders beside the plate. The board's
 * layout re-renders App on every frame it is moving, and the header has nothing to
 * do with any of them: it was being rebuilt eighty-odd times per guess to arrive at
 * the same two words and the same two numbers.
 */

import { memo } from 'react';

interface Props {
  source: string;
  target: string;
  par: number;
  /**
   * How many ways through there are that are *shorter* than par, which exist because a rarer
   * word cuts a corner. Said out loud from the start: that a shortcut exists is the hook, and
   * which words it runs through is the puzzle. Zero on most boards, and then not shown.
   */
  shortcuts?: number;
  /**
   * The three lengths a day offers, and which one is on screen.
   *
   * From the manifest, so what each holds is the builder's `RECURSE_BAND_CUTS` rather than
   * anything decided here. The switch is the only way between them on a phone: the band is
   * deliberately not in the URL — a board is addressed by its id and nothing else.
   */
  bands: readonly { name: string; minPar: number; maxPar: number }[];
  band: number;
  onBand: (band: number) => void;
  day: number;
  guesses: number;
  /** Hints asked for. Shown beside the guesses: it is the other half of a score. */
  hints: number;
  /**
   * The opening card is showing the statement, so this one waits its turn — the card
   * ends up here, and two copies of the same two words fading past each other reads as
   * a glitch rather than a hand-off.
   */
  quiet?: boolean;
  /**
   * The round is over. Said in the chrome as well as in the result panel, so a board
   * you come back to is visibly a board you have already played before you have read a
   * word of it.
   */
  finished?: boolean;
  /** And they beat par, which is the one outcome louder than finishing. */
  beatPar?: boolean;
  onHelp: () => void;
}

export const Header = memo(function Header({
  source,
  target,
  par,
  shortcuts = 0,
  bands,
  band,
  onBand,
  day,
  guesses,
  hints,
  quiet = false,
  finished = false,
  beatPar = false,
  onHelp,
}: Props) {
  /**
   * The bar's own colour, which is a statement about the round rather than decoration.
   *
   * Gilt, because gilt is what this game means by *arrived* — letters arriving, a word on
   * the route, a secret found. Dim gilt for a round finished, full gilt for one that beat
   * par, and the ordinary rule while there is still playing to do. Nothing else changes:
   * the two words and the tally are the same two words and the same tally.
   */
  const rule = finished ? (beatPar ? 'border-gilt' : 'border-gilt-dim') : 'border-rule';

  return (
    <header className={`border-b ${rule} ${finished ? 'bg-noir-2' : ''}`}>
      <div className="mx-auto flex max-w-2xl items-center justify-between gap-4 px-4 py-2.5">
        <h1 className="flex items-baseline gap-2">
          <span className="text-bone text-xl leading-none font-semibold tracking-tight">
            Re<span className="text-blood-lit italic">Curse</span>
          </span>
          <span className="label text-ash-lit">№ {day}</span>
        </h1>
        <button onClick={onHelp} className="label hover:text-gilt transition-colors" type="button">
          How to play
        </button>
      </div>

      {/*
        The three lengths, which is the other thing a day offers besides the board itself.
        Between the masthead and the statement because that is the order of the questions:
        which game, which length, which words.

        Each says what it holds — "short (par 3-4)" — because a name alone is a promise the
        player has no way to check, and the pars are what the length actually is.
      */}
      <nav
        className={`border-t ${rule} flex justify-center`}
        aria-label="Choose a length"
      >
        {bands.map((it, index) => {
          const here = index === band;
          return (
            <button
              key={it.name}
              type="button"
              onClick={() => onBand(index)}
              aria-current={here ? 'page' : undefined}
              className={`label flex-1 border-b-2 px-3 py-2 text-center transition-colors sm:flex-none sm:px-8 ${
                here
                  ? 'border-gilt text-gilt'
                  : 'text-ash-lit hover:text-bone-dim border-transparent'
              }`}
            >
              {it.name}
              <span className="mt-0.5 block text-[0.5625rem] tracking-[0.18em] normal-case opacity-70">
                par {it.minPar}–{it.maxPar}
              </span>
            </button>
          );
        })}
      </nav>

      {/* The statement, set like a Deco title page: rule, line, rule. */}
      {/*
        Out at once, back in slowly. The card is the same two words in the same place, so
        a *fade* out means both are on screen together for a moment, which reads as a
        glitch; coming back is the hand-off and wants the time.
      */}
      <div
        className={`border-t ${rule} transition-opacity ${
          quiet ? 'opacity-0 duration-0' : 'opacity-100 duration-700'
        }`}
      >
        <div className="mx-auto max-w-2xl px-4 py-4 text-center">
          <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
            <span className="word text-bone text-2xl sm:text-3xl">{source}</span>
            <span aria-hidden className="text-gilt text-xs">
              ◆
            </span>
            <span className="word text-bone text-2xl sm:text-3xl">{target}</span>
          </p>
          <p className="label mt-2.5">
            par: {par} moves
            {shortcuts > 0 && (
              <>
                <span className="text-ash-lit mx-2">·</span>
                <span className="text-gilt-dim">
                  {shortcuts} {shortcuts === 1 ? 'shortcut' : 'shortcuts'}
                </span>
              </>
            )}
            <span className="text-ash-lit mx-2">·</span>
            {guesses === 0 ? 'no guesses yet' : `${guesses} guessed`}
            {/* Only once any have been asked for: a nought here would read as a
                score to protect, and hints are not something to be stingy with. */}
            {hints > 0 && (
              <>
                <span className="text-ash-lit mx-2">·</span>
                {hints} {hints === 1 ? 'hint' : 'hints'}
              </>
            )}
          </p>
        </div>
      </div>
    </header>
  );
});
