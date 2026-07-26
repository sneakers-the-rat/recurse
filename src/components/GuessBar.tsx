/**
 * Where guesses are made. Docked to the bottom of the viewport, because on a
 * phone that is where thumbs are and where the keyboard pushes content.
 *
 * The player types the whole target word rather than the subword: one field, no
 * mode switch, and the subword the game found is then reflected back in the
 * readout — which is the small payoff of a correct guess.
 */

import { useEffect, useRef, useState } from 'react';
import { MoveReadout } from './MoveReadout';
import type { Graph } from '../lib/types';

interface Props {
  /** The revealed word this guess starts from. */
  from: string;
  graph: Graph;
  /** The full word list, once loaded. */
  isWord?: ((word: string) => boolean) | null;
  /** Set when the last submission was refused. */
  error: string | null;
  /** True while the guess is landing, to stop double submits. */
  busy?: boolean;
  solved: boolean;
  onSubmit: (word: string) => void;
  onClearError: () => void;
}

export function GuessBar({
  from,
  graph,
  isWord = null,
  error,
  busy = false,
  solved,
  onSubmit,
  onClearError,
}: Props) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Starting from a different word is a fresh thought; don't carry stale text.
  useEffect(() => {
    setValue('');
    onClearError();
  }, [from, onClearError]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !value.trim()) return;
    onSubmit(value);
    setValue('');
    // Keep focus so a run of guesses needs no re-tapping.
    inputRef.current?.focus();
  }

  if (solved) return null;

  return (
    <form
      onSubmit={submit}
      className="border-rule bg-noir-2/95 border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur"
    >
      <div className="mx-auto max-w-2xl">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <span className="label">
            from <span className="word text-bone ml-1 tracking-normal normal-case">{from}</span>
          </span>
          <div className="min-w-0 flex-1 text-right">
            <MoveReadout
              from={from}
              typed={value}
              graph={graph}
              isWord={isWord}
              muted={error !== null}
            />
          </div>
        </div>

        <div className="flex gap-2">
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (error) onClearError();
            }}
            className={`word bg-noir-3 min-w-0 flex-1 rounded-sm border px-3 py-2.5 text-lg
              outline-none transition-colors placeholder:tracking-normal placeholder:normal-case
              ${error ? 'border-blood refuse' : 'border-rule focus:border-gilt'}`}
            placeholder="a word"
            aria-label={`Your guess, starting from ${from}`}
            aria-invalid={error !== null}
            aria-describedby={error ? 'guess-error' : undefined}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="go"
            inputMode="text"
          />
          <button
            type="submit"
            disabled={busy || !value.trim()}
            className="label border-rule text-bone hover:border-gilt hover:text-gilt
              disabled:text-ash-lit rounded-sm border px-4 transition-colors
              disabled:cursor-not-allowed disabled:hover:border-rule"
          >
            Name it
          </button>
        </div>

        {/* Reserved line: the layout must not jump when a message appears. */}
        <p
          id="guess-error"
          role="status"
          aria-live="assertive"
          className="text-blood-lit mt-2 min-h-[1.25rem] text-sm leading-snug"
        >
          {error}
        </p>
      </div>
    </form>
  );
}
