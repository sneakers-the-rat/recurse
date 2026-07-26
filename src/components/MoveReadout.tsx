/**
 * What this guess would do, shown while it is still being typed.
 *
 * One rule keeps it readable: the changed run is always marked inside the
 * *longer* of the two words, and the arrow says which way it goes.
 *
 *     adding    base  →  base⟨ball⟩        run in gilt, arriving
 *     removing  base⟨ball⟩  →  base        run in blood, struck through
 *
 * When the edit is not one clean run there is nothing honest to mark, so the
 * readout says so plainly instead of inventing a highlight.
 */

import { analyzeEdit, bestReading } from '../lib/moves';
import type { Graph } from '../lib/types';

interface Props {
  from: string;
  typed: string;
  /** Consulted so the highlight matches what the game will actually accept. */
  graph: Graph;
  /** The full word list, once loaded; sharpens which reading is shown. */
  isWord?: ((word: string) => boolean) | null;
  /** Dim the whole readout once the guess has been rejected. */
  muted?: boolean;
}

function Marked({
  word,
  pos,
  length,
  tone,
  struck,
}: {
  word: string;
  pos: number;
  length: number;
  tone: 'gilt' | 'blood';
  struck?: boolean;
}) {
  const colour = tone === 'gilt' ? 'text-gilt' : 'text-blood-lit';
  return (
    <span className="word">
      <span>{word.slice(0, pos)}</span>
      <span className={`${colour} ${struck ? 'line-through decoration-1' : ''}`}>
        {word.slice(pos, pos + length)}
      </span>
      <span>{word.slice(pos + length)}</span>
    </span>
  );
}

function Arrow() {
  return (
    <span aria-hidden className="text-ash-lit mx-2 shrink-0 text-xs tracking-widest">
      ◆
    </span>
  );
}

export function MoveReadout({ from, typed, graph, isWord = null, muted = false }: Props) {
  const word = typed.trim().toLowerCase();

  if (!word || word === from) {
    return (
      <p className="label" aria-live="polite">
        {word === from && word ? 'unchanged' : 'add or remove a word'}
      </p>
    );
  }

  const edit = analyzeEdit(from, word);
  const dim = muted ? 'opacity-55' : '';

  if (edit.shape === 'add' || edit.shape === 'remove') {
    // If the move is legal, show exactly the reading the game accepted. Only
    // fall back to guessing at the intent when there is no legal move.
    const legal = graph.findMove(from, word);
    const { pos, sub } = legal
      ? { pos: legal.pos, sub: legal.sub }
      : bestReading(edit.spots, graph.params.minSub, isWord);
    const adding = edit.shape === 'add';
    const longer = adding ? word : from;
    const shorter = adding ? from : word;

    return (
      <p
        className={`flex flex-wrap items-baseline text-lg sm:text-xl ${dim}`}
        aria-live="polite"
      >
        {adding ? (
          <>
            <span className="word text-bone-dim">{shorter}</span>
            <Arrow />
            <Marked word={longer} pos={pos} length={sub.length} tone="gilt" />
          </>
        ) : (
          <>
            <Marked word={longer} pos={pos} length={sub.length} tone="blood" struck />
            <Arrow />
            <span className="word text-bone">{shorter}</span>
          </>
        )}
        <span className={`label ml-3 ${adding ? 'text-gilt' : 'text-blood-lit'}`}>
          {adding ? '+' : '−'}
          {sub}
        </span>
      </p>
    );
  }

  if (edit.shape === 'swap') {
    return (
      <p className={`text-bone-dim text-lg sm:text-xl ${dim}`} aria-live="polite">
        <span className="word">{from}</span>
        <Arrow />
        <span className="word">{word}</span>
        <span className="label text-blood-lit ml-3">same length</span>
      </p>
    );
  }

  // Scattered: the letters would change in more than one place.
  return (
    <p className={`text-bone-dim text-lg sm:text-xl ${dim}`} aria-live="polite">
      <span className="word">{from}</span>
      <Arrow />
      <span className="word">{word}</span>
      <span className="label text-blood-lit ml-3">not one run</span>
    </p>
  );
}
