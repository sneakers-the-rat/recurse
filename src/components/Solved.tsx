/**
 * The end of a round.
 *
 * Shows the route the player actually took, move by move, because that trail is
 * the thing worth looking back at — and it is what a share string will encode
 * when the daily scaffolding lands.
 */

import type { GameState } from '../lib/game';

interface Props {
  state: GameState;
  onPlayAgain?: (() => void) | undefined;
}

export function Solved({ state, onPlayAgain }: Props) {
  const { guesses, misses, puzzle, log } = state;
  // Beating par means a rarer word cut a corner nobody expected to be cut. Par is
  // the best route through ordinary words, not a floor, so this is the best thing
  // that can happen in a round and it gets the loudest heading in the game.
  const secret = guesses < puzzle.par;
  const perfect = guesses === puzzle.par;

  return (
    <section
      className="border-rule bg-noir-2/95 border-t px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
      aria-live="polite"
    >
      <div className="mx-auto max-w-2xl">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className={`text-xl font-semibold ${secret ? 'text-gilt' : 'text-bone'}`}>
            {secret ? 'A secret way through' : perfect ? 'Perfect' : 'Found it'}
          </h2>
          <p className="label">
            {guesses} {guesses === 1 ? 'guess' : 'guesses'}
            <span className="text-ash-lit mx-2">·</span>
            {secret ? (
              <span className="text-gilt">{puzzle.par - guesses} under par</span>
            ) : (
              `${puzzle.par} at best`
            )}
            {misses > 0 && (
              <>
                <span className="text-ash-lit mx-2">·</span>
                {misses} refused
              </>
            )}
          </p>
        </div>

        <ol className="border-rule divide-rule divide-y border-y">
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
}
