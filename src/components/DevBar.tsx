/**
 * Developer mode: step through the whole puzzle bank instead of just today's.
 *
 * Opt in with `?dev` — deliberately not keyed to the dev server, so a deployed
 * build can be inspected the same way, and so the end-to-end tests exercise the
 * normal chrome unless they ask for this.
 *
 * Stepping is by index, because that is the order the survey lists and the
 * calendar plays; the URL it lands on is the puzzle's id, like any other visit.
 * Nothing here addresses a board by number.
 *
 * Styled as an instrument rather than part of the game: flat mono, no ornament,
 * so a screenshot never gets mistaken for the real thing.
 */

import { memo, useState } from 'react';
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
  /** Put the instruments away and look at the game as a player sees it. */
  onHide: () => void;
}

/** Every control here is the same flat outlined thing. */
function Key({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="border border-neutral-700 px-1.5 hover:border-neutral-500 hover:text-neutral-200"
      aria-label={label}
      type="button"
    >
      {children}
    </button>
  );
}

/** `name value`, the only other shape in the bar. */
function Stat({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <span>
      {name} <span className="text-neutral-200">{children}</span>
    </span>
  );
}

// Memoised for the same reason as the rest: the plate's own motion re-renders App on
// every frame, and the instruments have nothing to say about any of them.
export const DevBar = memo(function DevBar({
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
  onHide,
}: Props) {
  const [jump, setJump] = useState('');

  const step = (delta: number) => onGo((index + delta + total) % total);

  return (
    <div className="border-rule bg-noir-3 border-b font-mono text-[11px] text-neutral-400">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
        <span className="font-semibold tracking-wider text-neutral-500">DEV</span>

        <span className="flex items-center gap-1">
          <Key onClick={() => step(-1)} label="Previous puzzle">
            ◀
          </Key>
          <Key onClick={() => step(1)} label="Next puzzle">
            ▶
          </Key>
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

        {/* The address of the board on screen, which is what the survey quotes. */}
        <Stat name="id">{puzzle.id}</Stat>
        <Stat name="par">{puzzle.par}</Stat>
        <Stat name="routes">{puzzle.shortestPaths}</Stat>
        <span>
          corridor <span className="text-neutral-200">{puzzle.corridorSize}</span>
          {drawn !== puzzle.corridorSize && <span className="text-neutral-500"> → {drawn}</span>}
        </span>
        <Stat name="alt">{puzzle.altNodes}</Stat>
        <Stat name="rank">{puzzle.maxRank}</Stat>
        <Stat name="guessed">{guesses}</Stat>

        <span className="ml-auto flex items-center gap-1.5">
          <Key onClick={onNameAll}>name all</Key>
          <Key onClick={onSolve}>solve</Key>
          <Key onClick={onReset}>reset</Key>
          {/* Says the key as well, because with the bar gone it is the only way back. */}
          <Key onClick={onHide} label="Hide dev mode">
            hide ⌃D
          </Key>
        </span>

        <p className="w-full break-words text-neutral-500">
          {path.length ? path.join(' → ') : 'no path'}
        </p>
      </div>
    </div>
  );
});
