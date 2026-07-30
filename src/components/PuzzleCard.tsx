/**
 * One puzzle, as a thing you can click on — the same in the archive's calendar and in its
 * search, because they are offering the same thing and a player should not have to learn two
 * ways of reading it.
 *
 * **It says what it does.** A card that opens a board underlines its date and lights its border
 * on hover; a card that cannot — a future date, or a day the calendar has not answered for yet —
 * does neither and is not a button at all. Without that the archive was a wall of text with no
 * way to tell what was live, which is worse than no affordance, because the words look like
 * links either way.
 *
 * `date` is optional: the month grid puts the day number in the corner of its own square and
 * three copies of it inside would be noise. Where the date is not shown the border still lights,
 * so the card is never silent about being clickable.
 */

import { memo } from 'react';

interface Props {
  /** Shown when given, and underlined on hover. Omitted where the surround already says it. */
  date?: string | undefined;
  /** "short", "medium", "long" — which of the day's three this is. */
  band: string;
  source: string;
  target: string;
  /** Absent while the pair index is still arriving, which is what the placeholder is for. */
  known: boolean;
  /** Today's, which the archive marks wherever it appears. */
  today?: boolean;
  onOpen?: () => void;
}

export const PuzzleCard = memo(function PuzzleCard({
  date,
  band,
  source,
  target,
  known,
  today = false,
  onOpen,
}: Props) {
  const words = known ? (
    <span className="word text-bone-dim group-hover:text-bone text-[0.7rem] leading-tight break-words">
      {source}
      <span className="text-ash-lit"> · </span>
      {target}
    </span>
  ) : (
    // The index is a megabyte and arrives after the page. A row that keeps its shape while it
    // does is better than one that appears under the pointer.
    <span className="word text-ash-lit text-[0.7rem]">…</span>
  );

  const inside = (
    <>
      {date !== undefined && (
        <span
          className={`label block text-[0.6rem] leading-none ${
            today ? 'text-gilt' : 'text-ash-lit'
          } ${onOpen ? 'group-hover:text-gilt group-hover:underline' : ''}`}
        >
          {date}
          {today ? ' · today' : ''}
        </span>
      )}
      <span className="label text-ash-lit block text-[0.55rem] leading-none">{band}</span>
      {words}
    </>
  );

  const shape = 'border-rule flex flex-col gap-1 border p-1.5 text-left transition-colors';

  // Not a button when there is nowhere to go: a disabled button still reads as one, and the
  // whole point here is that a future date should not look like an offer.
  if (!onOpen) {
    return <div className={`${shape} opacity-40`}>{inside}</div>;
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      title={`${band}: ${source} → ${target}`}
      className={`${shape} group hover:border-gilt hover:bg-noir-3 w-full`}
    >
      {inside}
    </button>
  );
});
