/**
 * The end of a round, in two places, with the board still between them.
 *
 * The board is the record of what the player just did — the trail they drew is *on* it,
 * gilt if they beat par — so the finished round is arranged around the board rather than
 * on top of it. It used to be one panel docked under the plate, and it was as tall as it
 * needed to be: the plate was the flexible part of a fixed-height screen, so a summary
 * that wanted 62% of the viewport left the board a 270-pixel strip with both of the
 * puzzle's own words clipped off the ends of it. Reading the summary then meant scrolling
 * a box inside a page that did not itself scroll.
 *
 * So it is split by what each part is for:
 *
 * - `Result` goes above the board, in place of the guess bar's own space at the bottom.
 *   The verdict, the score, the trail as a picture, and the text to paste — everything a
 *   player wants in the first two seconds, said where they cannot miss it, and no taller
 *   than the guess bar it replaces.
 * - `Round` goes below the board, and the page carries on into it. The move list is what
 *   you read afterwards, once, and it does not need to compete with the figure.
 *
 * The share text is *shown*, not just copied. A clipboard write can fail — an insecure
 * context, a browser that wants a gesture it did not get, a permission refused — and a
 * button that silently does nothing is worse than no button. It is selectable, so
 * "copy/paste" is always literally available; the button is the convenience.
 *
 * Persistence is not this component's business, but it is what makes it worth building:
 * a solved game is kept (see storage.ts), so coming back to a board already finished
 * lands here rather than on an empty guess bar.
 */

import { memo, useEffect, useState } from 'react';
import { hintCount, type GameState } from '../lib/game';
import { emojiTrail, type Mark } from '../lib/share';

/**
 * `name value`, inline.
 *
 * Stacked, the way it was, this is the shape a dashboard uses and it costs two lines
 * per figure — which is the whole reason the old panel could not fit beside a board.
 * The value keeps its own case and size inside the label, so the figures still read as
 * figures.
 */
function Stat({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <span className="label text-ash-lit whitespace-nowrap">
      {name}{' '}
      <span className="text-bone ml-0.5 text-base tracking-normal normal-case">{children}</span>
    </span>
  );
}

/** What the round is called, which is decided by the score and nothing else. */
function verdictOf(state: GameState) {
  const { guesses, puzzle } = state;
  // Beating par means a rarer word cut a corner nobody expected to be cut. Par is the
  // best route through ordinary words, not a floor, so this is the best thing that can
  // happen in a round and it gets the loudest heading in the game.
  const secret = guesses < puzzle.par;
  return { secret, title: secret ? 'A secret way through' : guesses === puzzle.par ? 'Perfect' : 'Found it' };
}

/**
 * The result, above the board: what happened, and the thing to paste.
 *
 * Held to three short rows on a phone, because every pixel here is a pixel off the
 * figure below it. That is also why the score is inline and the trail sits on the same
 * row as the button.
 */
export const Result = memo(function Result({
  state,
  marks,
  text,
}: {
  state: GameState;
  /** One per guess, in order. See share.ts. */
  marks: readonly Mark[];
  /** The finished share text, exactly as it would be pasted. */
  text: string;
}) {
  const { guesses, misses, puzzle } = state;
  const hints = hintCount(state);
  const { secret, title } = verdictOf(state);

  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  // "Copied" is a receipt, not a state: it says something just happened, so it fades on
  // its own rather than sitting there through the next thing the player does. Cleared on
  // unmount too, or stepping to another board carries it over.
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2200);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setFailed(false);
    } catch {
      // Nothing to apologise for and nothing to retry: the text is on screen and
      // selectable, so say where it is.
      setFailed(true);
    }
  }

  return (
    <section
      // Named, so a test can ask for the result rather than for the last `<section>` on
      // the page — which is what they used to do, and what broke the moment the finished
      // round was arranged in two parts.
      aria-label="Result"
      aria-live="polite"
      className={`bg-noir-2 border-b ${secret ? 'border-gilt' : 'border-gilt-dim'}`}
    >
      <div className="mx-auto max-w-2xl px-4 py-2">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h2 className={`text-lg leading-none font-semibold ${secret ? 'text-gilt' : 'text-bone'}`}>
            {title}
          </h2>

          <Stat name="guesses">
            {guesses}
            <span className="text-ash-lit text-sm"> / par {puzzle.par}</span>
          </Stat>
          <Stat name="hints">{hints}</Stat>
          {misses > 0 && <Stat name="refused">{misses}</Stat>}
          {secret && (
            <Stat name="under par">
              <span className="text-gilt">{puzzle.par - guesses}</span>
            </Stat>
          )}

          {/*
            The trail and the button travel together, as one unit that wraps as one.
            Left to wrap separately they took a line each on a phone, and on the long
            heading — "A secret way through" — that third line was enough to push a
            par-5 spine past what the plate could show and clip the target word off the
            bottom of the board. The point of the whole arrangement is that it does not
            do that.
          */}
          <div className="ml-auto flex items-center gap-3">
            {/* Letter-spaced so the squares do not fuse into one bar. */}
            {marks.length > 0 && (
              <p className="text-base tracking-[0.15em]" aria-label="Your route, as marks">
                {emojiTrail(marks)}
              </p>
            )}
            {/*
              Here rather than beside the text, which is a decision about the text: the
              share string's longest line is the board's own URL, and a button holding a
              column of its own on a phone left that line clipped mid-character — which
              reads as broken rather than as scrollable.
            */}
            <button
              onClick={copy}
              className="label border-rule text-bone hover:border-gilt hover:text-gilt shrink-0 border px-3 py-1.5 transition-colors"
              type="button"
            >
              {copied ? 'Copied' : 'Copy result'}
            </button>
          </div>
        </div>

        {/* The text itself, selectable. Also what the button copies, character for
            character, so there is only ever one answer to "what does it say". */}
        <pre className="word text-bone-dim border-rule bg-noir-3 mt-2 overflow-x-auto border px-2.5 py-1.5 text-[11px] leading-snug whitespace-pre">
          {text}
        </pre>
        {failed && (
          <p className="label text-blood-lit mt-1.5">Copying was blocked — select the text above</p>
        )}
      </div>
    </section>
  );
});

/**
 * The round, below the board: which day this was, and every move in order.
 *
 * The page runs on into this rather than scrolling it in a box of its own, so the whole
 * thing is one document: the figure, then the account of it.
 */
export const Round = memo(function Round({
  state,
  day,
  date,
  onPlayAgain,
}: {
  state: GameState;
  /** Days since the epoch, and that day's date — the share text's first line. */
  day: number;
  date: string;
  onPlayAgain?: (() => void) | undefined;
}) {
  const { log } = state;

  return (
    <section
      aria-label="The round"
      className="border-rule bg-noir-2/40 border-t px-4 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
    >
      <div className="mx-auto max-w-2xl">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="label">The round</h3>
          <p className="label text-ash-lit">
            Day {day} <span className="mx-1">·</span> {date}
          </p>
        </div>

        <ol className="border-rule divide-rule mt-2.5 divide-y border-y">
          {log.map((entry) => (
            <li key={entry.order} className="flex items-baseline gap-3 py-1.5">
              <span className="label text-ash-lit w-4 shrink-0 text-right">{entry.order}</span>
              <span className="word text-bone-dim text-sm">{entry.from}</span>
              <span
                className={`label shrink-0 ${
                  entry.move.kind === 'add' ? 'text-gilt' : 'text-blood-lit'
                }`}
              >
                {entry.move.kind === 'add' ? '+' : '−'}
                {entry.move.sub}
              </span>
              <span className="word text-bone ml-auto text-sm">{entry.to}</span>
            </li>
          ))}
        </ol>

        {onPlayAgain && (
          <button
            onClick={onPlayAgain}
            className="label border-rule text-bone hover:border-gilt hover:text-gilt mt-4 w-full border py-2.5 transition-colors"
            type="button"
          >
            Another puzzle
          </button>
        )}
      </div>
    </section>
  );
});
