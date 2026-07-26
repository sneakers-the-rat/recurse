/**
 * Developer mode: step through the whole puzzle bank instead of just today's.
 *
 * Opt in with `?dev` — deliberately not keyed to the dev server, so a deployed
 * build can be inspected the same way, and so the end-to-end tests exercise the
 * normal chrome unless they ask for this.
 *
 * Styled as an instrument rather than part of the game: flat mono, no ornament,
 * so a screenshot never gets mistaken for the real thing.
 */

import { useState } from 'react';
import type { Puzzle } from '../lib/types';

interface Props {
  index: number;
  total: number;
  puzzle: Puzzle;
  /** Drawn nodes, which can exceed corridorSize once the player strays. */
  drawn: number;
  /** A shortest path, for eyeballing word quality. */
  path: readonly string[];
  guesses: number;
  onGo: (index: number) => void;
  onSolve: () => void;
  /** Label every word on the board, for judging whether the puzzle is any good. */
  onNameAll: () => void;
  onReset: () => void;
}

export function DevBar({
  index,
  total,
  puzzle,
  drawn,
  path,
  guesses,
  onGo,
  onSolve,
  onNameAll,
  onReset,
}: Props) {
  const [jump, setJump] = useState('');

  const step = (delta: number) => onGo((index + delta + total) % total);

  return (
    <div className="border-rule bg-noir-3 border-b font-mono text-[11px] text-neutral-400">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
        <span className="font-semibold tracking-wider text-neutral-500">DEV</span>

        <span className="flex items-center gap-1">
          <button
            onClick={() => step(-1)}
            className="border border-neutral-700 px-1.5 hover:border-neutral-500 hover:text-neutral-200"
            aria-label="Previous puzzle"
            type="button"
          >
            ◀
          </button>
          <button
            onClick={() => step(1)}
            className="border border-neutral-700 px-1.5 hover:border-neutral-500 hover:text-neutral-200"
            aria-label="Next puzzle"
            type="button"
          >
            ▶
          </button>
        </span>

        <span className="text-neutral-200">
          {index + 1}/{total}
        </span>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(jump);
            if (Number.isFinite(n) && n >= 1 && n <= total) onGo(n - 1);
            setJump('');
          }}
        >
          <input
            value={jump}
            onChange={(e) => setJump(e.target.value)}
            placeholder="go to"
            aria-label="Jump to puzzle number"
            className="w-16 border border-neutral-700 bg-transparent px-1.5 py-0.5 outline-none focus:border-neutral-500"
          />
        </form>

        <span>
          par <span className="text-neutral-200">{puzzle.par}</span>
        </span>
        <span>
          routes <span className="text-neutral-200">{puzzle.shortestPaths}</span>
        </span>
        <span>
          corridor <span className="text-neutral-200">{puzzle.corridorSize}</span>
          {drawn !== puzzle.corridorSize && <span className="text-neutral-500"> → {drawn}</span>}
        </span>
        <span>
          alt <span className="text-neutral-200">{puzzle.altNodes}</span>
        </span>
        <span>
          rank <span className="text-neutral-200">{puzzle.maxRank}</span>
        </span>
        <span>
          guessed <span className="text-neutral-200">{guesses}</span>
        </span>

        <span className="ml-auto flex items-center gap-1.5">
          <button
            onClick={onNameAll}
            className="border border-neutral-700 px-1.5 hover:border-neutral-500 hover:text-neutral-200"
            type="button"
          >
            name all
          </button>
          <button
            onClick={onSolve}
            className="border border-neutral-700 px-1.5 hover:border-neutral-500 hover:text-neutral-200"
            type="button"
          >
            solve
          </button>
          <button
            onClick={onReset}
            className="border border-neutral-700 px-1.5 hover:border-neutral-500 hover:text-neutral-200"
            type="button"
          >
            reset
          </button>
        </span>

        <p className="w-full break-words text-neutral-500">
          {path.length ? path.join(' → ') : 'no path'}
        </p>
      </div>
    </div>
  );
}
