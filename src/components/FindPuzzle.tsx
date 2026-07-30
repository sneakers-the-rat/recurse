/**
 * Find a board by part of either of its words.
 *
 * **Substring, not prefix, and either field alone will do.** Typing `ring` into the source finds
 * `sparring`, because the whole game is words inside words and somebody looking for one rarely
 * knows how it starts. One field narrows, both narrow further, and the matches are listed as the
 * same cards the calendar shows.
 *
 * No `datalist`. The browser's own suggestion list draws a dropdown arrow inside the field, over
 * the end of what is being typed, and the results below it were the same answers twice.
 *
 * Held to what has been played, and the *matches* are filtered rather than the result: a word
 * whose only puzzles are in the future should not be offered and then refused.
 */

import { memo, useMemo, useState } from 'react';
import type { Pair } from '../lib/data';
import { PuzzleCard } from './PuzzleCard';

/** Results shown at once. A two-letter query matches thousands; nobody reads thousands. */
const RESULTS = 40;

interface Props {
  /** The pair index, once it has arrived. */
  pairs: readonly Pair[] | null;
  /** Which boards have come up, and when. Anything else is not offered. */
  played: ReadonlyMap<string, { date: string; band: number }>;
  bandName: (band: number) => string;
  onOpen: (id: string) => void;
}

export const FindPuzzle = memo(function FindPuzzle({
  pairs,
  played,
  bandName,
  onOpen,
}: Props) {
  const [source, setSource] = useState('');
  const [target, setTarget] = useState('');

  const { shown, total } = useMemo(() => {
    const from = source.trim().toLowerCase();
    const to = target.trim().toLowerCase();
    if (!from && !to) return { shown: [], total: 0 };

    const found = (pairs ?? []).filter(
      (pair) =>
        played.has(pair.id) &&
        (!from || pair.source.includes(from)) &&
        (!to || pair.target.includes(to)),
    );
    // Newest first: an archive is read back from today far more often than forward from the start.
    found.sort((a, b) => (played.get(b.id)!.date < played.get(a.id)!.date ? -1 : 1));
    return { shown: found.slice(0, RESULTS), total: found.length };
  }, [pairs, played, source, target]);

  const asked = source.trim() !== '' || target.trim() !== '';

  return (
    <div className="border-rule border">
      <div className="border-rule flex flex-wrap items-center gap-2 border-b p-3">
        <Field value={source} onChange={setSource} label="source" ready={pairs !== null} />
        <span className="text-ash-lit">→</span>
        <Field value={target} onChange={setTarget} label="target" ready={pairs !== null} />
      </div>
      {asked ? (
        <Results shown={shown} total={total} played={played} bandName={bandName} onOpen={onOpen} />
      ) : (
        <p className="label text-ash-lit p-3 normal-case">
          Part of either word will do. Only puzzles that have already come up.
        </p>
      )}
    </div>
  );
});

function Field({
  value,
  onChange,
  label,
  ready,
}: {
  value: string;
  onChange: (next: string) => void;
  label: string;
  ready: boolean;
}) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={ready ? label : 'loading…'}
      aria-label={`Find a puzzle by its ${label} word`}
      autoComplete="off"
      className="word border-rule text-bone focus:border-gilt min-w-0 flex-1 border bg-transparent px-2 py-1 outline-none"
    />
  );
}

function Results({
  shown,
  total,
  played,
  bandName,
  onOpen,
}: {
  shown: readonly Pair[];
  total: number;
  played: ReadonlyMap<string, { date: string; band: number }>;
  bandName: (band: number) => string;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="p-2">
      <p className="label text-ash-lit mb-2 normal-case" role="status">
        {total === 0
          ? 'No puzzle yet with those words.'
          : `${total} puzzle${total === 1 ? '' : 's'}${
              total > shown.length ? `, showing ${shown.length}` : ''
            }`}
      </p>
      <div className="grid gap-1 sm:grid-cols-2" role="group" aria-label="Puzzles found">
        {shown.map((pair) => {
          const when = played.get(pair.id)!;
          return (
            <PuzzleCard
              key={pair.id}
              date={when.date}
              band={bandName(when.band)}
              source={pair.source}
              target={pair.target}
              known
              onOpen={() => onOpen(pair.id)}
            />
          );
        })}
      </div>
    </div>
  );
}
